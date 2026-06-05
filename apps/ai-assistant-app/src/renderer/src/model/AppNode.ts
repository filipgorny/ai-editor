import { Node, NodeKind } from './Node'

// AppNode to węzeł-serwis na grafie monorepo (klikalny → drill-down do wnętrza).
export class AppNode extends Node {
  constructor(id: string, name: string, file: string, app: string, private readonly _appId: number) {
    super(id, name, file, app, [])
  }

  get kind(): NodeKind {
    return 'app'
  }

  get appId(): number {
    return this._appId
  }
}
