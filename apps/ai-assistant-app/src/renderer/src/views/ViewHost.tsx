// ViewHost — renders the active view's component, passing it the ViewContext.
//
// keepMounted views (editor/terminal/browser) must NOT unmount when inactive — their
// children (terminals, webviews, editor windows) lose state on unmount. So every
// keepMounted view is rendered ALL the time, hidden with display:none when it isn't the
// active one. The single active non-keepMounted view is rendered on top of them.
//
// ctx.active tells each view whether it is currently the visible one (it's recomputed
// per view here from the active key).

import styled from 'styled-components'
import type { ViewContext, ViewDefinition, ViewKey } from './types'

const Slot = styled.div`
  flex: 1;
  position: relative;
  min-width: 0;
`

const Layer = styled.div`
  position: absolute;
  inset: 0;
`

export default function ViewHost({
  views,
  active,
  ctx
}: {
  views: ViewDefinition[]
  active: ViewKey
  ctx: ViewContext
}): React.JSX.Element {
  // keepMounted views render permanently (hidden when inactive) to preserve their state.
  const persistent = views.filter((v) => v.keepMounted)
  // The active view, when it is NOT keepMounted, is mounted on demand on top.
  const activeDef = views.find((v) => v.key === active)
  const renderActiveOnDemand = activeDef && !activeDef.keepMounted

  return (
    // id="editor-scene": stabilny uchwyt obszaru sceny, którego szuka snap okien edytora
    // (CodeEditor.sceneRect) — to jedyny zawsze obecny element pokrywający dokładnie scenę.
    <Slot id="editor-scene">
      {persistent.map((v) => {
        const isActive = v.key === active
        const viewCtx: ViewContext = { ...ctx, viewKey: v.key, active: isActive }

        return (
          <Layer key={v.key} style={{ display: isActive ? 'block' : 'none' }}>
            <v.Component ctx={viewCtx} />
          </Layer>
        )
      })}

      {renderActiveOnDemand && (
        <Layer>
          <activeDef.Component ctx={{ ...ctx, viewKey: activeDef.key, active: true }} />
        </Layer>
      )}
    </Slot>
  )
}
