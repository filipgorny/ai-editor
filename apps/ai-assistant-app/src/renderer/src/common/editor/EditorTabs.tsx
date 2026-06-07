import styled from 'styled-components'
import CloseIcon from '@mui/icons-material/Close'
import ClearAllIcon from '@mui/icons-material/ClearAll'
import { useTranslation } from 'react-i18next'
import { colors } from '@/styles/tokens'
import type { EditorTarget } from '@/common/editor/CodeEditor'

const Bar = styled.div`
  display: flex;
  padding: 4px 8px;
  background: ${colors.panel};
  border-bottom: 1px solid ${colors.border};
  overflow-x: auto;
`

// Tabs are separated only by a thin vertical rule (no boxed background/border).
// The active tab is signalled by a stronger label color + a subtle bottom accent.
const Tab = styled.div<{ $active: boolean; $min: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px;
  cursor: pointer;
  font-size: 13px;
  font-family: 'Hack', monospace;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? colors.controller : 'transparent')};
  color: ${(p) => (p.$min ? colors.muted : p.$active ? '#ffffff' : colors.muted)};
  opacity: ${(p) => (p.$min ? 0.65 : 1)};

  & + & {
    border-left: 1px solid ${colors.border};
  }

  &:hover {
    color: #ffffff;
  }
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

// Clear button pinned at the very end of the strip: closes every open window. Styled like a
// tab but with a danger-tinted hover so it reads as a destructive action.
const ClearBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 2px 12px;
  cursor: pointer;
  font-size: 13px;
  font-family: 'Hack', monospace;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-left: 1px solid ${colors.border};
  color: ${colors.muted};

  &:hover {
    color: #f85149;
  }
`

const base = (p: string): string => p.split(/[\\/]/).pop() || p

// EditorTabs — strip of open files (kept in sync with state): select + close.
// Minimized windows appear here greyed out. Tabs are flat labels divided only by
// thin vertical rules (no boxed tab backgrounds), rendered in the Hack font.
export default function EditorTabs({
  editors,
  active,
  minimized,
  onSelect,
  onClose,
  onClearAll
}: {
  editors: EditorTarget[]
  active: string
  minimized: Set<string>
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onClearAll: () => void
}) {
  const { t: tr } = useTranslation()

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

      <ClearBtn type="button" onClick={onClearAll} title={tr('editor.clearTabsTitle')}>
        <ClearAllIcon sx={{ fontSize: 15 }} />
        {tr('editor.clearTabs')}
      </ClearBtn>
    </Bar>
  )
}
