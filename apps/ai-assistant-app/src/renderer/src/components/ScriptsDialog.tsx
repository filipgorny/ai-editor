import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
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
import styled from 'styled-components'
import { colors } from '../styles/tokens'

// Draft — the script being edited. id === 0 means an unsaved (new) script.
type Draft = { id: number; name: string; content: string; project: string }

const empty = (): Draft => ({ id: 0, name: '', content: '', project: '' })

const Body = styled.div`
  display: flex;
  gap: 12px;
  height: 60vh;
  min-height: 360px;
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
  justify-content: space-between;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid ${colors.border};
  font-size: 13px;
  color: ${colors.muted};
`

const Editor = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
`

const Code = styled.textarea`
  flex: 1;
  resize: none;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  color: #e6edf3;
  font-family: Hack, monospace;
  font-size: 14px;
  line-height: 1.5;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

// ScriptsDialog — manage user scripts stored in the scripting service (name + content +
// optional project). Scripts are written in Lua and run via the in-app Lua runtime.
export default function ScriptsDialog({
  open,
  onClose,
  project
}: {
  open: boolean
  onClose: () => void
  project: string // current project folder ('' when none) — used to pin/list scripts
}) {
  const { t } = useTranslation()
  const [scripts, setScripts] = useState<Script[]>([])
  const [filter, setFilter] = useState<'all' | 'project' | 'global'>('all')
  const [draft, setDraft] = useState<Draft>(empty())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const loaded = useRef(false)

  const reload = async () => {
    const list = await window.api.listScripts('') // manager shows ALL scripts

    setScripts(list)

    return list
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
    reload().catch(() => setToast({ msg: t('scripts.loadError'), ok: false }))
  }, [open])

  const select = (s: Script) => {
    setDraft({ id: s.id, name: s.name, content: s.content, project: s.project })
  }

  const save = async () => {
    if (!draft.name.trim()) {
      setToast({ msg: t('scripts.needName'), ok: false })

      return
    }

    setBusy(true)

    try {
      const saved = await window.api.saveScript({
        id: draft.id || undefined,
        name: draft.name.trim(),
        content: draft.content,
        project: draft.project
      })

      const list = await reload()

      select(list.find((s) => s.id === saved.id) ?? saved)
      setToast({ msg: t('scripts.saved'), ok: true })
    } catch {
      setToast({ msg: t('scripts.saveFailed'), ok: false })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()

    if (!window.confirm(t('scripts.deleteConfirm'))) {
      return
    }

    await window.api.deleteScript(id).catch(() => undefined)
    await reload()

    if (draft.id === id) {
      setDraft(empty())
    }
  }

  // run executes the draft content via the Lua runtime (lazy-loaded with the WASM engine).
  const run = async () => {
    setBusy(true)

    try {
      const { runLuaSource } = await import('../lua/runtime')

      await runLuaSource(draft.content)
      setToast({ msg: t('scripts.ran'), ok: true })
    } catch (err) {
      setToast({ msg: t('scripts.runError', { message: String((err as Error)?.message || err) }), ok: false })
    } finally {
      setBusy(false)
    }
  }

  // Filtered view of the loaded scripts. 'project' = pinned to the open project; 'global' = no project.
  const visible = scripts.filter((s) =>
    filter === 'all' ? true : filter === 'global' ? !s.project : s.project === project
  )

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>{t('scripts.title')}</DialogTitle>
        <DialogContent>
          <Body>
            <Sidebar>
              <SideHead>
                <span>{t('scripts.listHeader', { count: visible.length })}</span>
                <Tooltip title={t('scripts.new')}>
                  <IconButton size="small" onClick={() => setDraft(empty())}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </SideHead>
              <Select
                size="small"
                value={filter}
                onChange={(e) => setFilter(e.target.value as 'all' | 'project' | 'global')}
                sx={{ m: 1, fontSize: 13, '.MuiSelect-select': { py: 0.5 } }}
              >
                <MenuItem value="all">{t('scripts.filterAll')}</MenuItem>
                <MenuItem value="project" disabled={!project}>
                  {t('scripts.filterProject')}
                </MenuItem>
                <MenuItem value="global">{t('scripts.filterGlobal')}</MenuItem>
              </Select>
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
                />
                <FormControlLabel
                  sx={{
                    ml: 0.5,
                    whiteSpace: 'nowrap',
                    '.MuiFormControlLabel-label': {
                      fontSize: 13,
                      // blue when attached to this project, muted otherwise
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
              <Code
                spellCheck={false}
                placeholder={t('scripts.placeholder')}
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              />
            </Editor>
          </Body>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Button
            startIcon={<PlayArrowIcon />}
            onClick={run}
            disabled={busy || !draft.content.trim()}
            color="success"
          >
            {t('scripts.run')}
          </Button>
          <span>
            <Button onClick={onClose}>{t('common.close')}</Button>
            <Button variant="contained" onClick={save} disabled={busy}>
              {t('editor.save')}
            </Button>
          </span>
        </DialogActions>
      </Dialog>

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
