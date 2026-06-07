// Window — the shared floating-window frame used by editor windows and browser pages.
//
// It owns the hard, duplicated mechanics: dragging (from the header, the middle mouse
// button anywhere, or Alt + left button anywhere), edge/corner resizing, and edge snapping
// against a caller-provided "scene" rectangle (drag to the top → fill the scene; to the
// left/right edge → that half). Geometry is CONTROLLED: the parent owns x/y/w/h and the
// snapped flag and updates them from onChange/onSnappedChange, so each consumer keeps its
// own persistence and layout state. The parent renders the title bar via `header` and the
// body via `children`; Window only positions and frames them.
//
// Coordinate modes:
//  - 'fixed'    → position:fixed, geometry in viewport coordinates (editor windows, which
//                 float above the whole app).
//  - 'absolute' → position:absolute, geometry relative to the offset parent, which must be
//                 the same element getScene() returns (browser pages, clipped to their view).

import { type MouseEvent as ReactMouseEvent, type ReactNode, useRef } from 'react'
import styled from 'styled-components'
import { colors } from '@/styles/tokens'

export type WindowGeom = { x: number; y: number; w: number; h: number }

// Edge band (px) within which a drag snaps to the scene edge. Narrow so merely moving a
// window near an edge doesn't snap it.
const SNAP = 14

const Frame = styled.div<{ $snapped: boolean }>`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  /* A snapped window fills the scene and visually melts into it: no shadow, no radius. */
  border-radius: ${(p) => (p.$snapped ? 0 : 8)}px;
  box-shadow: ${(p) => (p.$snapped ? 'none' : '0 12px 48px rgba(0, 0, 0, 0.6)')};
`

