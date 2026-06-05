// mergeAppGraphs composes the monorepo graph with the internal graphs of expanded
// apps. Each app graph is re-id'd (prefix `a<appId>:`) and its top-level entries are
// attached under the monorepo app node via "contains" edges — so an app expands in
// place (like a folder) instead of replacing the whole graph.

type RawNode = { id: string; kind: string; appId?: number | string; [k: string]: unknown }
type RawEdge = { from: string; to: string; label: string }
export type RawGraph = { projectId?: string; folder?: string; nodes?: RawNode[]; edges?: RawEdge[] }

const APP_ROOT = 'folder:.'

export function mergeAppGraphs(base: RawGraph, apps: Record<number, RawGraph>): RawGraph {
  const nodes: RawNode[] = [...(base.nodes ?? [])]
  const edges: RawEdge[] = [...(base.edges ?? [])]
  const baseNodes = base.nodes ?? []

  for (const [appIdStr, app] of Object.entries(apps)) {
    const appId = Number(appIdStr)
    const prefix = `a${appId}:`

    // monorepo app node this internal graph hangs under (appId may be a string —
    // proto int64 with longs:String — so compare numerically)
    const baseAppNode = baseNodes.find((n) => n.kind === 'app' && Number(n.appId) === appId)

    if (!baseAppNode) {
      continue
    }

    // re-id internal nodes (skip the app's own root folder — the app node replaces it)
    for (const n of app.nodes ?? []) {
      if (n.id === APP_ROOT) {
        continue
      }

      nodes.push({ ...n, id: prefix + n.id })
    }

    // re-id internal edges; edges from the app root reconnect to the monorepo app node
    for (const e of app.edges ?? []) {
      if (e.from === APP_ROOT) {
        edges.push({ from: baseAppNode.id, to: prefix + e.to, label: 'contains' })
      } else {
        edges.push({ from: prefix + e.from, to: prefix + e.to, label: e.label })
      }
    }
  }

  return { projectId: base.projectId, folder: base.folder, nodes, edges }
}
