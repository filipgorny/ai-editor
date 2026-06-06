// Shared types for the deployment-diagram view (ViewKey 'deployment').
//
// The diagram is a small, self-contained domain: black & white shapes (rectangle,
// database/cylinder, cloud) connected by arrows whose head style is selectable. The
// persisted shape mirrors the reactflow node/edge shape closely so we can hydrate
// straight back into useNodesState/useEdgesState with no translation layer.

// ShapeKind — identifies a shape as "<category>/<name>", where <category> is the folder
// under /shapes and <name> is the svg basename (e.g. 'basic/rectangle', 'amazon/ec2').
// Legacy diagrams stored bare names ('rectangle'); parseKind() treats those as 'basic'.
export type ShapeKind = string

// DiagramCategory — one group in the left gallery: a folder of svg icons plus the i18n key
// for the group's displayed name. Both the gallery and the canvas read this single list.
export interface DiagramCategory {
  // id — the folder name under public/shapes that holds this category's svg icons.
  id: string
  // titleKey — i18n key for the category name shown as the gallery section title.
  titleKey: string
  // shapes — svg basenames (without extension) offered under this category.
  shapes: string[]
}

// DIAGRAM_CATEGORIES — the gallery's content. First the hand-drawn black & white basics,
// then the AWS service icons (the "Deployment" group). Add a category by dropping its svgs
// in public/shapes/<id>/ and appending an entry here.
export const DIAGRAM_CATEGORIES: DiagramCategory[] = [
  {
    id: 'basic',
    titleKey: 'deployment.category.basic',
    shapes: ['rectangle', 'database', 'cloud']
  },
  {
    id: 'amazon',
    titleKey: 'deployment.category.deployment',
    shapes: ['ec2', 'ecs', 's3', 'rds', 'redshift', 'documentdb']
  }
]

// parseKind splits a ShapeKind into its category id and shape name. A bare name (no slash)
// is a legacy basic shape, so it defaults to the 'basic' category.
export function parseKind(kind: ShapeKind): { category: string; name: string } {
  const i = kind.indexOf('/')

  if (i < 0) {
    return { category: 'basic', name: kind }
  }

  return { category: kind.slice(0, i), name: kind.slice(i + 1) }
}

// isKnownKind reports whether a ShapeKind corresponds to a shape declared in
// DIAGRAM_CATEGORIES (used to reject stray drag payloads on the canvas).
export function isKnownKind(kind: ShapeKind): boolean {
  const { category, name } = parseKind(kind)

  return DIAGRAM_CATEGORIES.some((c) => c.id === category && c.shapes.includes(name))
}

// ArrowStyle — the connector style chosen in the gallery's "Connectors" panel. Named
// ArrowStyle for backwards compatibility with persisted diagrams (the edge's `arrow` field).
//   solid     — filled arrowhead at the target end
//   empty     — hollow (outline) arrowhead at the target end
//   both      — filled arrowheads at BOTH ends (bidirectional)
//   none      — a plain solid line, no decoration
//   dashed    — a plain dashed line, no decoration
//   erOne     — ER "one to one": a single bar at both ends
//   erMany    — ER "many": a crow's foot ("kurza stopka") at the target end
//   erOneMany — ER "one to many": a bar at the source, a crow's foot at the target
export type ArrowStyle =
  | 'solid'
  | 'empty'
  | 'both'
  | 'none'
  | 'dashed'
  | 'erOne'
  | 'erMany'
  | 'erOneMany'

// EndCap — a medium-independent decoration for one end of a connector. The canvas, the
// gallery preview and the export renderer each map these to their own primitives.
export type EndCap = 'none' | 'arrow' | 'arrowEmpty' | 'crow' | 'bar'

// ConnectorSpec — how a connector style is drawn: line dash + the two end caps.
export interface ConnectorSpec {
  dashed: boolean
  start: EndCap
  end: EndCap
}

export const CONNECTOR_SPECS: Record<ArrowStyle, ConnectorSpec> = {
  solid: { dashed: false, start: 'none', end: 'arrow' },
  empty: { dashed: false, start: 'none', end: 'arrowEmpty' },
  both: { dashed: false, start: 'arrow', end: 'arrow' },
  none: { dashed: false, start: 'none', end: 'none' },
  dashed: { dashed: true, start: 'none', end: 'none' },
  erOne: { dashed: false, start: 'bar', end: 'bar' },
  erMany: { dashed: false, start: 'none', end: 'crow' },
  erOneMany: { dashed: false, start: 'bar', end: 'crow' }
}

// CONNECTOR_STYLES — the order connectors appear in the gallery palette.
export const CONNECTOR_STYLES: ArrowStyle[] = [
  'solid',
  'empty',
  'both',
  'none',
  'dashed',
  'erOne',
  'erMany',
  'erOneMany'
]

// isArrowStyle — narrow an arbitrary string (e.g. from a loaded .draw file) to a known style.
export function isArrowStyle(v: string | null | undefined): v is ArrowStyle {
  return v != null && Object.prototype.hasOwnProperty.call(CONNECTOR_SPECS, v)
}

// ShapeNodeData — the per-node `data` payload reactflow carries for our custom nodes.
export interface ShapeNodeData {
  kind: ShapeKind
  label: string
}

// ShapeEdgeData — the per-edge `data` payload; only the arrow style is ours.
export interface ShapeEdgeData {
  arrow: ArrowStyle
}

// PersistedNode / PersistedEdge — the minimal JSON we store (no reactflow internals).
export interface PersistedNode {
  id: string
  kind: ShapeKind
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface PersistedEdge {
  id: string
  source: string
  target: string
  arrow: ArrowStyle
}

// PersistedDiagram — the whole document written to / read from the store.
export interface PersistedDiagram {
  version: 1
  nodes: PersistedNode[]
  edges: PersistedEdge[]
}

// defaultSize returns the pixel size a freshly-dropped shape gets. Basic primitives keep
// their hand-tuned proportions; icon-based shapes (AWS) drop as a square with a little extra
// height for the label rendered beneath the icon.
export function defaultSize(kind: ShapeKind): { width: number; height: number } {
  const { category, name } = parseKind(kind)

  if (category === 'basic') {
    if (name === 'database') {
      return { width: 140, height: 120 }
    }

    if (name === 'cloud') {
      return { width: 180, height: 110 }
    }

    return { width: 160, height: 90 }
  }

  return { width: 96, height: 112 }
}
