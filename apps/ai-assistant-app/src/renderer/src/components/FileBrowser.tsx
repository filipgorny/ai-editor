import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material'
import { colors } from '../styles/tokens'
import { reviewColor, type ReviewStatus } from './GitContext'
import { toast } from '../toast'

// Plik zmieniony w trybie review (z serwisu git).
type Changed = { path: string; absPath: string; status: string }

type Entry = { name: string; path: string; dir: boolean }
type Listing = { path: string; parent: string; entries: Entry[] }

// Wpis, na którym otwarto menu kontekstowe / który jest przeciągany.
type TreeItem = { path: string; name: string; dir: boolean }

// Akcje drzewka przekazywane w dół do rekurencyjnego Dir.
type TreeActions = {
  onOpenFile: (p: string) => void
  onContext: (e: ReactMouseEvent, item: TreeItem) => void
  onMove: (src: string, destDir: string) => void
}

// Stały lewy panel — od paska otwartych edytorów do ramki promptu AI.
const Panel = styled.div`
  flex: 0 0 380px;
  display: flex;
  flex-direction: column;
  background: #0b0e13;
  border-right: 1px solid ${colors.border};
  min-height: 0;
`

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border};
  font-family: 'Hack', monospace;
  font-size: 18px;
  color: ${colors.muted};
`

const Tree = styled.div`
  flex: 1;
  overflow: auto;
  padding: 6px 0;
`

const Row = styled.div<{ $depth: number; $drop?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  padding-left: ${(p) => 8 + p.$depth * 14}px;
  font-family: 'Hack', monospace;
  font-size: 17px;
  color: #e6edf3;
  white-space: nowrap;
  cursor: pointer;
  background: ${(p) => (p.$drop ? 'rgba(56, 139, 253, 0.25)' : 'transparent')};
  outline: ${(p) => (p.$drop ? `1px solid ${colors.border}` : 'none')};

  &:hover {
    background: ${(p) => (p.$drop ? 'rgba(56, 139, 253, 0.25)' : 'rgba(255, 255, 255, 0.06)')};
  }
`

// Dir — katalog w drzewku; dzieci ładowane leniwie z filera (przez gateway).
// Jest też celem upuszczenia (drop) przy przenoszeniu plików.
function Dir({
  path,
  name,
  depth,
  open: openInit,
  version,
  actions
}: {
  path: string
  name: string
  depth: number
  open?: boolean
  version: number
  actions: TreeActions
}) {
  const [open, setOpen] = useState(!!openInit)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    if (open) {
      window.api.fsList(path).then((r) => setEntries((r as Listing).entries ?? []))
    }
  }, [open, version, path])

  return (
    <>
      <Row
        $depth={depth}
        $drop={dragOver}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData('text/plain', path)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(false)
          const src = e.dataTransfer.getData('text/plain')

          if (src) {
            actions.onMove(src, path)
          }
        }}
        onContextMenu={(e) => actions.onContext(e, { path, name, dir: true })}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} 📁 {name}
      </Row>
      {open &&
        entries?.map((e) =>
          e.dir ? (
            <Dir key={e.path} path={e.path} name={e.name} depth={depth + 1} version={version} actions={actions} />
          ) : (
            <Row
              key={e.path}
              $depth={depth + 1}
              draggable
              onDragStart={(ev) => {
                ev.stopPropagation()
                ev.dataTransfer.setData('text/plain', e.path)
                ev.dataTransfer.effectAllowed = 'move'
              }}
              onContextMenu={(ev) => actions.onContext(ev, { path: e.path, name: e.name, dir: false })}
              onClick={() => actions.onOpenFile(e.path)}
            >
              📄 {e.name}
            </Row>
          )
        )}
    </>
  )
}

// ChangedRow — wiersz pliku w trybie review (kropka statusu + ścieżka).
const ChangedRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  font-family: 'Hack', monospace;
  font-size: 15px;
  color: #e6edf3;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
`

const Dot = styled.span<{ $color: string }>`
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: ${(p) => p.$color};
`

const Dir2 = styled.span`
  color: ${colors.muted};
