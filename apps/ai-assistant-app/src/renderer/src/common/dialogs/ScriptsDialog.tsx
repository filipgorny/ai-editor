import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TextField,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  FormControlLabel,
  Switch,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  Tooltip
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CloseIcon from '@mui/icons-material/Close'
import { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import styled from 'styled-components'
import { colors } from '@/styles/tokens'
import CodeMirrorEditor from '@/common/editor/CodeMirrorEditor'
import { copilotField, copilotKeymap, setCopilot } from '@/common/editor/copilot'
import { buildScriptContext } from '@/lua/scriptContext'

// stripOverlap drops the part of a suggestion already typed on the current line.
function stripOverlap(before: string, sugg: string): string {
  const line = before.slice(before.lastIndexOf('\n') + 1)
  const max = Math.min(line.length, sugg.length)

  for (let k = max; k > 0; k--) {
    if (sugg.startsWith(line.slice(line.length - k))) {
      return sugg.slice(k)
    }
  }

  return sugg
}

// Draft — the script being edited. id === 0 means an unsaved (new) script.
type Draft = { id: number; name: string; content: string; project: string }

const empty = (): Draft => ({ id: 0, name: '', content: '', project: '' })

const snapOf = (d: Draft): string =>
  JSON.stringify({ id: d.id, name: d.name.trim(), content: d.content, project: d.project })

const WIN_W = Math.min(1400, Math.round(window.innerWidth * 0.94))
const WIN_H = Math.round(window.innerHeight * 0.8)

// Floating, draggable window (same chrome idea as the file editor windows).
const Win = styled.div`
  position: fixed;
  display: flex;
  flex-direction: column;
  background: #000;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.65);
  z-index: 1400;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${colors.border};
  cursor: move;
`

const HeaderTitle = styled.div`
  flex: 1;
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
`

const Body = styled.div`
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
  padding: 12px;
`

const Sidebar = styled.div`
  flex: 0 0 240px;
  display: flex;
  flex-direction: column;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  overflow: hidden;
`

const SideHead = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 8px;
  border-bottom: 1px solid ${colors.border};
`

const Editor = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
`

const CodeWrap = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid ${colors.border};
  border-radius: 8px;
`

// Red banner shown above the editor when the script has a Lua syntax error.
const ErrorBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(248, 81, 73, 0.14);
  border: 1px solid #f85149;
  color: #f85149;
  font-family: Hack, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
`

// ScriptsDialog — a movable window to manage user scripts (name + content + optional project),
// stored in the scripting service. Scripts are Lua, edited in the shared CodeMirror editor, and
// saved automatically when focus leaves the editor / on switching scripts / on close.
export default function ScriptsDialog({
  open,
  onClose,
  project,
  theme = 'Czarny (domyślny)'
}: {
  open: boolean
  onClose: () => void
  project: string // current project folder ('' when none) — used to pin/list scripts
  theme?: string // editor color theme (shared with the file editors)
}) {
  const { t } = useTranslation()
  const [scripts, setScripts] = useState<Script[]>([])
  const [filter, setFilter] = useState<'all' | 'project' | 'global'>('all')
  const [draft, setDraft] = useState<Draft>(empty())
  const [copilot, setCopilotOn] = useState(true)
  const [syntaxError, setSyntaxError] = useState<{ line: number; message: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  // Scripting API reference fed to copilot so completions know the available events/commands.
  const context = useMemo(() => buildScriptContext(), [])
  const [pos, setPos] = useState({
    x: Math.round((window.innerWidth - WIN_W) / 2),
    y: Math.round((window.innerHeight - WIN_H) / 2)
  })
  const loaded = useRef(false)
  // Latest draft + autosave fn, so the (once-created) CodeMirror blur handler stays fresh.
  const draftRef = useRef(draft)
  const lastSaved = useRef('') // snapshot of the last persisted draft (skips redundant saves)
  const autosaveRef = useRef<() => Promise<void>>(async () => {})

  const reloadList = async (): Promise<Script[]> => {
    const list = await window.api.listScripts('') // manager loads ALL scripts; filtered in the UI

    setScripts(list)

    return list
  }

  // applyScripts re-runs all active scripts (global + current project) so edits/new/deleted
  // scripts take effect immediately: the Lua runtime is reset and every script re-registers its
  // listeners (on/onKey/…). Without this, a freshly saved script wouldn't react until restart.
  const applyScripts = async (): Promise<void> => {
    try {
      const list = await window.api.listScripts(project)
      const { runLuaSource, disposeLua } = await import('@/lua/runtime')

      await disposeLua()

      for (const s of list) {
        await runLuaSource(s.content)
      }
    } catch {
      // a bad script shouldn't break the manager
    }
  }

  useEffect(() => {
    if (!open) {
      loaded.current = false

      return
    }

    if (loaded.current) {
      return
    }

    loaded.current = true
    reloadList().catch(() => setToast({ msg: t('scripts.loadError'), ok: false }))
  }, [open])

  // loadDraft swaps the edited script and resets the "last saved" snapshot to it.
  const loadDraft = (d: Draft): void => {
    setDraft(d)
    lastSaved.current = snapOf(d)
  }

  // autosave persists the current draft when it has a name and actually changed.
  const autosave = async (): Promise<void> => {
    const d = draftRef.current

    if (!d.name.trim() || snapOf(d) === lastSaved.current) {
      return
    }

    lastSaved.current = snapOf(d)

    try {
      const saved = await window.api.saveScript({
        id: d.id || undefined,
        name: d.name.trim(),
        content: d.content,
        project: d.project
      })

      await reloadList()

      if (d.id === 0) {
        lastSaved.current = snapOf({ ...d, id: saved.id })
        setDraft((cur) => (cur.id === 0 && cur.name.trim() === saved.name ? { ...cur, id: saved.id } : cur))
      }

      await applyScripts() // activate the saved change (re-register listeners) right away
    } catch {
      setToast({ msg: t('scripts.saveFailed'), ok: false })
    }
  }

  draftRef.current = draft
  autosaveRef.current = autosave

  const select = async (s: Script): Promise<void> => {
    await autosave()
    loadDraft({ id: s.id, name: s.name, content: s.content, project: s.project })
  }

  const newDraft = async (): Promise<void> => {
    await autosave()
    loadDraft(empty())
  }

  const remove = async (e: ReactMouseEvent, id: number): Promise<void> => {
    e.stopPropagation()

    if (!window.confirm(t('scripts.deleteConfirm'))) {
      return
    }

    await window.api.deleteScript(id).catch(() => undefined)
    await reloadList()
    await applyScripts() // drop the deleted script's listeners

    if (draft.id === id) {
      loadDraft(empty())
    }
  }

  // run executes the draft content via the Lua runtime (lazy-loaded with the WASM engine).
  const run = async (): Promise<void> => {
    try {
      const { runLuaSource } = await import('@/lua/runtime')

      await runLuaSource(draft.content)
      setToast({ msg: t('scripts.ran'), ok: true })
    } catch (err) {
      setToast({ msg: t('scripts.runError', { message: String((err as Error)?.message || err) }), ok: false })
    }
  }

  const handleClose = async (): Promise<void> => {
    await autosave()
    onClose()
  }

  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const start = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }

    const move = (ev: MouseEvent): void => {
      setPos({ x: start.px + ev.clientX - start.mx, y: start.py + ev.clientY - start.my })
    }

    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Editor extensions: copilot ghost suggestions (Tab accepts) + autosave-on-blur. Created
  // once — the blur handler reads the live autosave via ref.
  const editorExt = useMemo(
    () => [
      copilotKeymap,
      copilotField,
      EditorView.domEventHandlers({
        blur: () => {
          void autosaveRef.current()

          return false
        }
      })
    ],
    []
  )

  // Copilot: after a pause in typing, ask the AI to complete at the cursor — primed with the
  // scripting API context — and show it as a ghost (Tab inserts). Off when the toggle is off.
  useEffect(() => {
    if (!open || !copilot) {
      cmRef.current?.view?.dispatch({ effects: setCopilot.of(null) })

      return
    }

    const id = window.setTimeout(() => {
      const view = cmRef.current?.view

      if (!view || !view.hasFocus) {
        return
      }

      const p = view.state.selection.main.head
      const prefix = view.state.doc.sliceString(0, p)
      const suffix = view.state.doc.sliceString(p)

      window.api
        .aiComplete(context + '\n' + prefix, suffix, 'script.lua')
        .then((raw) => {
          const vv = cmRef.current?.view
          const text = stripOverlap(prefix, raw)

          if (vv && vv.state.selection.main.head === p && text && text.trim()) {
            vv.dispatch({ effects: setCopilot.of({ from: p, text }) })
          }
        })
        .catch(() => undefined)
    }, 600)

    return () => window.clearTimeout(id)
  }, [draft.content, open, copilot, context])

  // Live Lua syntax validation → red banner. Compiles (no run) via the validator engine.
  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    const id = window.setTimeout(async () => {
      try {
        const { validateLua } = await import('@/lua/runtime')
        const err = await validateLua(draft.content)

        if (!cancelled) {
          setSyntaxError(err)
        }
      } catch {
        if (!cancelled) {
          setSyntaxError(null)
        }
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [draft.content, open])

  if (!open) {
    return null
  }

  const visible = scripts.filter((s) =>
    filter === 'all' ? true : filter === 'global' ? !s.project : s.project === project
  )

  return (
    <>
      <Win style={{ left: pos.x, top: pos.y, width: WIN_W, height: WIN_H }}>
        <Header onMouseDown={startDrag}>
          <HeaderTitle>{t('scripts.title')}</HeaderTitle>
          <FormControlLabel
            onMouseDown={(e) => e.stopPropagation()}
            sx={{ mr: 0.5, '.MuiFormControlLabel-label': { fontSize: 12, color: '#8b949e' } }}
            control={<Switch size="small" checked={copilot} onChange={(e) => setCopilotOn(e.target.checked)} />}
            label="Copilot"
          />
          <Tooltip title={t('scripts.run')}>
            <span>
              <IconButton
                size="small"
                color="success"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={run}
                disabled={!draft.content.trim()}
              >
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onMouseDown={(e) => e.stopPropagation()} onClick={handleClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Header>

        <Body>
          <Sidebar>
            <SideHead>
              <Select
                size="small"
                value={filter}
                onChange={(e) => setFilter(e.target.value as 'all' | 'project' | 'global')}
                sx={{ flex: 1, fontSize: 13, '.MuiSelect-select': { py: 0.5 } }}
              >
                <MenuItem value="all">{t('scripts.filterAll')}</MenuItem>
                <MenuItem value="project" disabled={!project}>
                  {t('scripts.filterProject')}
                </MenuItem>
                <MenuItem value="global">{t('scripts.filterGlobal')}</MenuItem>
              </Select>
              <Tooltip title={t('scripts.new')}>
                <IconButton size="small" onClick={newDraft}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </SideHead>
            <List dense sx={{ overflow: 'auto', flex: 1, py: 0 }}>
              {visible.map((s) => (
                <ListItemButton key={s.id} selected={draft.id === s.id} onClick={() => select(s)}>
                  <ListItemText
                    primary={s.name || t('scripts.untitled')}
                    secondary={s.project ? s.project.split(/[\\/]/).pop() : t('scripts.global')}
                    primaryTypographyProps={{ noWrap: true, fontSize: 14 }}
                    secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
                  />
                  <IconButton size="small" onClick={(e) => remove(e, s.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              ))}
            </List>
          </Sidebar>

          <Editor>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TextField
                label={t('scripts.name')}
                size="small"
                fullWidth
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onBlur={() => void autosave()}
              />
              <FormControlLabel
                sx={{
                  ml: 0.5,
                  whiteSpace: 'nowrap',
                  '.MuiFormControlLabel-label': {
                    fontSize: 13,
                    color: !!project && draft.project === project ? 'primary.main' : 'text.secondary'
                  }
                }}
                control={
                  <Switch
                    size="small"
                    checked={!!project && draft.project === project}
                    disabled={!project}
                    onChange={(e) => setDraft((d) => ({ ...d, project: e.target.checked ? project : '' }))}
                  />
                }
                label={t('scripts.attachOnly')}
              />
            </div>
            {syntaxError && (
              <ErrorBanner>⛔ {t('scripts.syntaxError', { line: syntaxError.line, message: syntaxError.message })}</ErrorBanner>
            )}
            <CodeWrap>
              <CodeMirrorEditor
                ref={cmRef}
                value={draft.content}
                onChange={(v) => setDraft((d) => ({ ...d, content: v }))}
                theme={theme}
                ruler={null}
                placeholder={t('scripts.placeholder')}
                extra={editorExt}
              />
            </CodeWrap>
          </Editor>
        </Body>
      </Win>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.ok ? 'success' : 'error'} variant="filled" onClose={() => setToast(null)}>
            {toast.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  )
}
