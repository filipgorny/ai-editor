// ShapeEdge — the custom reactflow edge renderer. The arrow-head style (solid / empty /
// none / both) is per-edge, stored in edge.data.arrow. reactflow's built-in MarkerType
// is global-ish and awkward for hollow heads, so we render our OWN <marker> defs inline
// (one set per edge id, so styles don't collide) and reference them from the path.
//
// Lines are black on the canvas; the edge thickens slightly when selected so it is clear
// which connection is targeted by the arrow-style panel.

import { memo } from 'react'
import { BaseEdge, getStraightPath, type EdgeProps } from 'reactflow'
import type { ShapeEdgeData } from './types'

function ShapeEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected
}: EdgeProps<ShapeEdgeData>): React.JSX.Element {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const arrow = data?.arrow ?? 'solid'

  const headId = `dep-head-${id}`
  const tailId = `dep-tail-${id}`

  const wantsHead = arrow === 'solid' || arrow === 'empty' || arrow === 'both'
  const wantsTail = arrow === 'both'
  const hollow = arrow === 'empty'

  // markerEnd points at the target end; markerStart (only for 'both') at the source end.
  const markerEnd = wantsHead ? `url(#${headId})` : undefined
  const markerStart = wantsTail ? `url(#${tailId})` : undefined

  const color = '#000'
  const fill = hollow ? '#fff' : color

  return (
    <>
      <defs>
        {wantsHead && (
          <marker
            id={headId}
            markerWidth={12}
            markerHeight={12}
            refX={9}
            refY={5}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L10,5 L0,10 Z" fill={fill} stroke={color} strokeWidth={1} />
          </marker>
        )}

        {wantsTail && (
          <marker
            id={tailId}
            markerWidth={12}
            markerHeight={12}
            refX={1}
            refY={5}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M10,0 L0,5 L10,10 Z" fill={color} stroke={color} strokeWidth={1} />
          </marker>
        )}
      </defs>

      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{ stroke: color, strokeWidth: selected ? 2.5 : 1.5 }}
      />
    </>
  )
}

export const ShapeEdge = memo(ShapeEdgeImpl)
