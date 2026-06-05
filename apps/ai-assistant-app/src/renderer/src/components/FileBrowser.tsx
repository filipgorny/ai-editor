import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { colors } from '../styles/tokens'

type Entry = { name: string; path: string; dir: boolean }
type Listing = { path: string; parent: string; entries: Entry[] }

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
  font-family: monospace;
  font-size: 18px;
  color: ${colors.muted};
`

const Tree = styled.div`
  flex: 1;
  overflow: auto;
  padding: 6px 0;
`

const Row = styled.div<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  padding-left: ${(p) => 8 + p.$depth * 14}px;
  font-family: monospace;
  font-size: 17px;
  color: #e6edf3;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
`

// Dir — katalog w drzewku; dzieci ładowane leniwie z filera (przez gateway).
function Dir({
  path,
  name,
  depth,
  open: openInit,
  version,
  onOpenFile
}: {
  path: string
  name: string
  depth: number
  open?: boolean
  version: number
  onOpenFile: (p: string) => void
}) {
  const [open, setOpen] = useState(!!openInit)
  const [entries, setEntries] = useState<Entry[] | null>(null)

  useEffect(() => {
    if (open) {
      window.api.fsList(path).then((r) => setEntries((r as Listing).entries ?? []))
    }
  }, [open, version, path])

  return (
    <>
      <Row $depth={depth} onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} 📁 {name}
      </Row>
      {open &&
        entries?.map((e) =>
          e.dir ? (
            <Dir key={e.path} path={e.path} name={e.name} depth={depth + 1} version={version} onOpenFile={onOpenFile} />
          ) : (
            <Row key={e.path} $depth={depth + 1} onClick={() => onOpenFile(e.path)}>
              📄 {e.name}
            </Row>
          )
        )}
    </>
  )
}

// FileBrowser — stały lewy panel z drzewem plików (filer przez gateway).
export default function FileBrowser({
  root,
  version,
  onOpenFile
}: {
  root: string
  version: number
  onOpenFile: (p: string) => void
}) {
  const { t } = useTranslation()
  const [base, setBase] = useState(root)

  useEffect(() => {
    setBase(root) // zawsze folder projektu (bez fallbacku do home)
  }, [root])

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
            onOpenFile={(p) => onOpenFile(p)}
          />
        ) : null}
      </Tree>
    </Panel>
  )
}
