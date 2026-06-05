import { Dependency } from './Dependency'
import { Node, NodeKind } from './Node'

// Graph to korzeń agregatu: węzły (encje) i zależności między nimi. Pilnuje
// niezmiennika — udostępniane zależności wskazują wyłącznie istniejące węzły.
export class Graph {
  private readonly byId: Map<string, Node>

  constructor(
    private readonly _projectId: string,
    private readonly _folder: string,
    private readonly _nodes: readonly Node[],
    private readonly _dependencies: readonly Dependency[]
  ) {
    this.byId = new Map(_nodes.map((n) => [n.id, n]))
  }

  get projectId(): string {
    return this._projectId
  }

  get folder(): string {
    return this._folder
  }

  nodes(): readonly Node[] {
    return this._nodes
  }

  dependencies(): readonly Dependency[] {
    return this._dependencies.filter((d) => this.byId.has(d.from) && this.byId.has(d.to))
  }

  node(id: string): Node | undefined {
    return this.byId.get(id)
  }

  nodesOfKind(kind: NodeKind): Node[] {
    return this._nodes.filter((n) => n.kind === kind)
  }

  dependenciesFrom(id: string): Dependency[] {
    return this.dependencies().filter((d) => d.from === id)
  }

  dependentsOf(id: string): Dependency[] {
    return this.dependencies().filter((d) => d.to === id)
  }

  isEmpty(): boolean {
    return this._nodes.length === 0
  }

  size(): number {
    return this._nodes.length
  }
}
