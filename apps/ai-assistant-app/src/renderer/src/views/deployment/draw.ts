// draw.ts — import/export for the deployment diagram, self-contained (no App/IPC).
//
// Three concerns:
//   1. .draw file format — a small XML document (Save/Open). XML, not JSON, per the UX ask.
//   2. SVG rendering from the persisted model — reuses the same black & white silhouettes
//      as ShapeNode.renderOutline, so an export looks like the canvas.
//   3. PNG rasterization of that SVG at a chosen scale (the export dialog's "resolution").

import type { ArrowStyle, PersistedDiagram, PersistedEdge, PersistedNode, ShapeKind } from './types'

// — XML (.draw) —

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// diagramToXml serializes the diagram to the .draw XML document.
export function diagramToXml(doc: PersistedDiagram): string {
  const nodes = doc.nodes
    .map(
      (n) =>
        `    <node id="${escapeXml(n.id)}" kind="${n.kind}" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}">${escapeXml(n.label)}</node>`
    )
    .join('\n')

  const edges = doc.edges
    .map(
      (e) =>
        `    <edge id="${escapeXml(e.id)}" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}" arrow="${e.arrow}"/>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<draw version="1">\n  <nodes>\n${nodes}\n  </nodes>\n  <edges>\n${edges}\n  </edges>\n</draw>\n`
}

function asKind(v: string | null): ShapeKind {
  return v === 'database' || v === 'cloud' ? v : 'rectangle'
}

function asArrow(v: string | null): ArrowStyle {
  return v === 'empty' || v === 'none' || v === 'both' ? v : 'solid'
}

// xmlToDiagram parses a .draw XML document back into the persisted model. Returns null on
// malformed input (the caller keeps the current diagram).
export function xmlToDiagram(xml: string): PersistedDiagram | null {
  const dom = new DOMParser().parseFromString(xml, 'application/xml')

  if (dom.querySelector('parsererror') || !dom.querySelector('draw')) {
    return null
  }

  const nodes: PersistedNode[] = Array.from(dom.querySelectorAll('draw > nodes > node')).map((el) => ({
    id: el.getAttribute('id') ?? '',
    kind: asKind(el.getAttribute('kind')),
    label: el.textContent ?? '',
    x: Number(el.getAttribute('x')) || 0,
    y: Number(el.getAttribute('y')) || 0,
    width: Number(el.getAttribute('width')) || 160,
    height: Number(el.getAttribute('height')) || 90
  }))

  const edges: PersistedEdge[] = Array.from(dom.querySelectorAll('draw > edges > edge')).map((el) => ({
    id: el.getAttribute('id') ?? '',
    source: el.getAttribute('source') ?? '',
    target: el.getAttribute('target') ?? '',
    arrow: asArrow(el.getAttribute('arrow'))
  }))

  return { version: 1, nodes, edges }
}

// — SVG render —

// outline returns the kind-specific silhouette markup in a 0..100 viewBox (mirrors
// ShapeNode.renderOutline), to be placed inside a per-node nested <svg> that scales it.
function outline(kind: ShapeKind): string {
  if (kind === 'database') {
    return '<g fill="#fff" stroke="#000" stroke-width="2"><path d="M2 14 L2 86 A48 12 0 0 0 98 86 L98 14"/><ellipse cx="50" cy="14" rx="48" ry="12"/></g>'
  }

  if (kind === 'cloud') {
    return '<path d="M25 78 A20 20 0 0 1 22 40 A22 22 0 0 1 60 28 A18 18 0 0 1 88 48 A16 16 0 0 1 82 78 Z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/>'
  }

  return '<rect x="1" y="1" width="98" height="98" fill="#fff" stroke="#000" stroke-width="2"/>'
}

function center(n: PersistedNode): { x: number; y: number } {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 }
}

