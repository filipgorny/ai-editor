// DeploymentView — plan item 2: the deployment-diagram view (ViewKey 'deployment').
//
// A custom black & white diagram editor (no reactflow, no MUI): shapes (rectangle /
// database / cloud) are absolutely-positioned boxes you can move, resize and double-click
// to type centered text; you connect two shapes by dragging from one of a shape's four
// connector dots onto another shape. Connections are plain SVG arrows whose head style
// (solid / hollow / none / bidirectional) is chosen in the left gallery. All the drag /
// resize / connect logic is hand-written here.
//
// Self-contained per the view contract: reaches App state + IPC + the bus only through
// `ctx`; no import of App, the registry, or sibling views.
//
// Persistence: there is no dedicated deployment IPC, so — like the browser view stores Lua
// macros — we reuse the scripts service under a reserved project namespace
// ('__deployment__'), storing the diagram JSON as one script's content keyed by the open
// project's folder (or '__global__'). Every api call is optional-chained so the view
// degrades to local state when the scripts IPC is unavailable.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { colors } from '@/styles/tokens'
import type { ViewContext, ViewDefinition } from '@/views/types'
import HubIcon from '@mui/icons-material/Hub'
import { Gallery } from '@/views/deployment/Gallery'
import { commander } from '@/commander/Commander'
import {
  ADD_SHAPE,
  CLEAR_DIAGRAM,
  CONNECT,
  DELETE_SELECTED,
  SET_ARROW
} from '@/commander/commands/deployment'
import { diagramToXml, xmlToDiagram, diagramToSvg, svgToPngBlob } from '@/views/deployment/draw'
import {
  CONNECTOR_SPECS,
  defaultSize,
  isArrowStyle,
  isKnownKind,
  parseKind,
  type ArrowStyle,
  type EndCap,
  type PersistedDiagram,
  type PersistedEdge,
  type PersistedNode,
  type ShapeKind
} from '@/views/deployment/types'

// Reserved scripts namespace the diagram document lives under (see file header).
const STORE_PROJECT = '__deployment__'

// Zoom clamp range for the canvas.
const MIN_SCALE = 0.2
const MAX_SCALE = 3

// Size of the world container; large enough that translated/scaled edges aren't clipped.
const WORLD_SIZE = 20000

let idSeq = 1

// nextId returns a process-unique id; the time prefix keeps ids distinct across reloads.
function nextId(prefix: string): string {
  idSeq += 1

  return `${prefix}_${Date.now().toString(36)}_${idSeq}`
}

function storeKey(folder: string): string {
  return folder || '__global__'
}

function makeNode(kind: ShapeKind, x: number, y: number): PersistedNode {
  const size = defaultSize(kind)

  return { id: nextId('shape'), kind, label: '', x, y, width: size.width, height: size.height }
}

// renderOutline draws the basic black-and-white silhouette for `name` into a 0..100 box that
// stretches with the shape (preserveAspectRatio:none). Only basic primitives are drawn this
// way; icon-based shapes (AWS) render their svg as an <img> instead (see the node markup).
function renderOutline(name: string): React.JSX.Element {
  const stroke = '#000'
  const fill = '#fff'
  const sw = 2

  if (name === 'rectangle') {
    return <rect x={1} y={1} width={98} height={98} fill={fill} stroke={stroke} strokeWidth={sw} />
  }

  if (name === 'database') {
    return (
      <g fill={fill} stroke={stroke} strokeWidth={sw}>
        <path d="M2 14 L2 86 A48 12 0 0 0 98 86 L98 14" />
        <ellipse cx={50} cy={14} rx={48} ry={12} />
      </g>
    )
  }

  return (
    <path
      d="M25 78 A20 20 0 0 1 22 40 A22 22 0 0 1 60 28 A18 18 0 0 1 88 48 A16 16 0 0 1 82 78 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinejoin="round"
    />
  )
}

