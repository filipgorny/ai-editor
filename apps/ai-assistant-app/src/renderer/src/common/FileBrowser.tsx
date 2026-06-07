import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material'
import { colors } from '@/styles/tokens'
import { reviewColor, useGit, type ReviewStatus } from '@/common/GitContext'
import ContextMenu, { type MenuItemDef } from '@/ui/ContextMenu'
import { toast } from '@/toast'

// Plik zmieniony w trybie review (z serwisu git).
type Changed = { path: string; absPath: string; status: string }

type Entry = { name: string; path: string; dir: boolean }
type Listing = { path: string; parent: string; entries: Entry[] }

// Wpis, na którym otwarto menu kontekstowe / który jest przeciągany.
// `dir: true` z pustą ścieżką oznacza menu na pustym tle drzewka (cel = root).
type TreeItem = { path: string; name: string; dir: boolean }

// Akcje drzewka przekazywane w dół do rekurencyjnego Dir.
type TreeActions = {
  onOpenFile: (p: string) => void
  onContext: (e: ReactMouseEvent, item: TreeItem) => void
  onMove: (src: string, destDir: string) => void
}

// Tryb dialogu tworzenia nowego wpisu w wybranym katalogu.
type CreateState = { kind: 'file' | 'folder'; dir: string }

// Stały lewy panel — od paska otwartych edytorów do ramki promptu AI.
// .js-file-tree: stable handle so the editor-window snap can keep a maximized (top-snapped)
// window from ever covering the tree (see CodeEditor.sceneRect).
const Panel = styled.div.attrs({ className: 'js-file-tree' })`
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

// CNode — one node of the changed-files tree built from the flat review list.
type CNode = {
  name: string
  path: string
  dir: boolean
  status?: string
  absPath?: string
  children: CNode[]
}

// sortTree orders each level folders-first, then alphabetically.
function sortTree(node: CNode): void {
  node.children.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)))
  node.children.forEach(sortTree)
}

// buildChangedTree turns the flat changed-files list into a nested folder tree, so the
// review panel can render it like the file tree (every folder shown, fully expanded).
function buildChangedTree(changed: Changed[]): CNode[] {
  const root: CNode = { name: '', path: '', dir: true, children: [] }

  for (const c of changed) {
    const parts = c.path.split('/').filter(Boolean)
    let node = root

    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      let child = node.children.find((ch) => ch.name === part && ch.dir === !isLeaf)

      if (!child) {
        child = {
          name: part,
          path,
          dir: !isLeaf,
          status: isLeaf ? c.status : undefined,
          absPath: isLeaf ? c.absPath : undefined,
          children: []
        }

        node.children.push(child)
      }

      node = child
    })
  }

  sortTree(root)

  return root.children
}

// ChangedNode renders one changed-tree node (and its children) — folders always expanded,
// files clickable with a status dot. Mirrors the file-tree look (Row + depth indentation).
function ChangedNode({
  node,
  depth,
  onOpenFile
}: {
  node: CNode
  depth: number
  onOpenFile: (p: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  if (node.dir) {
    return (
      <>
        <Row $depth={depth} style={{ cursor: 'default' }}>
          ▾ 📁 {node.name}
        </Row>

        {node.children.map((ch) => (
          <ChangedNode key={ch.path} node={ch} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
      </>
    )
  }

  return (
    <Row
      $depth={depth}
      title={node.path + ' · ' + t('review.status.' + node.status)}
      onClick={() => node.absPath && onOpenFile(node.absPath)}
    >
      <Dot $color={reviewColor[node.status as ReviewStatus] ?? colors.muted} />
      📄 {node.name}
    </Row>
  )
}

// FileBrowser — stały lewy panel z drzewem plików (filer przez gateway). W trybie
// review pokazuje PŁASKĄ listę tylko zmienionych plików (źródło prawdy: GitContext,
// z fallbackiem na propsy review/changed dla zgodności wstecznej).
//
// Wiersze i puste tło mają menu kontekstowe (ContextMenu): na katalogu/pustym tle —
// „dodaj plik" / „dodaj folder"; na istniejącym wpisie — „zmień nazwę" / „usuń". Obsługują
// też drag & drop (przenoszenie do katalogu) przez window.api.moveFile.
//
// PROPSY DLA FAZY INTEGRACJI (App.tsx):
//  - root: string                        — folder projektu (korzeń drzewa)
//  - version: number                     — bump wymusza ponowne wczytanie listingów
//  - onOpenFile(p: string)               — otwórz plik w edytorze (App.openFile)
//  - onChanged?(path: string)            — wywoływane po move/rename/delete/create; App robi rescan
//  - review?: boolean (opcjonalny)       — fallback, gdy GitContext niedostępny
//  - changed?: Changed[] (opcjonalny)    — fallback listy zmienionych plików dla review
// Tryb review jest brany z GitContext (useGit) — props `review`/`changed` to tylko fallback;
// App nie musi przekazywać nic nowego, jeśli owija drzewo w GitContext.Provider (już to robi).
export default function FileBrowser({
  root,
  version,
  onOpenFile,
  onChanged,
  review: reviewProp = false,
  changed: changedProp = []
}: {
  root: string
  version: number
  onOpenFile: (p: string) => void
  onChanged?: (path: string) => void
  review?: boolean
  changed?: Changed[]
}) {
  const { t } = useTranslation()
  const git = useGit()
  const [base, setBase] = useState(root)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItemDef[] } | null>(null)
  const [renaming, setRenaming] = useState<TreeItem | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [creating, setCreating] = useState<CreateState | null>(null)
  const [createVal, setCreateVal] = useState('')

  // Review mode + lista zmienionych plików: źródło prawdy to GitContext; gdy provider go
  // nie dostarcza (np. testy / brak repo), wracamy do propsów.
  const review = git.review || reviewProp
  const changed: Changed[] =
    Object.keys(git.statusByAbs).length > 0
      ? Object.entries(git.statusByAbs).map(([absPath, status]) => ({
          absPath,
          path: root && absPath.startsWith(root + '/') ? absPath.slice(root.length + 1) : absPath,
          status
        }))
      : changedProp

  useEffect(() => {
    setBase(root) // zawsze folder projektu (bez fallbacku do home)
  }, [root])

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

  // startCreate otwiera dialog tworzenia pliku/folderu w wybranym katalogu (z menu
  // kontekstowego na katalogu lub na pustym tle, gdzie celem jest korzeń projektu).
  const startCreate = (kind: 'file' | 'folder', dir: string): void => {
    setMenu(null)
    setCreateVal('')
    setCreating({ kind, dir })
  }

  const confirmCreate = async (): Promise<void> => {
    const state = creating
    const name = createVal.trim()

    setCreating(null)

    if (!state || !name) {
      return
    }

    // createFile(dir, fileName, className) — pusty className = zwykły, pusty plik (bez AI).
    const res =
      state.kind === 'folder'
        ? await window.api.createFolder(state.dir, name).catch(() => '')
        : await window.api.createFile(state.dir, name, '').catch(() => '')

    if (res) {
      toast.success(t('files.created'))
      onChanged?.(res)

      if (state.kind === 'file') {
        onOpenFile(res)
      }
    } else {
      toast.error(t('files.opFailed'))
    }
  }

  // openContext buduje listę pozycji menu zależną od celu: katalog → dodaj plik/folder +
  // zmień nazwę/usuń; plik → zmień nazwę/usuń; puste tło (dir z pustą ścieżką) → tylko dodaj.
  const openContext = (e: ReactMouseEvent, item: TreeItem): void => {
    e.preventDefault()
    e.stopPropagation()
    const targetDir = item.dir ? item.path || base : base
    const isRoot = item.dir && !item.path
    const items: MenuItemDef[] = []

    if (item.dir) {
      items.push({ label: t('files.addFile'), onClick: () => startCreate('file', targetDir) })
      items.push({ label: t('files.addFolder'), onClick: () => startCreate('folder', targetDir) })
    }

    if (!isRoot) {
      items.push({ label: t('files.rename'), onClick: () => startRename(item) })
      items.push({ label: t('files.delete'), onClick: () => doDelete(item) })
    }

    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Menu na pustym tle drzewka (cel = korzeń projektu).
  const openEmptyContext = (e: ReactMouseEvent): void => {
    if (!base) {
      return
    }

    openContext(e, { path: '', name: base.split(/[\\/]/).pop() || base, dir: true })
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
            buildChangedTree(changed).map((n) => (
              <ChangedNode key={n.path} node={n} depth={0} onOpenFile={onOpenFile} />
            ))
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
      <Tree onContextMenu={openEmptyContext}>
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

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

      <Dialog open={!!creating} onClose={() => setCreating(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{creating?.kind === 'folder' ? t('files.addFolder') : t('files.addFile')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={creating?.kind === 'folder' ? t('files.newFolderPrompt') : t('files.newFilePrompt')}
            value={createVal}
            onChange={(e) => setCreateVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                confirmCreate()
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(null)}>{t('common.close')}</Button>
          <Button variant="contained" onClick={confirmCreate} disabled={!createVal.trim()}>
            {t('files.create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Panel>
  )
}
