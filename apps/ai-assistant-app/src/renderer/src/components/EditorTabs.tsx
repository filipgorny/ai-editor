import styled from 'styled-components'
import CloseIcon from '@mui/icons-material/Close'
import { colors } from '../styles/tokens'
import type { EditorTarget } from './CodeEditor'

const Bar = styled.div`
  display: flex;
  gap: 4px;
  padding: 4px 8px;
  background: ${colors.panel};
  border-bottom: 1px solid ${colors.border};
  overflow-x: auto;
`

const Tab = styled.div<{ $active: boolean; $min: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-family: monospace;
  white-space: nowrap;
  border: 1px solid #ffffff;
  background: ${(p) => (p.$active ? '#2b2b2b' : '#000000')};
  color: ${(p) => (p.$min ? colors.muted : '#ffffff')};
  opacity: ${(p) => (p.$min ? 0.65 : 1)};
`

// close icon shows only on hover so clicking a (small) tab restores it instead of
// accidentally closing it
const Close = styled.span`
  display: inline-flex;
  align-items: center;
  opacity: 0;

  ${Tab}:hover & {
    opacity: 0.75;
  }
`

const base = (p: string): string => p.split(/[\\/]/).pop() || p

// EditorTabs — pasek otwartych plików (auto-odświeżany ze stanu), przełączanie,
// zamykanie. Zminimalizowane okna pokazują się tu wyszarzone.
export default function EditorTabs({
  editors,
  active,
  minimized,
  onSelect,
  onClose
}: {
  editors: EditorTarget[]
  active: string
  minimized: Set<string>
  onSelect: (path: string) => void
  onClose: (path: string) => void
}) {
  if (!editors.length) {
    return null
  }

  return (
    <Bar>
      {editors.map((t) => (
        <Tab
          key={t.path}
          $active={active === t.path}
          $min={minimized.has(t.path)}
          onClick={() => onSelect(t.path)}
          title={t.path}
        >
          {minimized.has(t.path) ? '▢ ' : ''}
          {base(t.path)}
          <Close>
            <CloseIcon
              sx={{ fontSize: 14 }}
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.path)
              }}
            />
          </Close>
        </Tab>
      ))}
    </Bar>
  )
}