// boundaryPoint returns where the segment from `to`-center toward `from`-center crosses the
// `to` node's bounding box — the spot an arrowhead should sit (not buried in the shape).
function boundaryPoint(from: { x: number; y: number }, to: PersistedNode): { x: number; y: number } {
  const c = center(to)
  const dx = from.x - c.x
  const dy = from.y - c.y

  if (dx === 0 && dy === 0) {
    return c
  }

  const sx = dx !== 0 ? to.width / 2 / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? to.height / 2 / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)

  return { x: c.x + dx * s, y: c.y + dy * s }
}

// arrowHead returns a triangle (filled or hollow) with its tip at `tip`, pointing along dir.
function arrowHead(tip: { x: number; y: number }, dir: { x: number; y: number }, filled: boolean): string {
  const len = Math.hypot(dir.x, dir.y) || 1
  const ux = dir.x / len
  const uy = dir.y / len
  const size = 11
  const half = 6
  const bx = tip.x - ux * size
  const by = tip.y - uy * size
  const p1 = `${bx - uy * half},${by + ux * half}`
  const p2 = `${bx + uy * half},${by - ux * half}`
  const fill = filled ? '#000' : '#fff'

  return `<polygon points="${tip.x},${tip.y} ${p1} ${p2}" fill="${fill}" stroke="#000" stroke-width="2"/>`
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// nodeMarkup renders one node: scaled outline + centered (multi-line) label.
function nodeMarkup(n: PersistedNode): string {
  const c = center(n)
  const lines = (n.label || '').split('\n')
  const lineH = 16
  const startY = c.y - ((lines.length - 1) * lineH) / 2
  const text = lines
    .map(
      (ln, i) =>
        `<text x="${c.x}" y="${startY + i * lineH}" font-family="sans-serif" font-size="13" fill="#000" text-anchor="middle" dominant-baseline="central">${escapeText(ln)}</text>`
    )
    .join('')

  return `<svg x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" viewBox="0 0 100 100" preserveAspectRatio="none">${outline(n.kind)}</svg>${text}`
}

// edgeMarkup renders one edge: a line clipped to both node boundaries + arrowhead(s).
function edgeMarkup(e: PersistedEdge, byId: Map<string, PersistedNode>): string {
  const a = byId.get(e.source)
  const b = byId.get(e.target)

  if (!a || !b) {
    return ''
  }

  const ca = center(a)
  const cb = center(b)
  const pa = boundaryPoint(cb, a)
  const pb = boundaryPoint(ca, b)
  const line = `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="#000" stroke-width="2"/>`

  let heads = ''

  if (e.arrow === 'solid' || e.arrow === 'empty' || e.arrow === 'both') {
    heads += arrowHead(pb, { x: pb.x - pa.x, y: pb.y - pa.y }, e.arrow !== 'empty')
  }

  if (e.arrow === 'both') {
    heads += arrowHead(pa, { x: pa.x - pb.x, y: pa.y - pb.y }, true)
  }

  return line + heads
}

// diagramToSvg builds a standalone SVG of the whole diagram (tight bounding box + padding).
export function diagramToSvg(doc: PersistedDiagram): string {
  const pad = 24

  if (doc.nodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#fff"/></svg>'
  }

  const minX = Math.min(...doc.nodes.map((n) => n.x))
  const minY = Math.min(...doc.nodes.map((n) => n.y))
  const maxX = Math.max(...doc.nodes.map((n) => n.x + n.width))
  const maxY = Math.max(...doc.nodes.map((n) => n.y + n.height))
  const w = Math.ceil(maxX - minX + pad * 2)
  const h = Math.ceil(maxY - minY + pad * 2)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const body = doc.edges.map((e) => edgeMarkup(e, byId)).join('') + doc.nodes.map((n) => nodeMarkup(n)).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/><g transform="translate(${pad - minX},${pad - minY})">${body}</g></svg>`
}

// svgToPngBlob rasterizes an SVG string to a PNG Blob at the given pixel scale.
export function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const cx = canvas.getContext('2d')

      if (!cx) {
        URL.revokeObjectURL(url)
        reject(new Error('no 2d context'))

        return
      }

      cx.fillStyle = '#fff'
      cx.fillRect(0, 0, canvas.width, canvas.height)
      cx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)

      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('svg load failed'))
    }

    img.src = url
  })
}