export default function Window({
  x,
  y,
  w,
  h,
  snapped = false,
  coordinate = 'absolute',
  active = true,
  resizable = true,
  disabled = false,
  minWidth = 360,
  minHeight = 240,
  zIndex,
  className,
  style,
  getScene,
  onChange,
  onSnappedChange,
  onActivate,
  header,
  children
}: {
  x: number
  y: number
  w: number
  h: number
  snapped?: boolean
  coordinate?: 'fixed' | 'absolute'
  active?: boolean
  resizable?: boolean
  // disabled turns off all drag/resize (e.g. while the parent is in fullscreen) but still
  // renders the frame so the parent can position it freely via `style`.
  disabled?: boolean
  minWidth?: number
  minHeight?: number
  zIndex?: number
  className?: string
  // style is applied LAST so the parent can override geometry/looks (fullscreen, opacity…).
  style?: React.CSSProperties
  // getScene returns the snap target rect in VIEWPORT coordinates (getBoundingClientRect).
  // null disables snapping (the scene isn't mounted) — plain moves still work.
  getScene?: () => DOMRect | null
  onChange: (geom: WindowGeom) => void
  onSnappedChange?: (snapped: boolean) => void
  onActivate?: () => void
  header?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  // Latest controlled props for the move/resize listeners (avoids stale closures without
  // re-binding window listeners on every render).
  const geomRef = useRef<WindowGeom>({ x, y, w, h })
  geomRef.current = { x, y, w, h }

  const snappedRef = useRef(snapped)
  snappedRef.current = snapped

  // Size remembered before a top/side snap so dragging the window back out restores it.
  const preSnapRef = useRef<{ w: number; h: number } | null>(null)

  // toLocal converts a viewport point to this window's coordinate space (identity for
  // 'fixed'; scene-relative for 'absolute').
  const toLocal = (clientX: number, clientY: number, scene: DOMRect | null): { x: number; y: number } => {
    if (coordinate === 'fixed' || !scene) {
      return { x: clientX, y: clientY }
    }

    return { x: clientX - scene.left, y: clientY - scene.top }
  }

  // sceneFill returns the geometry that fills the scene in this window's coordinate space.
  const sceneFill = (scene: DOMRect): WindowGeom => {
    const base = coordinate === 'fixed' ? { x: Math.round(scene.left), y: Math.round(scene.top) } : { x: 0, y: 0 }

    return { ...base, w: Math.round(scene.width), h: Math.round(scene.height) }
  }

  const startDrag = (e: ReactMouseEvent): void => {
    if (disabled) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    onActivate?.()

    const startGeom = geomRef.current
    const wasSnapped = snappedRef.current
    const sx = e.clientX
    const sy = e.clientY
    let willSnap = wasSnapped

    const move = (ev: MouseEvent): void => {
      const scene = getScene?.() ?? null

      if (scene) {
        const fill = sceneFill(scene)
        const halfW = Math.round(scene.width / 2)

        // Drag UP to the scene's top edge → fill the whole scene.
        if (ev.clientY <= scene.top + SNAP) {
          if (!wasSnapped && !preSnapRef.current) {
            preSnapRef.current = { w: startGeom.w, h: startGeom.h }
          }

          willSnap = true
          onChange(fill)

          return
        }

        willSnap = false

        // Drag to the LEFT edge → left half of the scene.
        if (ev.clientX <= scene.left + SNAP) {
          onChange({ x: fill.x, y: fill.y, w: halfW, h: fill.h })

          return
        }

        // Drag to the RIGHT edge → right half of the scene.
        if (ev.clientX >= scene.right - SNAP) {
          onChange({ x: fill.x + halfW, y: fill.y, w: halfW, h: fill.h })

          return
        }
      }

      willSnap = false

      // Dragging a snapped window out → restore its pre-snap floating size under the cursor.
      if (wasSnapped) {
        const rs = preSnapRef.current ?? { w: startGeom.w, h: startGeom.h }
        const local = toLocal(ev.clientX, ev.clientY, scene)

        onChange({ w: rs.w, h: rs.h, x: Math.round(local.x - rs.w / 2), y: Math.max(0, Math.round(local.y - 12)) })

        return
      }

      // Plain move: follow the cursor delta, keep the size.
      onChange({
        w: startGeom.w,
        h: startGeom.h,
        x: Math.max(0, startGeom.x + ev.clientX - sx),
        y: Math.max(0, startGeom.y + ev.clientY - sy)
      })
    }

    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)

      if (willSnap !== snappedRef.current) {
        onSnappedChange?.(willSnap)
      }

      if (!willSnap) {
        preSnapRef.current = null
      }
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // startResize drives a single edge/corner handle (which edges move is passed in).
  const startResize =
    (edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }) =>
    (e: ReactMouseEvent): void => {
      if (disabled || !resizable) {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      onActivate?.()

      // A manual resize takes the window out of the snapped state.
      if (snappedRef.current) {
        onSnappedChange?.(false)
        preSnapRef.current = null
      }

      const start = { mx: e.clientX, my: e.clientY, ...geomRef.current }

      const move = (ev: MouseEvent): void => {
        const dx = ev.clientX - start.mx
        const dy = ev.clientY - start.my
        let nw = start.w
        let nh = start.h
        let nx = start.x
        let ny = start.y

        if (edges.right) {
          nw = Math.max(minWidth, start.w + dx)
        }

        if (edges.bottom) {
          nh = Math.max(minHeight, start.h + dy)
        }

        if (edges.left) {
          nw = Math.max(minWidth, start.w - dx)
          nx = start.x + (start.w - nw)
        }

        if (edges.top) {
          nh = Math.max(minHeight, start.h - dy)
          ny = start.y + (start.h - nh)
        }

        onChange({ x: nx, y: ny, w: nw, h: nh })
      }

      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }

      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }

  // Alt + middle button anywhere → free resize from the window's bottom-right.
  const startFreeResize = (e: ReactMouseEvent): void => startResize({ right: true, bottom: true })(e)

  // toggleSnapTop — double-clicking the header snaps the window to the TOP (fills the scene),
  // exactly like dragging it to the top edge; double-clicking again restores its pre-snap
  // floating size. Since the parent records the snap (onSnappedChange), every file opened while
  // a window is snapped opens snapped too — so the whole workspace acts "maximized".
  const toggleSnapTop = (): void => {
    if (disabled) {
      return
    }

    const scene = getScene?.() ?? null

    if (!scene) {
      return
    }

    if (snappedRef.current) {
      const rs = preSnapRef.current ?? { w: Math.round(scene.width / 2), h: Math.round(scene.height * 0.8) }
      const base =
        coordinate === 'fixed'
          ? { x: Math.round(scene.left + (scene.width - rs.w) / 2), y: Math.round(scene.top + (scene.height - rs.h) / 2) }
          : { x: Math.round((scene.width - rs.w) / 2), y: Math.round((scene.height - rs.h) / 2) }

      onChange({ ...base, w: rs.w, h: rs.h })
      preSnapRef.current = null
      onSnappedChange?.(false)

      return
    }

    preSnapRef.current = { w: geomRef.current.w, h: geomRef.current.h }
    onChange(sceneFill(scene))
    onSnappedChange?.(true)
  }

  const handle = (cursor: string, pos: React.CSSProperties, edges: Parameters<typeof startResize>[0]): React.JSX.Element => (
    <div onMouseDown={startResize(edges)} style={{ position: 'absolute', cursor, zIndex: 11, ...pos }} />
  )

  return (
    <Frame
      $snapped={snapped}
      className={className}
      onMouseDown={() => onActivate?.()}
      onMouseDownCapture={(e) => {
        if (disabled) {
          return
        }

        // Middle button anywhere moves the window; Alt + middle resizes it; Alt + left also
        // moves it. (Left button alone is left to the content / header.)
        if (e.button === 1) {
          if (e.altKey) {
            startFreeResize(e)
          } else {
            startDrag(e)
          }

          return
        }

        if (e.button === 0 && e.altKey) {
          startDrag(e)
        }
      }}
      style={{
        position: coordinate,
        left: x,
        top: y,
        width: w,
        height: h,
        minWidth,
        minHeight,
        zIndex,
        ...style
      }}
    >
      {header != null && (
        <div
          onMouseDown={(e) => e.button === 0 && !e.altKey && startDrag(e)}
          onDoubleClick={toggleSnapTop}
          style={{ cursor: disabled ? 'default' : 'move', flex: 'none' }}
        >
          {header}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>{children}</div>

      {resizable && !disabled && (
        <>
          {handle('ns-resize', { top: 0, left: 12, right: 12, height: 6, zIndex: 10 }, { top: true })}
          {handle('ns-resize', { bottom: 0, left: 12, right: 12, height: 6, zIndex: 10 }, { bottom: true })}
          {handle('ew-resize', { left: 0, top: 12, bottom: 12, width: 6, zIndex: 10 }, { left: true })}
          {handle('ew-resize', { right: 0, top: 12, bottom: 12, width: 6, zIndex: 10 }, { right: true })}
          {handle('nwse-resize', { top: 0, left: 0, width: 12, height: 12 }, { top: true, left: true })}
          {handle('nesw-resize', { top: 0, right: 0, width: 12, height: 12 }, { top: true, right: true })}
          {handle('nesw-resize', { bottom: 0, left: 0, width: 12, height: 12 }, { bottom: true, left: true })}
          {handle('nwse-resize', { bottom: 0, right: 0, width: 14, height: 14 }, { bottom: true, right: true })}
        </>
      )}
    </Frame>
  )
}