`

// FileBrowser — stały lewy panel z drzewem plików (filer przez gateway). W trybie
// review pokazuje PŁASKĄ listę tylko zmienionych plików (z serwisu git). Wiersze mają
// menu kontekstowe (Zmień nazwę / Usuń) i obsługują drag & drop (przenoszenie do katalogu).
export default function FileBrowser({
  root,
  version,
  onOpenFile,
  onChanged,
  review = false,
  changed = []
}: {
  root: string
  version: number
  onOpenFile: (p: string) => void
  onChanged?: (path: string) => void
  review?: boolean
  changed?: Changed[]
}) {
  const { t } = useTranslation()
  const [base, setBase] = useState(root)
  const [menu, setMenu] = useState<{ x: number; y: number; item: TreeItem } | null>(null)
  const [renaming, setRenaming] = useState<TreeItem | null>(null)
  const [renameVal, setRenameVal] = useState('')

  useEffect(() => {
    setBase(root) // zawsze folder projektu (bez fallbacku do home)
  }, [root])

  const openContext = (e: ReactMouseEvent, item: TreeItem): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }

  const doMove = async (src: string, destDir: string): Promise<void> => {
    const parent = src.slice(0, src.lastIndexOf('/'))

    // pomiń: brak źródła, ten sam katalog, upuszczenie na samego siebie / w głąb siebie
    if (!src || src === destDir || parent === destDir || destDir === src || destDir.startsWith(src + '/')) {
      return
    }

    const res = await window.api.moveFile(src, destDir).catch(() => '')

    if (res) {
      toast.success(t('files.moved'))
      onChanged?.(res)
    } else {
      toast.error(t('files.opFailed'))
    }
  }

  // startRename otwiera dialog (window.prompt nie działa w Electronie). Dla pliku
  // proponuje nazwę bez rozszerzenia — filer zachowuje oryginalne rozszerzenie.
  const startRename = (item: TreeItem): void => {
    setMenu(null)
    setRenameVal(item.dir ? item.name : item.name.replace(/\.[^./]+$/, ''))
    setRenaming(item)
  }

  const confirmRename = async (): Promise<void> => {
    const item = renaming
    const newBase = renameVal.trim()

    setRenaming(null)

    if (!item || !newBase) {
      return
    }

    const res = await window.api.renameFile(item.path, newBase, '', '').catch(() => '')

    if (res) {
      toast.success(t('files.renamed'))
      onChanged?.(res)
    } else {
      toast.error(t('files.opFailed'))
    }
  }

  const doDelete = async (item: TreeItem): Promise<void> => {
    setMenu(null)

    if (!window.confirm(t('files.deleteConfirm', { name: item.name }))) {
      return
    }

    const ok = await window.api.deleteFile(item.path).catch(() => false)

    if (ok) {
      toast.success(t('files.deleted'))
      onChanged?.(item.path)
    } else {
      toast.error(t('files.opFailed'))
    }
  }

  if (review) {
    return (
      <Panel>
        <Head>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t('review.changedFiles', { count: changed.length })}
          </span>
        </Head>
        <Tree>
          {changed.length === 0 ? (
            <ChangedRow style={{ color: colors.muted, cursor: 'default' }}>{t('review.noChanges')}</ChangedRow>
          ) : (
            changed.map((c) => {
              const slash = c.path.lastIndexOf('/')
              const dir = slash >= 0 ? c.path.slice(0, slash + 1) : ''
              const name = slash >= 0 ? c.path.slice(slash + 1) : c.path

              return (
                <ChangedRow
                  key={c.absPath}
                  title={c.path + ' · ' + t('review.status.' + c.status)}
                  onClick={() => onOpenFile(c.absPath)}
                >
                  <Dot $color={reviewColor[c.status as ReviewStatus] ?? colors.muted} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Dir2>{dir}</Dir2>
                    {name}
                  </span>
                </ChangedRow>
              )
            })
          )}
        </Tree>
      </Panel>
    )
  }

  return (
    <Panel>
      <Head>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{base || t('files.fallback')}</span>
      </Head>
      <Tree>
        {base ? (
          <Dir
            key={base}
            path={base}
            name={base.split(/[\\/]/).pop() || base}
            depth={0}
            open
            version={version}
            actions={{ onOpenFile, onContext: openContext, onMove: doMove }}
          />
        ) : null}
      </Tree>

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
      >
        <MenuItem onClick={() => menu && startRename(menu.item)}>{t('files.rename')}</MenuItem>
        <MenuItem onClick={() => menu && doDelete(menu.item)}>{t('files.delete')}</MenuItem>
      </Menu>

      <Dialog open={!!renaming} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('files.rename')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('files.renamePrompt')}
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                confirmRename()
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>{t('common.close')}</Button>
          <Button variant="contained" onClick={confirmRename} disabled={!renameVal.trim()}>
            {t('files.rename')}
          </Button>
        </DialogActions>
      </Dialog>
    </Panel>
  )
}
