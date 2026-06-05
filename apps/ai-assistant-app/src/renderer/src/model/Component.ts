import { Func } from './Func'
import { Node, NodeKind } from './Node'

// Component to encja komponentu React (frontend).
export class Component extends Node {
  constructor(id: string, name: string, file: string, app: string, functions: readonly Func[] = []) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'component'
  }
}
