import { useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Graph, Node } from '../model'
import NodeCard from './NodeCard'

const nodeTypes = { entity: NodeCard }

type Pos = { x: number; y: number }
type Link = { from: string; to: string; kind: string }

// estHeight szacuje wysokość klocka (nagłówek + lista funkcji ograniczona do 168px
// + stopka frameworka), by wiersze drzewka się nie nakładały.
function estHeight(n: Node | undefined): number {
  if (!n) {
    return 90
  }

  if (n.kind === 'folder') {
    return 58
  }

  const fns = n.functions.length
  const listH = fns > 0 ? Math.min(fns * 20 + 18, 168) : 0
  const footerH = n.framework ? 30 : 0

  return 70 + listH + footerH
}

// treeLayout układa węzły jak w eksploratorze plików: OD GÓRY W DÓŁ, każdy w
// swoim wierszu; subfoldery niżej i wcięte w prawo; foldery na górze.
function treeLayout(nodes: Node[], links: Link[]): Map<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const l of links) {
    if (l.kind !== 'contains') {
      continue
    }

    if (!children.has(l.from)) {
      children.set(l.from, [])
    }

    children.get(l.from)!.push(l.to)
    hasParent.add(l.to)
  }

  // Foldery na górę, potem alfabetycznie.
  const sortKids = (ids: string[]): string[] =>
    [...ids].sort((a, b) => {
      const na = byId.get(a)
      const nb = byId.get(b)
      const fa = na?.kind === 'folder' ? 0 : 1
      const fb = nb?.kind === 'folder' ? 0 : 1

      return fa !== fb ? fa - fb : (na?.name ?? a).localeCompare(nb?.name ?? b)
    })

  const pos = new Map<string, Pos>()
  const placed = new Set<string>()
  const indent = 300
  let y = 0

  const walk = (id: string, depth: number): void => {
    if (placed.has(id)) {
      return
    }

    placed.add(id)
    pos.set(id, { x: depth * indent, y })
    y += estHeight(byId.get(id)) + 36

    for (const c of sortKids(children.get(id) ?? [])) {
      walk(c, depth + 1)
    }
  }

  for (const n of nodes) {
    if (!hasParent.has(n.id)) {
      walk(n.id, 0)
    }
  }

  for (const n of nodes) {
    if (!placed.has(n.id)) {
      walk(n.id, 0)
    }
  }

  return pos
}

export default function GraphView({
  graph,
  onNodeClick,
  onNodeDoubleClick
}: {
  graph: Graph
  onNodeClick?: (node: Node) => void
  onNodeDoubleClick?: (node: Node) => void
}) {
  // Rozwinięte foldery. Domyślnie tylko korzenie otwarte — reszta zwinięta.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const hasParent = new Set<string>()

    for (const d of graph.dependencies()) {
      if (d.kind === 'contains') {
        hasParent.add(d.to)
      }
    }

    const roots = graph
      .nodes()
      .filter((n) => !hasParent.has(n.id))
      .map((n) => n.id)

    setExpanded(new Set(roots))
  }, [graph])

  const { rfNodes, rfEdges } = useMemo(() => {
    const all = graph.nodes()
    const byId = new Map(all.map((n) => [n.id, n]))
    const children = new Map<string, string[]>()
    const hasParent = new Set<string>()

    for (const d of graph.dependencies()) {
      if (d.kind !== 'contains') {
        continue
      }

      if (!children.has(d.from)) {
        children.set(d.from, [])
      }

      children.get(d.from)!.push(d.to)
      hasParent.add(d.to)
    }

    // Widoczne: korzenie + potomkowie pod rozwiniętymi folderami.
    const visible = new Set<string>()

    const reveal = (id: string): void => {
      if (visible.has(id)) {
        return
      }

      visible.add(id)
      const n = byId.get(id)

      if (n && n.kind === 'folder' && expanded.has(id)) {
        for (const c of children.get(id) ?? []) {
          reveal(c)
        }
      }
    }

    for (const n of all) {
      if (!hasParent.has(n.id)) {
        reveal(n.id)
      }
    }

    const visNodes = all.filter((n) => visible.has(n.id))
    const containsLinks = graph
      .dependencies()
      .filter((d) => d.kind === 'contains' && visible.has(d.from) && visible.has(d.to))
      .map((d) => ({ from: d.from, to: d.to, kind: d.kind }))

    const pos = treeLayout(visNodes, containsLinks)

    const seenN = new Set<string>()
    const nodes: RFNode[] = visNodes
      .filter((n) => (seenN.has(n.id) ? false : seenN.add(n.id)))
      .map((n) => ({ id: n.id, type: 'entity', position: pos.get(n.id) ?? { x: 0, y: 0 }, data: n }))

    const seenE = new Set<string>()
    const edges: RFEdge[] = graph
      .dependencies()
      .filter((d) => visible.has(d.from) && visible.has(d.to))
      .filter((d) => (seenE.has(d.id) ? false : seenE.add(d.id)))
      .map((d) => {
        const isTree = d.kind === 'contains'

        return {
          id: d.id,
          source: d.from,
          target: d.to,
          label: isTree ? undefined : d.kind,
          animated: d.isInjection(),
          interactionWidth: 0,
          style: isTree ? { stroke: '#30363d' } : undefined,
          markerEnd: isTree ? undefined : { type: MarkerType.ArrowClosed }
        }
      })

    return { rfNodes: nodes, rfEdges: edges }
  }, [graph, expanded])

  // Klik w folder = rozwiń/zwiń; inne węzły → propaguj wyżej.
  const handleClick = (node: Node) => {
    if (node.kind === 'folder') {
      setExpanded((prev) => {
        const next = new Set(prev)

        if (next.has(node.id)) {
          next.delete(node.id)
        } else {
          next.add(node.id)
        }

        return next
      })

      return
    }

    onNodeClick?.(node)
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.05}
      panOnScroll
      zoomOnScroll={false}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, n) => handleClick(n.data as Node)}
      onNodeDoubleClick={(_e, n) => onNodeDoubleClick?.(n.data as Node)}
    >
      <Background color="#21262d" gap={20} />
      <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.6)" />
      <Controls />
    </ReactFlow>
  )
}
