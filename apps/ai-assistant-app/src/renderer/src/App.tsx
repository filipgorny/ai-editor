import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mergeAppGraphs, type RawGraph } from './utils/mergeGraph'
import styled from 'styled-components'
import { Button } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { makeTheme } from './theme'
import { accentBy } from './styles/accents'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import SettingsIcon from '@mui/icons-material/Settings'
import CodeIcon from '@mui/icons-material/Code'
import TerminalIcon from '@mui/icons-material/Terminal'
import RateReviewIcon from '@mui/icons-material/RateReview'
import { AppNode, GatewayMapper, Graph, Node, ScanProgress } from './model'
import GraphView from './components/GraphView'
import ScanModal from './components/ScanModal'
import SettingsDialog from './components/SettingsDialog'
import ScriptsDialog from './components/ScriptsDialog'
import LogsDialog from './components/LogsDialog'
import ClaudeLoginDialog from './components/ClaudeLoginDialog'
import AiAskModal, { type AskUserPrompt } from './components/AiAskModal'
import ToastHost from './components/ToastHost'
import AgentBar from './components/AgentBar'
import EditorTabs from './components/EditorTabs'
import FileBrowser from './components/FileBrowser'
import CodeEditor, { type EditorTarget, EDITOR_FADE_MS } from './components/CodeEditor'
import { EditorContext } from './components/EditorContext'
import { GitContext, type GitState, type BlameMode, type ReviewStatus } from './components/GitContext'
import { appBus } from './events'
import { commander } from './commander/Commander'
import { colors } from './styles/tokens'

const Layout = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
`

const TopBar = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.panel};
`

const ProjectName = styled.div`
  font-family: monospace;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
`

// Wiersz głównej zawartości: lewy panel plików + graf (od paska edytorów do promptu).
const Content = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
`

const Stage = styled.main`
  flex: 1;
  position: relative;
  min-width: 0;
`

const Empty = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: ${colors.muted};
  text-align: center;
`

// How long an agent-opened editor window stays (after the live typing) before it
// fades out and closes — enough to see the change without lingering.
const AGENT_WINDOW_DWELL_MS = 2600

type Mode = 'idle' | 'scanning' | 'graph'
type View = { type: 'project' } | { type: 'app'; appId: number; name: string }

