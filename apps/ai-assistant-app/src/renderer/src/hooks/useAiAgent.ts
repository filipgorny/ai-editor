import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Graph, Node } from '../model'
import { appBus } from '../events'
import { commander } from '../commander/Commander'
import type { EditorTarget } from '@/common/editor/CodeEditor'
import type { AskUserPrompt } from '@/common/dialogs/AiAskModal'
import type { ViewKey } from '../views/types'

// How long an agent-opened editor window stays (after the live typing) before it
// fades out and closes — enough to see the change without lingering.
const AGENT_WINDOW_DWELL_MS = 2600

type AiAgentDeps = {
  folder: string
  activeView: ViewKey
  selectedNode: Node | null
  activeEditorPath: string
  graphRef: React.MutableRefObject<Graph | null>
  lastDir: React.MutableRefObject<string>
  openFile: (absFile: string, fn?: string, animate?: boolean, gotoLine?: number) => void
  closeEditorAnimated: (path: string) => void
  refreshForPath: (p: string) => void
  setFocusPath: (p: string) => void
  getOpenEditors: () => EditorTarget[]
}

export function useAiAgent(deps: AiAgentDeps) {
  const {
    folder,
    activeView,
    selectedNode,
    activeEditorPath,
    graphRef,
    lastDir,
    openFile,
    closeEditorAnimated,
    refreshForPath,
    setFocusPath,
    getOpenEditors
  } = deps

  const { t, i18n } = useTranslation()
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentReply, setAgentReply] = useState('')
  // pytanie zadane przez agenta (skill ask_user) → modal z wariantami; null = brak
  const [pendingAsk, setPendingAsk] = useState<AskUserPrompt | null>(null)

  // Zmiana zakładki chowa dymek odpowiedzi AI — np. po zapytaniu w zakładce czatu odpowiedź
  // jest już w jej logu, więc balonik nie „wędruje" za nami na inne widoki.
  useEffect(() => {
    setAgentReply('')
  }, [activeView])

  // serializeGraph zwraca zwięzłą strukturę grafu dla skilla get_graph.
  const serializeGraph = (): string => {
    const g = graphRef.current

    if (!g) {
      return '(brak grafu — projekt nie został zeskanowany)'
    }

    const nodes = g.nodes().map((n) => ({ id: n.id, kind: n.kind, name: n.name, file: n.absFile || n.file }))
    const edges = g.dependencies().map((d) => ({ from: d.from, to: d.to }))

    return JSON.stringify({ nodes, edges })
  }

  // describeScreen captures WHAT THE USER IS CURRENTLY LOOKING AT, sent with every prompt so
  // the model can resolve "this/that/here". The screen is the active view; on file views we
  // add the open file's path, on the code diagram the selected element. Returns a compact
  // object embedded as JSON in the prompt (see the initial prompt in the Go agent).
  const describeScreen = (): Record<string, unknown> => {
    const sel = selectedNode
    const screen: Record<string, unknown> = { screen: activeView }

    if (activeView === 'diagram' && sel) {
      screen.element = { kind: sel.kind, name: sel.name, file: sel.absFile || sel.file || '' }
    } else if (activeEditorPath) {
      screen.file = activeEditorPath
    }

    // Advertise the higher-level app commands the model may drive via run_command. The
    // low-level editor groups (typing/cursor/selection/clipboard) are noise for the agent,
    // so they're filtered out — the model edits files through the file-writing agent instead.
    const HIDDEN_GROUPS = new Set(['Edycja', 'Kursor', 'Zaznaczenie', 'Schowek'])

    screen.commands = commander
      .list()
      .filter((c) => c.available && !HIDDEN_GROUPS.has(c.group))
      .map((c) => ({ name: c.name, params: c.params, summary: c.summary }))

    return screen
  }

  // runSkill wykonuje żądanie skilla po stronie aplikacji. Zwraca treść, albo undefined gdy
  // odpowiedź przyjdzie później (ask_user — po wyborze w modalu).
  const runSkill = async (req: AiSkillRequest): Promise<string | undefined> => {
    if (req.name === 'run_command') {
      const res = await commander.run(req.args)

      return res.ok ? `ok: ${req.args}` : `error: ${res.error ?? 'command failed'}`
    }

    if (req.name === 'read_file') {
      const live = commander.activeEditor()

      if (live && live.path === req.args) {
        return live.content // żywa (też niezapisana) treść otwartego pliku
      }

      return window.api.readFile(req.args)
    }

    if (req.name === 'list_dir') {
      return JSON.stringify(await window.api.fsList(req.args))
    }

    if (req.name === 'get_graph') {
      return serializeGraph()
    }

    if (req.name === 'ask_user') {
      let q: { question?: string; options?: string[] } = {}

      try {
        q = JSON.parse(req.args)
      } catch {
        q = { question: req.args, options: [] }
      }

      setPendingAsk({ id: req.id, question: q.question || req.args, options: q.options ?? [] })

      return undefined
    }

    return `nieznany skill: ${req.name}`
  }

  // runAsk startuje turę agenta ze skillami (Q&A + read_file/get_graph + ask_user).
  const runAsk = (prompt: string): void => {
    const dir = lastDir.current || folder
    const sel = selectedNode

    setAgentBusy(true)
    setAgentReply('')
    // The chat log shows the CLEAN prompt; the screen context is appended only to what the
    // model receives, as a JSON blob it can parse (see the Go agent's initial prompt).
    appBus.emit('agent:start', { prompt, dir })

    const fullPrompt = `${prompt}\n\n<currentView>${JSON.stringify(describeScreen())}</currentView>`

    window.api.aiAsk({
      prompt: fullPrompt,
      dir,
      lang: i18n.language,
      context: {
        instruction: prompt,
        openFile: activeEditorPath || '',
        selectedKind: sel?.kind ?? '',
        selectedName: sel?.name ?? '',
        selectedFile: sel ? sel.absFile || sel.file || '' : ''
      }
    })
  }

  // onAskChoose — wybór w modalu wraca jako wynik skilla ask_user; agent kontynuuje.
  const onAskChoose = (answer: string): void => {
    if (pendingAsk) {
      window.api.aiSkillResult({ id: pendingAsk.id, content: answer })
      setPendingAsk(null)
    }
  }

  // Nasłuch (raz): zdarzenia agenta (plan/narzędzie/odpowiedź) + wykonywanie skilli.
  useEffect(() => {
    const offEvent = window.api.onAiEvent((ev) => {
      if (ev.type === 'answer') {
        setAgentReply(ev.answer)
        setAgentBusy(false)
        appBus.emit('agent:success', { ops: 0, message: ev.answer })
      } else if (ev.type === 'done') {
        setAgentBusy(false)
      } else if (ev.type === 'error') {
        setAgentReply(t('agent.error', { message: ev.message }))
        setAgentBusy(false)
        appBus.emit('agent:error', { message: ev.message })
      }
    })

    const offSkill = window.api.onAiSkill(async (req) => {
      try {
        const content = await runSkill(req)

        if (content === undefined) {
          return // ask_user — wynik odeśle modal po wyborze
        }

        window.api.aiSkillResult({ id: req.id, content })
      } catch (e) {
        window.api.aiSkillResult({ id: req.id, error: String((e as Error)?.message || e) })
      }
    })

    return () => {
      offEvent()
      offSkill()
    }
  }, [])

  const runAgent = async (prompt: string) => {
    const dir = lastDir.current || folder

    if (!dir) {
      return
    }

    // Snapshot which files are already open — agent windows opened just to show a
    // write get auto-closed afterwards; pre-existing ones stay.
    const openBefore = new Set(getOpenEditors().map((e) => e.path))

    setAgentBusy(true)
    appBus.emit('agent:start', { prompt, dir })

    // Send a JSON payload: the user's instruction + the selected graph element and/or
    // the file currently open in the editor (context for "this"/"that"). Dołączamy ŻYWĄ
    // treść aktywnego edytora (też niezapisaną), by agent edytował dokładnie to, co widać.
    const sel = selectedNode
    const activeEd = commander.activeEditor()
    const payload = JSON.stringify({
      instruction: prompt,
      selectedElement: sel
        ? { kind: sel.kind, name: sel.name, file: sel.absFile || sel.file || '' }
        : null,
      openEditorFile: activeEd?.path || activeEditorPath || null,
      openEditorContent: activeEd?.content ?? null
    })

    try {
      const res = await window.api.aiAgent(payload, dir, i18n.language)

      // zawsze pokaż coś w dymku (komunikat, podsumowanie operacji albo info)
      const reply =
        res?.message ||
        (res?.ops?.length ? t('agent.opsDone', { count: res.ops.length }) : t('agent.noOps'))

      setAgentReply(reply)
      appBus.emit('agent:success', { ops: res?.ops?.length ?? 0, message: reply })

      // Fire a granular bus event per executed op, so anything listening to the
      // file events (scripts, loggers) reacts to AI-agent changes the same way it
      // does to manual ones. FileOp only carries the resulting path.
      for (const op of res?.ops ?? []) {
        emitFileOpEvent(op.op, op.path)
      }

      // Files the agent wrote — show each in an editor window (typing in live).
      // Only real file writes open an editor; folder ops (mkdir) never do.
      const written = (res?.ops ?? [])
        .filter((op) => op.op === 'create_file' || op.op === 'write')
        .map((op) => op.path)

      for (const p of written) {
        openFile(p, undefined, true) // animate = live typing
      }

      // Windows opened only to show the write (not open beforehand) fade out and
      // close once the user has had a moment to see the change.
      const transient = written.filter((p) => !openBefore.has(p))

      if (transient.length) {
        window.setTimeout(() => {
          for (const p of transient) {
            closeEditorAnimated(p)
          }
        }, AGENT_WINDOW_DWELL_MS)
      }

      if (res?.ops?.length) {
        const p = res.openPath || res.ops[0].path
        setFocusPath(p)
        refreshForPath(p) // refresh the app/project that the ops touched
      }
    } catch (e) {
      const message = String((e as Error)?.message || e)

      setAgentReply(t('agent.error', { message }))
      appBus.emit('agent:error', { message })
    } finally {
      setAgentBusy(false)
    }
  }

  // clearReply dismisses the agent's reply bubble.
  const clearReply = (): void => setAgentReply('')

  return { agentBusy, agentReply, pendingAsk, runAsk, runAgent, onAskChoose, clearReply }
}

// emitFileOpEvent maps an AI-agent FileOp (op name + resulting path) onto the
// app's file-event bus. rename/move carry only the resulting path, so `from` is
// left empty; plain `write` is a content edit (no structural file event).
function emitFileOpEvent(op: string, path: string): void {
  switch (op) {
    case 'create_file':
      appBus.emit('file:create', { path, kind: 'class' })
      break

    case 'mkdir':
      appBus.emit('folder:create', { path })
      break

    case 'delete':
      appBus.emit('file:delete', { path })
      break

    case 'rename':
      appBus.emit('file:rename', { from: '', to: path })
      break

    case 'move':
      appBus.emit('file:move', { from: '', to: path })
      break

    default:
      break
  }
}
