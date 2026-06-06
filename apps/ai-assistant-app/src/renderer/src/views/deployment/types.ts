// Shared types for the deployment-diagram view (ViewKey 'deployment').
//
// The diagram is a small, self-contained domain: black & white shapes (rectangle,
// database/cylinder, cloud) connected by arrows whose head style is selectable. The
// persisted shape mirrors the reactflow node/edge shape closely so we can hydrate
// straight back into useNodesState/useEdgesState with no translation layer.

// BasicShapeKind — the three monochrome shape primitives offered in the left gallery.

// AwsShapeKind — popular AWS service icons. These intentionally break the black & white
// convention: each renders in its official AWS category color (see DeploymentView).
export type AwsShapeKind =
  | 'aws-ec2'
  | 'aws-lambda'
  | 'aws-ecs'
  | 'aws-s3'
  | 'aws-rds'
  | 'aws-dynamodb'
  | 'aws-apigateway'
  | 'aws-sqs'
  | 'aws-sns'
  | 'aws-cloudfront'
  | 'aws-vpc'
  | 'aws-elb'
  | 'aws-iam'
  | 'aws-cloudwatch'

// ShapeKind — every shape offered in the gallery (basic primitives + AWS services).
export type ShapeKind = string;

// ShapeCategory — gallery grouping for a kind.
export type ShapeCategory = 'basic' | 'aws'

// ArrowStyle — how an edge terminates. Mirrors the arrow-style panel under the gallery.
//   solid  — filled arrowhead at the target end
//   empty  — hollow (outline) arrowhead at the target end
//   none   — a plain line, no head
//   both   — filled arrowheads at BOTH ends (bidirectional)
export type ArrowStyle = 'solid' | 'empty' | 'none' | 'both'

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

// Default pixel size a freshly-dropped shape gets.
export const DEFAULT_SHAPE_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 160, height: 90 },
  database: { width: 140, height: 120 },
  cloud: { width: 180, height: 110 }
}