// Default global script, seeded once into the scripting service: Shift+Tab cycles to the
// next editor window so you can flip between open files.
const DEFAULT_SCRIPT = {
  name: 'Window cycle (Shift+Tab)',
  content: `-- Shift+Tab: switch to the next open editor window (cycle through files).
onKey("shift+tab", function()
  cmd("tabs", "next")
end)
`
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<Mode>('idle')
  const [folder, setFolder] = useState('')
  // monorepo graph (raw) + internal graphs of inline-expanded apps; merged below
  const [rawBase, setRawBase] = useState<RawGraph | null>(null)
  const [rawApps, setRawApps] = useState<Record<number, RawGraph>>({})
  const rawAppsRef = useRef<Record<number, RawGraph>>({})
  // what the in-flight scan is for (drives onScanEnd). null = none / initial scan.
  const scanKind = useRef<'project' | 'refresh' | { app: number } | null>(null)
  const [progress, setProgress] = useState<ScanProgress>(ScanProgress.initial())
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [title, setTitle] = useState('ai-architect')
  const [nav, setNav] = useState({ back: false, fwd: false })
  const [editors, setEditors] = useState<EditorTarget[]>([])
  const [activeEditor, setActiveEditor] = useState('')
  const [minimized, setMinimized] = useState<Set<string>>(new Set())
  // editors currently fading out (opacity 1→0) before removal
  const [closingEditors, setClosingEditors] = useState<Set<string>>(new Set())
  // editor windows snapped to fill the graph area ("top" snap). When any is snapped, a
  // newly opened file opens snapped too.
  const [snappedTop, setSnappedTop] = useState<Set<string>>(new Set())
  // geometria okien edytorów per ścieżka (pozycja/rozmiar/snap/fullscreen) — zapamiętywana
  // per projekt i odtwarzana przy ponownym otwarciu (SQLite w procesie main).
  type EditorGeom = { x: number; y: number; w: number; h: number; snapped: boolean; fullscreen: boolean }
  const [layoutByPath, setLayoutByPath] = useState<Record<string, EditorGeom>>({})
  // czy układ edytorów dla bieżącego folderu został już odtworzony (bramkuje zapis,
  // by świeżo wczytany stan nie został nadpisany pustym przy montażu).
  const restoredFolder = useRef('')
  // wersja systemu plików — bump po operacji, by drzewo plików się odświeżyło
  const [fsVersion, setFsVersion] = useState(0)
  // globalne ustawienia edytorów (wspólne dla wszystkich okien)
  const [vimOn, setVimOn] = useState(true)
  const [copilotOn, setCopilotOn] = useState(true)
  const [rainbow, setRainbow] = useState(true) // kolorowanie par nawiasów w edytorze
  const [editorTheme, setEditorTheme] = useState('Czarny (domyślny)')
  const [wallpaper, setWallpaper] = useState('') // graph background image url
  const [accent, setAccent] = useState('blue') // app accent (button colour) theme
  const muiTheme = useMemo(() => makeTheme(accent), [accent])
  const [focusPath, setFocusPath] = useState('')
  // last-clicked graph node — highlighted, and its info is sent with the AI prompt
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  // git: tryb autorstwa na klockach (off/last) + czy kopia .git jest już wgrana
  const [gitBlame, setGitBlame] = useState<BlameMode>('off')
  const [gitReady, setGitReady] = useState(false)
  // tryb review: zmienione pliki (gałąź vs baza) ze statusem
  const [review, setReview] = useState(false)
  const [reviewFiles, setReviewFiles] = useState<{ path: string; absPath: string; status: ReviewStatus }[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scriptsOpen, setScriptsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [claudeLoginOpen, setClaudeLoginOpen] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentReply, setAgentReply] = useState('')
  // pytanie zadane przez agenta (skill ask_user) → modal z wariantami; null = brak
  const [pendingAsk, setPendingAsk] = useState<AskUserPrompt | null>(null)
  // ostatnio otwarty folder (kontekst dla agenta — domyślny katalog nowych plików)
  const lastDir = useRef('')
  // czy próbowaliśmy już zasiać domyślny skrypt (raz na sesję)
  const seeded = useRef(false)

  const pending = useRef<View>({ type: 'project' })
  const [navKey, setNavKey] = useState(0) // ++ przy NAWIGACJI (drill/back) — graf fituje/resetuje rozwinięcia
  const scannedProjectId = useRef('')
  const history = useRef<View[]>([])
  const index = useRef(-1)

  // merged graph: monorepo + expanded apps (apps expand in place like folders)
  const graph = useMemo(
    () =>
      rawBase
        ? GatewayMapper.graph(
            mergeAppGraphs(rawBase, rawApps) as unknown as Parameters<typeof GatewayMapper.graph>[0]
          )
        : null,
    [rawBase, rawApps]
  )

  useEffect(() => {
    rawAppsRef.current = rawApps
  }, [rawApps])

  // Najnowszy graf pod ręką dla skilla get_graph (handler AI rejestrujemy raz, bez deps).
  const graphRef = useRef<Graph | null>(null)

  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  // Load persisted visual settings (accent / editor theme / wallpaper) on startup.
  // settingsLoaded guards the persist effects below so they don't clobber the store
  // with defaults before the load completes.
  const settingsLoaded = useRef(false)

  useEffect(() => {
    let cancelled = false

    window.api.getSettings().then(async (s) => {
      if (s?.appTheme) {
        setAccent(s.appTheme)
      }

      if (s?.editorTheme) {
        setEditorTheme(s.editorTheme)
      }

      if (s?.wallpaper !== undefined) {
        setWallpaper(s.wallpaper)
      }

      if (s?.rainbowBrackets !== undefined) {
        setRainbow(s.rainbowBrackets)
      }

      if (s?.gitBlame === 'off' || s?.gitBlame === 'last') {
        setGitBlame(s.gitBlame)
      }

      settingsLoaded.current = true

      // Apply the saved LLM provider to the ai service on startup — otherwise it always
      // starts on the config default (ollama), ignoring a "Claude" selection until the user
      // re-saves Settings. Retried a few times to ride out the backend coming up.
      const provider = s?.provider

      if (provider) {
        for (let i = 0; i < 5 && !cancelled; i++) {
          try {
            await window.api.aiSetProvider(provider)
            break
          } catch {
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
      }

      // Claude headless needs an OAuth token on the server — prompt for one if it's missing.
      if (provider === 'claude' && !cancelled) {
        const hasToken = await window.api.claudeTokenStatus().catch(() => false)

        if (!hasToken && !cancelled) {
          setClaudeLoginOpen(true)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Re-check Claude login whenever the user switches the provider to Claude in Settings.
  useEffect(() => {
    return appBus.on('settings:provider-change', async ({ provider }) => {
      if (provider !== 'claude') {
        return
      }

      const hasToken = await window.api.claudeTokenStatus().catch(() => false)

      if (!hasToken) {
        setClaudeLoginOpen(true)
      }
    })
  }, [])

  // Persist each visual setting when it changes (merged server-side).
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentBy(accent).color)

    if (settingsLoaded.current) {
      window.api.setSettings({ appTheme: accent })
    }
  }, [accent])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ editorTheme })
    }
  }, [editorTheme])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ wallpaper })
    }
  }, [wallpaper])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ rainbowBrackets: rainbow })
    }
  }, [rainbow])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ gitBlame })
    }
  }, [gitBlame])

  // Serwis git czyta repozytorium WPROST z dysku (widzi też niezacommitowane
  // zmiany w drzewie roboczym), więc nic nie wysyłamy — gotowość zależy tylko od
  // tego, czy jest otwarty projekt.
  useEffect(() => {
    setGitReady(!!folder)
  }, [folder])

  // Start aplikacji: automatycznie otwórz ostatnio edytowany projekt.
  useEffect(() => {
    window.api.lastFolder().then((f) => {
      setFolder(f)

      if (f) {
        appBus.emit('project:open', { folder: f })
        scanProject(f)
      }
    })
  }, [])

  useEffect(() => {
    const offProgress = window.api.onProgress((raw) => {
      const p = GatewayMapper.progress(raw)

      setProgress(p)
      appBus.emit('scan:progress', {
        currentFile: p.currentFile,
        filesDone: p.filesDone,
        entitiesDone: p.entitiesDone
      })

      if (p.projectId) {
        scannedProjectId.current = p.projectId
      }

      if (p.message) {
        setLog((prev) => [...prev.slice(-300), p.message])
      }
    })

    const offEnd = window.api.onScanEnd(async () => {
      const kind = scanKind.current
      scanKind.current = null

      // inline-expand / per-app refresh: re-fetch that app and merge it in place
      if (kind && typeof kind === 'object') {
        const appId = kind.app
        const raw = (await window.api.getAppGraph(appId)) as RawGraph
        setRawApps((prev) => ({ ...prev, [appId]: raw }))
        appBus.emit('scan:end', { kind: 'expand' })

        return
      }

      // silent refresh after a file op: re-fetch base + all expanded apps in place
      if (kind === 'refresh') {
        const base = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph
        setRawBase(base)

        for (const id of Object.keys(rawAppsRef.current).map(Number)) {
          const r = (await window.api.getAppGraph(id)) as RawGraph
          setRawApps((prev) => ({ ...prev, [id]: r }))
        }

        appBus.emit('scan:end', { kind: 'refresh' })

        return
      }

      // initial project scan ('project' or null) → fresh monorepo graph (apps collapsed)
      const base = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph
      setRawBase(base)
      setRawApps({})
      setMode('graph')
      setNavKey((n) => n + 1)
      appBus.emit('scan:end', { kind: 'project' })
    })

    const offError = window.api.onScanError((m) => {
      setError(m)
      appBus.emit('scan:error', { message: m })
    })

    return () => {
      offProgress()
      offEnd()
      offError()
    }
  }, [])

  // Przyciski myszy: wstecz / dalej w historii otwartych nodów.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      }

      if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }

    window.addEventListener('mouseup', onMouse)

    return () => window.removeEventListener('mouseup', onMouse)
  }, [])

  const syncNav = () => {
    setNav({ back: index.current > 0, fwd: index.current < history.current.length - 1 })
  }

  // Apps no longer drill into a separate scene — they expand inline. applyView only
  // re-applies the monorepo (project) graph (used by back/forward).
  const applyView = async (_v: View, nav = true) => {
    const raw = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph

    setRawBase(raw)
    setTitle('ai-architect')
    setMode('graph')

    if (nav) {
      setNavKey((n) => n + 1)
    }
  }

  const pushView = async (v: View) => {
    history.current = [...history.current.slice(0, index.current + 1), v]
    index.current = history.current.length - 1
    syncNav()
    await applyView(v)
  }

  const back = async () => {
    if (index.current <= 0) {
      return
    }

    index.current--
    syncNav()
    appBus.emit('nav:back', {})
    await applyView(history.current[index.current])
  }

  const forward = async () => {
    if (index.current >= history.current.length - 1) {
      return
    }

    index.current++
    syncNav()
    appBus.emit('nav:forward', {})
    await applyView(history.current[index.current])
  }

  const resetProgress = () => {
    setError('')
    setLog([])
    setProgress(ScanProgress.initial())
  }

  const scanProject = (path: string) => {
    if (!path) {
      return
    }

    pending.current = { type: 'project' }
    scanKind.current = 'project'
    resetProgress()
    setMode('scanning')
    appBus.emit('scan:start', { kind: 'project', path })
    window.api.startScan(path)
  }

  // appIdForPath finds the expanded app whose directory contains the given path.
  const appIdForPath = (path: string): number | null => {
    for (const [appIdStr, g] of Object.entries(rawAppsRef.current)) {
      const root = (g.nodes ?? []).find((n) => n.id === 'folder:.')
      const dir = typeof root?.file === 'string' ? root.file : ''

      if (dir && path.startsWith(dir)) {
        return Number(appIdStr)
      }
    }

    return null
  }

  // refreshForPath silently refreshes the graph after a file op. A file inside an
  // expanded app triggers a deep re-scan of THAT app (so its internals update); a
  // monorepo-level change re-scans the project. Both update the graph in place.
  const refreshForPath = (path: string) => {
    setFsVersion((n) => n + 1) // also refresh the file tree (filer)

    if (scanKind.current != null) {
      return // a scan is already in flight
    }

    const appId = appIdForPath(path)

    if (appId != null) {
      scanKind.current = { app: appId } // reuse the inline-expand flow: deep-scan + re-merge
      window.api.startScanApp(appId)

      return
    }

    scanKind.current = 'refresh'
    window.api.startScan(folder)
  }

  // refreshCurrentView — refresh without a specific path (re-scans the project).
  const refreshCurrentView = () => {
    setFsVersion((n) => n + 1)

    if (scanKind.current != null) {
      return
    }

    scanKind.current = 'refresh'
    window.api.startScan(folder)
  }

  // Keep the latest refresh fn for the disk watcher (avoids a stale closure without
  // re-subscribing on every render).
  const refreshRef = useRef(refreshForPath)
  refreshRef.current = refreshForPath

  // React to on-disk changes: the filer watches the project tree (gateway → main →
  // here) so the graph reflects files created/removed/renamed outside the app —
  // including those written by `claude -p` in headless mode.
  useEffect(() => {
    if (!folder) {
      return
    }

    // Guard against a stale preload (dev): the watcher API only exists after a full
    // `pnpm dev` restart, so skip cleanly instead of crashing the renderer.
    if (typeof window.api.watchProject !== 'function' || typeof window.api.onFsChange !== 'function') {
      return
    }

    window.api.watchProject(folder)

    let timer: number | undefined
    let pending = ''

    const off = window.api.onFsChange((ev) => {
      appBus.emit('disk:change', {
        path: ev.path,
        op: ev.op as 'create' | 'write' | 'remove' | 'rename' | 'chmod',
        dir: ev.dir
      })

      // Only structural changes (new/removed/renamed entries) reshape the graph;
      // plain content writes (incl. the app's own saves) are ignored to avoid loops.
      if (ev.op === 'write' || ev.op === 'chmod') {
        return
      }

      pending = ev.path
      window.clearTimeout(timer)
      // Debounce bursts (e.g. a git checkout) into a single refresh.
      timer = window.setTimeout(() => {
        appBus.emit('disk:refresh', { path: pending })
        refreshRef.current(pending)
      }, 400)
    })

    return () => {
      window.clearTimeout(timer)
      off()
      window.api.stopWatch()
    }
  }, [folder])

  const pickAndScan = async () => {
    const picked = await window.api.pickFolder()

    if (picked) {
      setFolder(picked)
      appBus.emit('project:open', { folder: picked })
      scanProject(picked)
    }
  }

  // openFile otwiera (lub aktywuje) okno edytora; można mieć kilka naraz.
  // animate=true → zawartość „wpisuje się" na żywo (gdy plik otwiera agent).
  const openFile = (absFile: string, fn?: string, animate = false, gotoLine?: number) => {
    lastDir.current = absFile.replace(/[\\/][^\\/]+$/, '') // zapamiętaj folder
    appBus.emit('editor:open', { path: absFile })

    setEditors((prev) =>
      prev.some((e) => e.path === absFile)
        ? prev.map((e) => (e.path === absFile ? { path: absFile, gotoFn: fn, gotoLine, animate } : e))
        : [...prev, { path: absFile, gotoFn: fn, gotoLine, animate }]
    )

    setActiveEditor(absFile)
    setMinimized((prev) => {
      if (!prev.has(absFile)) {
        return prev
      }

      const next = new Set(prev)
      next.delete(absFile)

      return next
    })
  }

  const closeEditor = (path: string) => {
    appBus.emit('editor:close', { path })
    setEditors((prev) => prev.filter((e) => e.path !== path))
    setMinimized((prev) => {
      const next = new Set(prev)
      next.delete(path)

      return next
    })
    setSnappedTop((prev) => {
      if (!prev.has(path)) {
        return prev
      }

      const next = new Set(prev)
      next.delete(path)

      return next
    })
  }

  // setEditorSnap records whether an editor window is snapped to the top (graph area), so
  // that opening another file while one is snapped opens the new window snapped too.
  const setEditorSnap = (path: string, snapped: boolean): void => {
    setSnappedTop((prev) => {
      if (snapped === prev.has(path)) {
        return prev
      }

      const next = new Set(prev)

      if (snapped) {
        next.add(path)
      } else {
        next.delete(path)
      }

      return next
    })
  }

  // onEditorGeometry zapamiętuje geometrię okna danego pliku (zgłaszaną przez CodeEditor).
  const onEditorGeometry = (path: string, g: EditorGeom): void => {
    setLayoutByPath((prev) => {
      const c = prev[path]

      if (c && c.x === g.x && c.y === g.y && c.w === g.w && c.h === g.h && c.snapped === g.snapped && c.fullscreen === g.fullscreen) {
        return prev
      }

      return { ...prev, [path]: g }
    })
  }

  // Po otwarciu projektu ODTWÓRZ zapamiętany układ okien edytorów (SQLite per folder):
  // te same pliki, w tych samych miejscach/rozmiarach, zesnapowane/zminimalizowane jak były.
  useEffect(() => {
    restoredFolder.current = ''

    // Guard a stale preload (dev): the editor-layout API only exists after a full
    // `pnpm dev` restart, so skip cleanly instead of crashing the renderer.
    if (!folder || typeof window.api.getEditorLayout !== 'function') {
      restoredFolder.current = folder
      return
    }

    let cancelled = false

    window.api
      .getEditorLayout(folder)
      .then((data) => {
        if (cancelled) {
          return
        }

        const wins = data?.editors ?? []
        const geom: Record<string, EditorGeom> = {}

        for (const w of wins) {
          if (w.x != null && w.y != null && w.w != null && w.h != null) {
            geom[w.path] = { x: w.x, y: w.y, w: w.w, h: w.h, snapped: !!w.snapped, fullscreen: !!w.fullscreen }
          }
        }

        setLayoutByPath(geom)
        setEditors(wins.map((w) => ({ path: w.path })))
        setMinimized(new Set(data?.minimized ?? []))
        setSnappedTop(new Set(data?.snapped ?? []))
        setActiveEditor(data?.active ?? '')
        restoredFolder.current = folder
      })
      .catch(() => {
        restoredFolder.current = folder
      })

    return () => {
      cancelled = true
    }
  }, [folder])

  // Zapisz układ okien edytorów dla bieżącego projektu (odroczony zapis do SQLite).
  // Bramkowane przez restoredFolder, by nie nadpisać świeżo wczytanego stanu pustym.
  useEffect(() => {
    if (!folder || restoredFolder.current !== folder || typeof window.api.saveEditorLayout !== 'function') {
      return
    }

    const id = window.setTimeout(() => {
      const data: EditorLayout = {
        editors: editors.map((e) => {
          const g = layoutByPath[e.path]

          return g ? { path: e.path, ...g } : { path: e.path }
        }),
        active: activeEditor,
        minimized: [...minimized],
        snapped: [...snappedTop]
      }

      window.api.saveEditorLayout(folder, data)
    }, 500)

    return () => window.clearTimeout(id)
  }, [folder, editors, activeEditor, minimized, snappedTop, layoutByPath])

  // closeEditorAnimated fades the window out (opacity 1→0) before removing it.
  const closeEditorAnimated = (path: string) => {
    setClosingEditors((prev) => new Set(prev).add(path))

    window.setTimeout(() => {
      closeEditor(path)
      setClosingEditors((prev) => {
        const next = new Set(prev)
        next.delete(path)

        return next
      })
    }, EDITOR_FADE_MS)
  }

  // Klik w zakładkę: przywróć (jeśli zminimalizowane) i uaktywnij.
  const selectEditor = (path: string) => {
    appBus.emit('editor:activate', { path })
    setMinimized((prev) => {
      const next = new Set(prev)
      next.delete(path)

      return next
    })
    setActiveEditor(path)
  }

  const minimizeEditor = (path: string) => {
    appBus.emit('editor:minimize', { path })
    setMinimized((prev) => new Set(prev).add(path))
  }

  // runAgent — prompt AI w głównym widoku. Agent (gateway → ai/filer) wykonuje
  // operacje na plikach; nowy plik domyślnie w ostatnio otwartym folderze.
  // --- Agent ze skillami (Ask): treści/graf/pytania dobiera SKILLAMI wykonywanymi przez
  // aplikację (read_file/list_dir/get_graph/ask_user). Jeden aktywny przebieg. ---

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

  // runSkill wykonuje żądanie skilla po stronie aplikacji. Zwraca treść, albo undefined gdy
  // odpowiedź przyjdzie później (ask_user — po wyborze w modalu).
  const runSkill = async (req: AiSkillRequest): Promise<string | undefined> => {
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
    appBus.emit('agent:start', { prompt, dir })

    window.api.aiAsk({
      prompt,
      dir,
      lang: i18n.language,
      context: {
        instruction: prompt,
        openFile: activeEditor || '',
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
    const openBefore = new Set(editors.map((e) => e.path))

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
      openEditorFile: activeEd?.path || activeEditor || null,
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

  // „Dodaj element" — folder: utwórz katalog; klasa: utwórz plik w katalogu
  // docelowym (folderu z menu lub roota), AI wypełnia pustą klasę, otwórz + rescan.
  const addElement = async (name: string, file: string, kind: 'class' | 'function' | 'folder', targetDir?: string) => {
    const base = targetDir || folder

    if (!base) {
      return
    }

    if (kind === 'folder') {
      const dir = await window.api.createFolder(base, file)
      window.api.publishEvent({ type: 'create', title: t('events.createFolder'), file: dir })
      appBus.emit('folder:create', { path: dir })
      refreshForPath(dir) // deep-rescan the app that contains the new folder

      return
    }

    const path = await window.api.createFile(base, file, name)

    if (!path) {
      return
    }

    // AI wypełnia pustą klasę/funkcję o podanej nazwie.
    const what = kind === 'function' ? `pustą funkcję o nazwie ${name}` : `pustą klasę o nazwie ${name}`
    const generated = await window.api
      .aiEdit('', `Utwórz ${what}. Zwróć tylko kod, bez komentarzy.`, path)
      .catch(() => '')

    if (generated && generated.trim()) {
      await window.api.saveFile(path, generated)
    }

    openFile(path)
    window.api.publishEvent({ type: 'create', title: t('events.createElement'), file: path })
    appBus.emit('file:create', { path, kind })
    setFocusPath(path)
    refreshForPath(path) // deep-rescan the app so the new class appears on the graph
  }

  // „Zmień nazwę" — zmień nazwę klasy w kodzie i nazwę pliku, otwórz nowy plik.
  const renameElement = async (node: Node, className: string, fileBase: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.renameFile(node.absFile, fileBase, className, node.name)

    if (path) {
      openFile(path)
      window.api.publishEvent({ type: 'rename', title: t('events.rename'), file: path })
      appBus.emit('file:rename', { from: node.absFile, to: path })
      setFocusPath(path)
      refreshForPath(path)
    }
  }

  // „Przenieś plik" (przeciągnięcie linii do folderu) — przenieś na dysku + rescan.
  const moveFile = async (node: Node, targetDir: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.moveFile(node.absFile, targetDir)
    window.api.publishEvent({ type: 'move', title: t('events.move'), file: path })
    appBus.emit('file:move', { from: node.absFile, to: path })
    setFocusPath(path)
    refreshForPath(path)
  }

  // „Usuń element" — usuń plik/folder (przez gateway → filer) i odśwież graf.
  const deleteElement = async (node: Node, path: string) => {
    if (!window.confirm(t('graph.deleteConfirm', { name: node.name }))) {
      return
    }

    await window.api.deleteFile(path)
    window.api.publishEvent({ type: 'delete', title: t('events.delete'), file: path })
    appBus.emit('file:delete', { path })
    refreshForPath(path)
  }

  // Dwuklik w węzeł: serwis → drill-down; encja (klasa/serwis/funkcja) → edytor pliku.
  // Inline-expand an app: deep-scan it (silent) then merge its internal graph under
  // the app node. The monorepo graph stays visible the whole time.
  const expandApp = (appId: number) => {
    if (rawAppsRef.current[appId] || scanKind.current != null) {
      return // already loaded or a scan is in flight
    }

    scanKind.current = { app: appId }
    appBus.emit('nav:app-expand', { appId })
    appBus.emit('scan:start', { kind: 'app', appId })
    window.api.startScanApp(appId)
  }

  // Wire app-level actions into the Commander (open/close editors, switch tabs, pick a
  // project, run the agent). Re-wired when editors/folder change so closures stay fresh.
  useEffect(() => {
    commander.setHost({
      openFile,
      closeEditor,
      selectEditor,
      minimizeEditor,
      listEditors: () => editors.map((e) => e.path),
      activePath: () => activeEditor,
      pickProject: pickAndScan,
      refresh: refreshCurrentView,
      runAgent,
      resolvePath: (p) => {
        if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) {
          return p
        }

        const rel = p.replace(/^\.?[\\/]/, '')

        return folder ? folder.replace(/[\\/]$/, '') + '/' + rel : rel
      }
    })
  }, [editors, activeEditor, folder])

  // Auto-load stored Lua scripts for the open project from the scripting service (global +
  // project-pinned). Runs only when scripts exist (so the WASM runtime isn't pulled in
  // otherwise); the runtime is reset first for a fresh per-project environment. Failures are
  // swallowed so a bad script can't break startup.
  useEffect(() => {
    if (!folder) {
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        // Seed the default global script once (if the user hasn't created it already).
        if (!seeded.current) {
          seeded.current = true

          const all = await window.api.listScripts('')

          if (!all.some((s) => s.name === DEFAULT_SCRIPT.name)) {
            await window.api.saveScript({ name: DEFAULT_SCRIPT.name, content: DEFAULT_SCRIPT.content, project: '' })
          }
        }

        const scripts = await window.api.listScripts(folder)

        if (!scripts.length || cancelled) {
          return
        }

        const { runLuaSource, disposeLua } = await import('./lua/runtime')

        await disposeLua()

        for (const s of scripts) {
          if (cancelled) {
            return
          }

          await runLuaSource(s.content)
        }
      } catch {
        // serwis scripting niedostępny lub błąd skryptu — pomijamy (start nie może paść)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [folder])

  // Przełącznik trybu review: wgrywa świeżą kopię .git (bieżący stan gałęzi),
  // pobiera listę zmienionych plików (gałąź vs baza) i włącza koloryzację.
  const toggleReview = async () => {
    if (review) {
      setReview(false)
      setReviewFiles([])
      appBus.emit('review:toggle', { on: false })

      return
    }

    if (!folder) {
      return
    }

    const res = await window.api.gitReview(folder).catch(() => null)
    const files = (res?.files ?? []).map((f) => ({
      path: f.path,
      absPath: f.absPath,
      status: f.status as ReviewStatus
    }))

    setReviewFiles(files)
    setReview(true)
    appBus.emit('review:toggle', { on: true, count: files.length })
  }

  // Mapa abs. ścieżka → status (dla klocków grafu w trybie review).
  const reviewStatus = useMemo(() => {
    const m: Record<string, ReviewStatus> = {}

    for (const f of reviewFiles) {
      m[f.absPath] = f.status
    }

    return m
  }, [reviewFiles])

  // Wartość kontekstu gita dla klocków/edytora. blame bramkowany przez gitReady,
  // by nie odpytywać serwisu przed wgraniem kopii .git.
  const gitState: GitState = useMemo(
    () => ({
      repoRoot: folder,
      blame: gitReady ? gitBlame : 'off',
      review,
      statusByAbs: reviewStatus
    }),
    [folder, gitReady, gitBlame, review, reviewStatus]
  )

  return (
    <ThemeProvider theme={muiTheme}>
    <EditorContext.Provider value={openFile}>
    <GitContext.Provider value={gitState}>
      <Layout>
        <TopBar>
        <ProjectName>{title === 'ai-architect' ? folder.split('/').pop() || '' : title}</ProjectName>
        <div style={{ flex: 1 }} />
        <Button variant={folder ? 'text' : 'contained'} size="small" startIcon={<FolderOpenIcon />} onClick={pickAndScan}>
          {folder ? t('topbar.changeProject') : t('topbar.pickProject')}
        </Button>
        <Button size="small" startIcon={<SettingsIcon />} onClick={() => setSettingsOpen(true)}>
          {t('topbar.settings')}
        </Button>
        <Button size="small" startIcon={<CodeIcon />} onClick={() => setScriptsOpen(true)}>
          {t('topbar.scripts')}
        </Button>
        <Button size="small" startIcon={<TerminalIcon />} onClick={() => setLogsOpen(true)}>
          {t('topbar.logs')}
        </Button>
        {mode === 'graph' && (
          <Button
            size="small"
            variant={review ? 'contained' : 'outlined'}
            color={review ? 'warning' : 'primary'}
            startIcon={<RateReviewIcon />}
            onClick={toggleReview}
          >
            {review ? t('review.end') : t('review.start')}
          </Button>
        )}
      </TopBar>

      <EditorTabs
        editors={editors}
        active={activeEditor}
        minimized={minimized}
        onSelect={selectEditor}
        onClose={closeEditor}
      />

      <Content>
        <FileBrowser
          root={folder}
          version={fsVersion}
          onOpenFile={(p) => openFile(p)}
          onChanged={(p) => refreshForPath(p)}
          review={review}
          changed={reviewFiles}
        />

        <Stage id="graph-stage">
        {mode === 'graph' && graph ? (
          <GraphView
            graph={graph}
            selectedId={selectedNode?.id}
            onSelect={setSelectedNode}
            onNodeClick={(node) => {
              if (node.absFile) {
                openFile(node.absFile) // file → editor (apps are handled inline by GraphView)
              }
            }}
            onExpandApp={(appId) => expandApp(appId)}
            wallpaper={wallpaper}
            onAddElement={addElement}
            onRename={renameElement}
            onMoveFile={moveFile}
            onDelete={deleteElement}
            focusPath={focusPath}
            navKey={navKey}
          />
        ) : (
          <Empty>
            <h2>{t('empty.title')}</h2>
            {folder ? (
              <Button variant="outlined" onClick={() => scanProject(folder)}>
                {t('empty.scanLast', { folder })}
              </Button>
            ) : null}
          </Empty>
        )}
        </Stage>
      </Content>

      {mode === 'graph' && (
        <AgentBar
          onSubmit={runAsk}
          busy={agentBusy}
          reply={agentReply}
          onClearReply={() => setAgentReply('')}
        />
      )}

      <ScanModal open={mode === 'scanning'} progress={progress} log={log} error={error} />
        {editors.map((t, i) => (
          <CodeEditor
            key={t.path}
            target={t}
            index={i}
            active={activeEditor === t.path}
            onActivate={() => setActiveEditor(t.path)}
            minimized={minimized.has(t.path)}
            onMinimize={() => minimizeEditor(t.path)}
            onClose={() => closeEditor(t.path)}
            onOpen={(nt) => openFile(nt.path, nt.gotoFn, false, nt.gotoLine)}
            vim={vimOn}
            onVimChange={setVimOn}
            copilot={copilotOn}
            onCopilotChange={setCopilotOn}
            rainbow={rainbow}
            theme={editorTheme}
            root={folder}
            closing={closingEditors.has(t.path)}
            review={review}
            initialSnap={snappedTop.size > 0}
            onSnapChange={(snapped) => setEditorSnap(t.path, snapped)}
            initialGeom={layoutByPath[t.path]}
            onGeometry={onEditorGeometry}
          />
        ))}
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          theme={editorTheme}
          onThemeChange={setEditorTheme}
          wallpaper={wallpaper}
          onWallpaperChange={setWallpaper}
          accent={accent}
          onAccentChange={setAccent}
          blame={gitBlame}
          onBlameChange={setGitBlame}
          rainbow={rainbow}
          onRainbowChange={setRainbow}
        />
        <ScriptsDialog open={scriptsOpen} onClose={() => setScriptsOpen(false)} project={folder} theme={editorTheme} />
        <LogsDialog open={logsOpen} onClose={() => setLogsOpen(false)} />
        <ClaudeLoginDialog open={claudeLoginOpen} onClose={() => setClaudeLoginOpen(false)} />
        <AiAskModal ask={pendingAsk} onChoose={onAskChoose} />
        <ToastHost />
      </Layout>
    </GitContext.Provider>
    </EditorContext.Provider>
    </ThemeProvider>
  )
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
