// ShapeNode — the custom reactflow node renderer shared by all three shape kinds.
//
// Shapes are strictly black & white: white fill, black outline, black centered text.
// The shape outline is drawn as inline SVG that scales to the node box, so resizing the
// node (via NodeResizer) reshapes the cylinder/cloud correctly. Double-clicking enters
// an inline editing mode with a centered <textarea>; blur or Enter commits the text.
//
// Connection handles sit on all four sides so any shape can be linked to any other; they
// are invisible until the node is hovered (styled in DeploymentView's global CSS).

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from 'reactflow'
import styled from 'styled-components'
import type { ShapeKind, ShapeNodeData } from './types'

const Wrap = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`

// The SVG outline fills the node box absolutely; the label sits on top, centered.
const OutlineSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
`

const Label = styled.div`
  position: relative;
  z-index: 1;
  max-width: 86%;
  text-align: center;
  color: #000;
  font-size: 13px;
  line-height: 1.25;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: none;
  pointer-events: none;
`

const EditArea = styled.textarea`
  position: relative;
  z-index: 2;
  width: 86%;
  height: auto;
  min-height: 24px;
  max-height: 86%;
  field-sizing: content;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  color: #000;
  font-size: 13px;
  line-height: 1.25;
  font-family: inherit;
`

// renderOutline draws the kind-specific black-and-white silhouette. viewBox is a fixed
// 0..100 square scaled by preserveAspectRatio:none so it stretches with the node box.
function renderOutline(kind: ShapeKind): React.JSX.Element {
  const stroke = '#000'
  const fill = '#fff'
  const sw = 2

  if (kind === 'rectangle') {
    return (
      <rect x={1} y={1} width={98} height={98} fill={fill} stroke={stroke} strokeWidth={sw} />
    )
  }

  if (kind === 'database') {
    // Cylinder: an ellipse top, straight sides, a curved bottom — the classic DB icon.
    return (
      <g fill={fill} stroke={stroke} strokeWidth={sw}>
        <path d="M2 14 L2 86 A48 12 0 0 0 98 86 L98 14" />
        <ellipse cx={50} cy={14} rx={48} ry={12} />
      </g>
    )
  }

  // cloud — a lumpy blob made of overlapping arcs.
  return (
    <path
      d="M25 78
         A20 20 0 0 1 22 40
         A22 22 0 0 1 60 28
         A18 18 0 0 1 88 48
         A16 16 0 0 1 82 78
         Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinejoin="round"
    />
  )
}

function ShapeNodeImpl({ id, data, selected }: NodeProps<ShapeNodeData>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  // Keep the local draft in sync when the upstream label changes (e.g. on hydrate).
  useEffect(() => {
    setDraft(data.label)
  }, [data.label])

  useEffect(() => {
    if (editing && areaRef.current) {
      areaRef.current.focus()
      areaRef.current.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    setEditing(false)

    // Notify the canvas of the new label via a DOM custom event — keeps this component
    // decoupled from DeploymentView's state setter (the view listens on the pane).
    const ev = new CustomEvent('deployment:label', { detail: { id, label: draft }, bubbles: true })

    areaRef.current?.dispatchEvent(ev)
  }, [draft, id])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit()

        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setDraft(data.label)
        setEditing(false)
      }
    },
    [commit, data.label]
  )

  return (
    <Wrap onDoubleClick={() => setEditing(true)}>
      <NodeResizer
        isVisible={selected}
        minWidth={70}
        minHeight={60}
        color="#000"
        handleStyle={{ width: 8, height: 8, borderRadius: 0, background: '#fff', border: '1px solid #000' }}
        lineStyle={{ borderColor: '#000' }}
      />

      <OutlineSvg viewBox="0 0 100 100" preserveAspectRatio="none">
        {renderOutline(data.kind)}
      </OutlineSvg>

      {editing ? (
        <EditArea
          ref={areaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <Label>{data.label}</Label>
      )}

      {/*
        One handle per side, each connectable as BOTH source and target. Previously a
        separate source + target handle were stacked at identical coordinates on every
        side; on the destination node the source handle sat on top of the target handle
        and intercepted the drop, so a connection could never resolve to a valid target
        and onConnect never fired. A single dual-role handle per side fixes the hit test
        while still letting any side link to any other.
      */}
      <Handle type="source" position={Position.Top} id="t" isConnectableStart isConnectableEnd />
      <Handle type="source" position={Position.Right} id="r" isConnectableStart isConnectableEnd />
      <Handle type="source" position={Position.Bottom} id="b" isConnectableStart isConnectableEnd />
      <Handle type="source" position={Position.Left} id="l" isConnectableStart isConnectableEnd />
    </Wrap>
  )
}

export const ShapeNode = memo(ShapeNodeImpl)