// shapeInset gives per-kind half-extent factors so the clip rectangle matches the drawn
// silhouette (see renderOutline) instead of the full bounding box: the cloud blob occupies
// only ~66% width / ~52% height of its box, so its arrows must stop earlier to touch the
// outline. Icon-based shapes (AWS) fill their box, so they use the full extent.
function shapeInset(kind: ShapeKind): { x: number; y: number } {
  const { category, name } = parseKind(kind)

  if (category === 'basic' && name === 'cloud') {
    return { x: 0.66, y: 0.52 }
  }

  if (category === 'basic' && name === 'database') {
    return { x: 0.97, y: 0.95 }
  }

  return { x: 1.0, y: 1.0 }
}

// borderPoint clips the center→toward ray to the node's drawn silhouette, so an arrow
// touches the visible shape edge instead of its centre or the bounding box.
function borderPoint(n: PersistedNode, towardX: number, towardY: number): { x: number; y: number } {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  const dx = towardX - cx
  const dy = towardY - cy

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy }
  }

  const inset = shapeInset(n.kind)
  const hx = (n.width / 2) * inset.x
  const hy = (n.height / 2) * inset.y
  const scale = 1 / Math.max(Math.abs(dx) / hx, Math.abs(dy) / hy)

  return { x: cx + dx * scale, y: cy + dy * scale }
}

function center(n: PersistedNode): { x: number; y: number } {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 }
}

// Map an end cap to the SVG marker drawn at the target (end) and source (start) of an edge.
// Start has fewer entries: only the symmetric bar and the mirrored solid arrowhead make sense
// pointing back out of the source.
const END_MARKER: Record<EndCap, string | undefined> = {
  none: undefined,
  arrow: 'url(#dep-solid)',
  arrowEmpty: 'url(#dep-empty)',
  crow: 'url(#dep-crow)',
  bar: 'url(#dep-bar)'
}

const START_MARKER: Record<EndCap, string | undefined> = {
  none: undefined,
  arrow: 'url(#dep-solid-start)',
  arrowEmpty: undefined,
  crow: undefined,
  bar: 'url(#dep-bar)'
}

// connectorRender resolves a connector style to the line dash + the two end markers used on
// the canvas edge.
function connectorRender(arrow: ArrowStyle): { dash?: string; startMarker?: string; endMarker?: string } {
  const spec = CONNECTOR_SPECS[arrow] ?? CONNECTOR_SPECS.solid

  return {
    dash: spec.dashed ? '7 5' : undefined,
    startMarker: START_MARKER[spec.start],
    endMarker: END_MARKER[spec.end]
  }
}

// — styled scaffolding (all custom; no MUI) —

const Root = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
`

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.panel};
`

const TBtn = styled.button`
  padding: 5px 12px;
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 6px;
  color: #e6edf3;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--accent, ${colors.controller});
    color: #fff;
  }
`

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`

const Canvas = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: #e9e9ea;
  background-image: radial-gradient(#c7c7c9 1px, transparent 1px);
  background-size: 18px 18px;
`

// The world container holds both the EdgeLayer and the shapes; its CSS transform applies
// the viewport pan/zoom so everything stays in sync. transform-origin 0 0 keeps the maths
// in canvasPoint() simple.
const World = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  transform-origin: 0 0;
`

const EdgeLayer = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  width: ${WORLD_SIZE}px;
  height: ${WORLD_SIZE}px;
  overflow: visible;
  pointer-events: none;
`

const ShapeBox = styled.div<{ $selected: boolean }>`
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
  outline: ${(p) => (p.$selected ? '1px dashed var(--accent, #58a6ff)' : 'none')};
  outline-offset: 2px;
`

const Outline = styled.svg`
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

// Layout for an icon-based shape (AWS): the svg icon on top, its label beneath.
const IconWrap = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 2px;
`

const IconImg = styled.img`
  flex: 1 1 auto;
  min-height: 0;
  max-width: 100%;
  object-fit: contain;
  pointer-events: none;
`

const IconLabel = styled.div`
  flex: 0 0 auto;
  max-width: 100%;
  text-align: center;
  color: #000;
  font-size: 12px;
  line-height: 1.2;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: none;
  pointer-events: none;
`

const EditArea = styled.textarea`
  position: relative;
  z-index: 2;
  width: 86%;
  min-height: 24px;
  max-height: 86%;
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

// A connector dot on one side of a shape; hidden until the shape is hovered.
const Dot = styled.div`
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px;
  border-radius: 50%;
  background: #000;
  border: 2px solid #fff;
  opacity: 0;
  cursor: crosshair;
  transition: opacity 0.12s;
  z-index: 3;

  ${ShapeBox}:hover & {
    opacity: 1;
  }
