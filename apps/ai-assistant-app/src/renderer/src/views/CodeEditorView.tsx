// CodeEditorView — the code-editor view (ViewKey 'editor').
//
// The floating CodeEditor windows themselves are position:fixed and owned/rendered by
// App at the root level (they must survive view switches, so App keeps them mounted and
// gates their visibility on the active view). This view therefore only renders the
// backdrop that sits BEHIND those windows: the wallpaper, plus an empty-state hint when
// no editor is open. Keeping the windows at root and the backdrop here mirrors the old
// behaviour where the graph Stage hosted the wallpaper.

import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import type { ViewContext } from './types'
import { colors } from '../styles/tokens'

const Backdrop = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
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

export default function CodeEditorView({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()

  // Visible editors = open windows that aren't minimized; an all-minimized set still
  // counts as "something open", so we key the empty state on the editor list length.
  const hasEditors = ctx.editors.length > 0

  // Dark overlay over the wallpaper so the placeholder text stays readable — same
  // treatment the graph view applies to its background.
  const backgroundImage = ctx.wallpaper
    ? `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url("${ctx.wallpaper}")`
    : undefined

  return (
    <Backdrop style={{ backgroundImage }}>
      {!hasEditors && (
        <Empty>
          <h2>{t('views.empty')}</h2>
        </Empty>
      )}
    </Backdrop>
  )
}
