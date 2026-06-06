// ViewRail — the left vertical icon strip, sitting to the LEFT of the file tree.
// Each registered view is one icon button with a tooltip (its i18n title key). The
// active view is highlighted. Clicking a view asks App to switch to it.

import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Tooltip } from '@mui/material'
import type { ViewDefinition, ViewKey } from './types'
import { colors } from '../styles/tokens'

const Rail = styled.nav`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  background: ${colors.panel};
  border-right: 1px solid ${colors.border};
`

const RailButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: ${(p) => (p.$active ? '#fff' : colors.muted)};
  background: ${(p) => (p.$active ? 'var(--accent, ' + colors.controller + ')' : 'transparent')};
  transition:
    background 0.12s ease,
    color 0.12s ease;

  &:hover {
    color: #fff;
    background: ${(p) => (p.$active ? 'var(--accent, ' + colors.controller + ')' : colors.border)};
  }
`

export default function ViewRail({
  views,
  active,
  onSelect
}: {
  views: ViewDefinition[]
  active: ViewKey
  onSelect: (key: ViewKey) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Rail>
      {views.map((v) => {
        const isActive = v.key === active

        return (
          <Tooltip key={v.key} title={t(v.titleKey)} placement="right">
            <RailButton
              $active={isActive}
              aria-label={t(v.titleKey)}
              aria-pressed={isActive}
              onClick={() => onSelect(v.key)}
            >
              <v.Icon fontSize="small" />
            </RailButton>
          </Tooltip>
        )
      })}
    </Rail>
  )
}