`

const ResizeHandle = styled.div`
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 1px solid #000;
  cursor: nwse-resize;
  opacity: 0;
  z-index: 3;

  ${ShapeBox}:hover &,
  ${ShapeBox}:focus-within & {
    opacity: 1;
  }
`

const EmptyHint = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: ${colors.muted};
  font-size: 14px;
`

// Live state of an in-progress connection drag.
type Connecting = { from: string; x: number; y: number }

// Viewport transform applied to the world container (pan + zoom).
type Viewport = { tx: number; ty: number; scale: number }

export function DeploymentViewComponent({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const [nodes, setNodes] = useState<PersistedNode[]>([])
  const [edges, setEdges] = useState<PersistedEdge[]>([])
  const [arrow, setArrow] = useState<ArrowStyle>('solid')
  const [selNode, setSelNode] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [view, setView] = useState<Viewport>({ tx: 0, ty: 0, scale: 1 })

  const hydratedRef = useRef(false)
  const folderRef = useRef(ctx.folder)

  // viewRef mirrors the viewport so DOM event handlers (pan/zoom) read the latest transform
  // without re-subscribing.
  const viewRef = useRef(view)

  // These mirror the live state for the command handlers (deployment:* bus events), which are
  // subscribed once and must read the latest nodes/selection/arrow without re-subscribing.
  const nodesRef = useRef(nodes)
  const arrowRef = useRef(arrow)
  const selNodeRef = useRef(selNode)
  const selEdgeRef = useRef(selEdge)

  folderRef.current = ctx.folder
  viewRef.current = view
  nodesRef.current = nodes
  arrowRef.current = arrow
  selNodeRef.current = selNode
  selEdgeRef.current = selEdge

  // canvasPoint converts a viewport event to WORLD coordinates, undoing the viewport
  // transform (translate then scale, transform-origin 0 0).
  const canvasPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const r = canvasRef.current?.getBoundingClientRect()
    const { tx, ty, scale } = viewRef.current

    return {
      x: (clientX - (r?.left ?? 0) - tx) / scale,
      y: (clientY - (r?.top ?? 0) - ty) / scale
    }
  }, [])

  // — Load the persisted diagram whenever the project changes. —
  useEffect(() => {
    let cancelled = false

    hydratedRef.current = false

    async function load(): Promise<void> {
      let doc: PersistedDiagram | null = null

      try {
        const scripts = await ctx.api?.listScripts?.(STORE_PROJECT)
        const rec = scripts?.find((s) => s.name === storeKey(ctx.folder))

        if (rec?.content) {
          doc = JSON.parse(rec.content) as PersistedDiagram
        }
      } catch {
        doc = null
      }

      if (cancelled) {
        return
      }

      setNodes(doc?.nodes ?? [])
      setEdges(doc?.edges ?? [])
      setSelNode(null)
      setSelEdge(null)

      window.setTimeout(() => {
        hydratedRef.current = true
      }, 0)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [ctx.folder, ctx.navKey, ctx.api])

  // — Debounced persistence: write the JSON document a short while after any edit. —
  useEffect(() => {
    if (!hydratedRef.current) {
      return
    }

    const handle = window.setTimeout(() => {
      const doc: PersistedDiagram = { version: 1, nodes, edges }

      void ctx.api?.saveScript?.({
        name: storeKey(folderRef.current),
        content: JSON.stringify(doc),
        project: STORE_PROJECT
      })

      try {
        ctx.bus.emit('deployment:dirty' as never, { changed: true } as never)
      } catch {
        /* event not yet in the map — ignore */
      }
    }, 600)

    return () => window.clearTimeout(handle)
  }, [nodes, edges, ctx.api, ctx.bus])

  const patchNode = useCallback((id: string, patch: Partial<PersistedNode>): void => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  }, [])

  // — Add a shape at the canvas centre (click in the gallery, or the AI via 'add-shape'). —
  const addShape = useCallback(
    (kind: ShapeKind, label = ''): void => {
      if (!isKnownKind(kind)) {
        return
      }

      const r = canvasRef.current?.getBoundingClientRect()
      // Place the new shape at the world point under the centre of the visible canvas.
      const c = r
        ? canvasPoint(r.left + r.width / 2, r.top + r.height / 2)
        : { x: 240, y: 200 }
      const size = defaultSize(kind)
      const node = makeNode(kind, c.x - size.width / 2, c.y - size.height / 2)

      setNodes((ns) => ns.concat(label ? { ...node, label } : node))
    },
    [canvasPoint]
  )

  // CQRS handlers: the deployment command DECLARATIONS live in commander/commands/deployment;
  // here we bind their BEHAVIOUR while this view is mounted (disposed on unmount). Handlers
  // read live state via refs, so binding once is enough.
  useEffect(() => {
    return commander.bindHandlers({
      [ADD_SHAPE]: (arg) => {
        const comma = arg.indexOf(',')
        const kind = (comma === -1 ? arg : arg.slice(0, comma)).trim()
        const label = comma === -1 ? '' : arg.slice(comma + 1).trim()

        if (!kind) {
          throw new Error('add-shape: brak kind (np. amazon/ec2)')
        }

        addShape(kind, label)
      },

      [CONNECT]: (arg) => {
        const [source, target, style] = arg.split(',').map((s) => s.trim())

        if (!source || !target) {
          throw new Error('connect: podaj sourceLabel,targetLabel')
        }

        const ns = nodesRef.current
        const a = ns.find((n) => n.label.trim() === source)
        const b = ns.find((n) => n.label.trim() === target)

        if (!a || !b || a.id === b.id) {
          throw new Error('connect: nie znaleziono kształtów o tych etykietach')
        }

        const ar = style && isArrowStyle(style) ? style : arrowRef.current

        setEdges((es) =>
          es.some((e) => e.source === a.id && e.target === b.id)
            ? es
            : es.concat({ id: nextId('edge'), source: a.id, target: b.id, arrow: ar })
        )
      },

      [SET_ARROW]: (arg) => {
        const style = arg.trim()

        if (!isArrowStyle(style)) {
          throw new Error('set-arrow: nieznany styl')
        }

        setArrow(style)

        const se = selEdgeRef.current

        if (se) {
          setEdges((es) => es.map((e) => (e.id === se ? { ...e, arrow: style } : e)))
        }
      },

      [DELETE_SELECTED]: () => {
        const se = selEdgeRef.current
        const sn = selNodeRef.current

        if (se) {
          setEdges((es) => es.filter((e) => e.id !== se))
          setSelEdge(null)
        }

        if (sn) {
          setEdges((es) => es.filter((e) => e.source !== sn && e.target !== sn))
          setNodes((ns) => ns.filter((n) => n.id !== sn))
          setSelNode(null)
        }
      },

      [CLEAR_DIAGRAM]: () => {
        setNodes([])
        setEdges([])
        setSelNode(null)
        setSelEdge(null)
      }
    })
  }, [addShape])

  // — Drag & drop a shape from the gallery. —
  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()

      const kind = e.dataTransfer.getData('application/deployment-shape') as ShapeKind

      if (!isKnownKind(kind)) {
        return
      }

      const p = canvasPoint(e.clientX, e.clientY)
      const size = defaultSize(kind)

      setNodes((ns) => ns.concat(makeNode(kind, p.x - size.width / 2, p.y - size.height / 2)))
    },
    [canvasPoint]
  )

  // — Move a shape (drag its body). —
  const startMove = useCallback(
    (e: React.MouseEvent, n: PersistedNode): void => {
      if (e.button !== 0 || editing === n.id) {
        return
      }

      e.stopPropagation()
      setSelNode(n.id)
      setSelEdge(null)

      const sx = e.clientX
      const sy = e.clientY
      const ox = n.x
      const oy = n.y

      const move = (ev: MouseEvent): void => {
        // Convert the screen-space drag delta into world units.
        const scale = viewRef.current.scale

        patchNode(n.id, {
          x: Math.round(ox + (ev.clientX - sx) / scale),
          y: Math.round(oy + (ev.clientY - sy) / scale)
        })
      }

      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }

      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [editing, patchNode]
  )

  // — Resize a shape (drag its bottom-right handle). —
  const startResize = useCallback(
    (e: React.MouseEvent, n: PersistedNode): void => {
      e.preventDefault()
      e.stopPropagation()

      const sx = e.clientX
      const sy = e.clientY
      const ow = n.width
      const oh = n.height

      // Icon shapes (AWS) hold their aspect ratio so the square graphic resizes uniformly
      // and can't be squashed; basic primitives stay freely resizable on each axis.
      const locked = parseKind(n.kind).category !== 'basic'
      const aspect = ow / oh

      const move = (ev: MouseEvent): void => {
        // Convert the screen-space drag delta into world units.
        const scale = viewRef.current.scale
        const dw = (ev.clientX - sx) / scale
        const dh = (ev.clientY - sy) / scale

        if (locked) {
          // Drive a uniform resize from whichever axis the cursor pushed further.
          const width = Math.max(70, Math.round(ow + Math.max(dw, dh * aspect)))

          patchNode(n.id, { width, height: Math.round(width / aspect) })

          return
        }

        patchNode(n.id, {
          width: Math.max(70, Math.round(ow + dw)),
          height: Math.max(50, Math.round(oh + dh))
        })
      }

      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }

      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [patchNode]
  )

  // — Connect: drag from a shape's connector dot onto another shape. —
  const startConnect = useCallback(
    (e: React.MouseEvent, from: string): void => {
      e.preventDefault()
      e.stopPropagation()

      const begin = canvasPoint(e.clientX, e.clientY)
      setConnecting({ from, x: begin.x, y: begin.y })

      const move = (ev: MouseEvent): void => {
        const p = canvasPoint(ev.clientX, ev.clientY)
        setConnecting((c) => (c ? { ...c, x: p.x, y: p.y } : c))
      }

      const up = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)

        const p = canvasPoint(ev.clientX, ev.clientY)

        // Drop target: the topmost shape under the cursor that isn't the source.
        setNodes((ns) => {
          const target = [...ns].reverse().find(
            (n) => n.id !== from && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height
          )

          if (target) {
            setEdges((es) =>
              es.some((ed) => ed.source === from && ed.target === target.id)
                ? es
                : es.concat({ id: nextId('edge'), source: from, target: target.id, arrow })
            )
          }

          return ns
        })

        setConnecting(null)
      }

      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [arrow, canvasPoint]
  )

  // — Pan: middle mouse button (button 1) drag on the canvas. —
  const startPan = useCallback((e: React.MouseEvent): void => {
    if (e.button !== 1) {
      return
    }

    // Prevent the browser's middle-click autoscroll cursor.
    e.preventDefault()
    e.stopPropagation()

    const sx = e.clientX
    const sy = e.clientY
    const base = viewRef.current

    const move = (ev: MouseEvent): void => {
      ev.preventDefault()
      setView((v) => ({ ...v, tx: base.tx + (ev.clientX - sx), ty: base.ty + (ev.clientY - sy) }))
    }

    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])

  // — Zoom: mouse wheel over the canvas, anchored to the cursor (zoom-to-cursor). —
  // A native non-passive listener is used so preventDefault() actually suppresses scroll;
  // React's synthetic onWheel is registered passive and cannot cancel the event.
  useEffect(() => {
    const el = canvasRef.current

    if (!el) {
      return
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()

      const r = el.getBoundingClientRect()
      const v = viewRef.current
      const factor = Math.exp(-e.deltaY * 0.0015)
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))

      if (next === v.scale) {
        return
      }

      // Keep the world point under the cursor fixed: solve for tx/ty so that
      // (cursor - t) / scale stays constant across the scale change.
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const wx = (px - v.tx) / v.scale
      const wy = (py - v.ty) / v.scale

      setView({ scale: next, tx: px - wx * next, ty: py - wy * next })
    }

    el.addEventListener('wheel', onWheel, { passive: false })

    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // — Arrow-style panel: arm new connections AND restyle the selected edge. —
  const onArrowChange = useCallback(
    (a: ArrowStyle): void => {
      setArrow(a)

      if (selEdge) {
        setEdges((es) => es.map((e) => (e.id === selEdge ? { ...e, arrow: a } : e)))
      }
    },
    [selEdge]
  )

  // — Delete the selected shape (and its edges) or the selected edge. —
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') {
        return
      }

      if (selEdge) {
        setEdges((es) => es.filter((ed) => ed.id !== selEdge))
        setSelEdge(null)
      }

      if (selNode) {
        setEdges((es) => es.filter((ed) => ed.source !== selNode && ed.target !== selNode))
        setNodes((ns) => ns.filter((n) => n.id !== selNode))
        setSelNode(null)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [selNode, selEdge])

  const commitLabel = useCallback(
    (id: string, label: string): void => {
      patchNode(id, { label })
      setEditing(null)
    },
    [patchNode]
  )

  // — Save / Open (.draw XML) + Export (PNG / SVG). —
  const onSave = useCallback(async (): Promise<void> => {
    await saveBlob(diagramToXml({ version: 1, nodes, edges }), 'diagram.draw', 'application/xml', 'draw')
  }, [nodes, edges])

  const onOpen = useCallback(async (): Promise<void> => {
    const xml = await openTextFile('.draw')

    if (!xml) {
      return
    }

    const doc = xmlToDiagram(xml)

    if (doc) {
      setNodes(doc.nodes)
      setEdges(doc.edges)
    }
  }, [])

  const onExport = useCallback(
    async (format: 'png' | 'svg'): Promise<void> => {
      const svg = diagramToSvg({ version: 1, nodes, edges })

      if (format === 'svg') {
        await saveBlob(svg, 'diagram.svg', 'image/svg+xml', 'svg')

        return
      }

      const blob = await svgToPngBlob(svg, 2)

      await saveBlob(blob, 'diagram.png', 'image/png', 'png')
    },
    [nodes, edges]
  )

  const nodeById = (id: string): PersistedNode | undefined => nodes.find((n) => n.id === id)

  return (
    <Root>
      <Toolbar>
        <TBtn onClick={onSave}>{t('deployment.save')}</TBtn>
        <TBtn onClick={onOpen}>{t('deployment.open')}</TBtn>
        <TBtn onClick={() => onExport('png')}>PNG</TBtn>
        <TBtn onClick={() => onExport('svg')}>SVG</TBtn>
      </Toolbar>

      <Body>
        <Gallery arrow={arrow} onArrowChange={onArrowChange} onAddShape={addShape} />

        <Canvas
          ref={canvasRef}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              startPan(e)

              return
            }

            // Click on empty canvas clears the selection.
            setSelNode(null)
            setSelEdge(null)
          }}
        >
          <World
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
            }}
          >
            <EdgeLayer>
            <defs>
              {/* Filled head (target end). */}
              <marker id="dep-solid" markerWidth={12} markerHeight={12} refX={9} refY={5} orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L10,5 L0,10 Z" fill="#000" />
              </marker>
              {/* Hollow head (target end). */}
              <marker id="dep-empty" markerWidth={12} markerHeight={12} refX={9} refY={5} orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0.5,0.5 L10,5 L0.5,9.5 Z" fill="#fff" stroke="#000" strokeWidth={1} />
              </marker>
              {/* Filled head for the source end of a bidirectional edge. */}
              <marker id="dep-solid-start" markerWidth={12} markerHeight={12} refX={1} refY={5} orient="auto" markerUnits="userSpaceOnUse">
                <path d="M10,0 L0,5 L10,10 Z" fill="#000" />
              </marker>
              {/* Crow's foot ("kurza stopka") — the ER "many" end: a fork opening at the entity. */}
              <marker id="dep-crow" markerWidth={18} markerHeight={16} refX={16} refY={8} orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,8 L16,1 M0,8 L16,8 M0,8 L16,15" fill="none" stroke="#000" strokeWidth={1.6} />
              </marker>
              {/* ER "one" bar — a single tick across the line (used at either end). */}
              <marker id="dep-bar" markerWidth={12} markerHeight={16} refX={6} refY={8} orient="auto" markerUnits="userSpaceOnUse">
                <path d="M6,1 L6,15" stroke="#000" strokeWidth={1.8} />
              </marker>
            </defs>

            {edges.map((e) => {
              const s = nodeById(e.source)
              const tg = nodeById(e.target)

              if (!s || !tg) {
                return null
              }

              const sc = center(s)
              const tc = center(tg)
              const p1 = borderPoint(s, tc.x, tc.y)
              const p2 = borderPoint(tg, sc.x, sc.y)
              const { dash, startMarker, endMarker } = connectorRender(e.arrow)

              return (
                <g key={e.id}>
                  {/* Wide invisible hit line for easy selection. */}
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="transparent"
                    strokeWidth={12}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onMouseDown={(ev) => {
                      ev.stopPropagation()
                      setSelEdge(e.id)
                      setSelNode(null)
                    }}
                  />
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="#000"
                    strokeWidth={selEdge === e.id ? 2.5 : 1.6}
                    strokeDasharray={dash}
                    markerEnd={endMarker}
                    markerStart={startMarker}
                  />
                </g>
              )
            })}

            {connecting && nodeById(connecting.from) && (
              <line
                x1={center(nodeById(connecting.from)!).x}
                y1={center(nodeById(connecting.from)!).y}
                x2={connecting.x}
                y2={connecting.y}
                stroke="#000"
                strokeWidth={1.4}
                strokeDasharray="5 4"
              />
            )}
          </EdgeLayer>

          {nodes.map((n) => {
            const { category, name } = parseKind(n.kind)
            const isBasic = category === 'basic'

            const editArea = (
              <EditArea
                autoFocus
                defaultValue={n.label}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={(e) => commitLabel(n.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commitLabel(n.id, (e.target as HTMLTextAreaElement).value)
                  }

                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditing(null)
                  }
                }}
              />
            )

            return (
            <ShapeBox
              key={n.id}
              $selected={selNode === n.id}
              style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
              onMouseDown={(e) => startMove(e, n)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(n.id)
              }}
            >
              {isBasic ? (
                <>
                  <Outline viewBox="0 0 100 100" preserveAspectRatio="none">
                    {renderOutline(name)}
                  </Outline>

                  {editing === n.id ? editArea : <Label>{n.label}</Label>}
                </>
              ) : (
                <IconWrap>
                  <IconImg src={`/shapes/${category}/${name}.svg`} alt={name} draggable={false} />
                  {editing === n.id ? editArea : <IconLabel>{n.label}</IconLabel>}
                </IconWrap>
              )}

              {/* Four connector dots — drag one onto another shape to link them. */}
              <Dot style={{ left: '50%', top: 0 }} onMouseDown={(e) => startConnect(e, n.id)} />
              <Dot style={{ left: '100%', top: '50%' }} onMouseDown={(e) => startConnect(e, n.id)} />
              <Dot style={{ left: '50%', top: '100%' }} onMouseDown={(e) => startConnect(e, n.id)} />
              <Dot style={{ left: 0, top: '50%' }} onMouseDown={(e) => startConnect(e, n.id)} />

              <ResizeHandle onMouseDown={(e) => startResize(e, n)} />
            </ShapeBox>
            )
          })}
          </World>

          {nodes.length === 0 && <EmptyHint>{t('deployment.empty')}</EmptyHint>}
        </Canvas>
      </Body>
    </Root>
  )
}

// saveBlob writes content to a user-chosen location (File System Access API → download).
async function saveBlob(content: string | Blob, suggestedName: string, mime: string, ext: string): Promise<void> {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ accept: { [mime]: ['.' + ext] } }] })
      const writable = await handle.createWritable()

      await writable.write(blob)
      await writable.close()

      return
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        return
      }
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
}

// openTextFile lets the user pick a file and returns its text (null on cancel/failure).
async function openTextFile(ext: string): Promise<string | null> {
  const picker = (window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker

  if (picker) {
    try {
      const [handle] = await picker({ types: [{ accept: { 'application/xml': [ext] } }] })
      const file = await handle.getFile()

      return await file.text()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        return null
      }
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')

    input.type = 'file'
    input.accept = ext

    input.onchange = () => {
      const f = input.files?.[0]

      if (!f) {
        resolve(null)

        return
      }

      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => resolve(null)
      reader.readAsText(f)
    }

    input.click()
  })
}

// deploymentView — the registry entry the integration phase imports & appends to VIEWS.
export const deploymentView: ViewDefinition = {
  key: 'deployment',
  titleKey: 'views.deployment',
  Icon: HubIcon,
  Component: DeploymentViewComponent
}

export default DeploymentViewComponent
