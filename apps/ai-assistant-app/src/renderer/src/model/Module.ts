import { Func } from './Func'
import { Node, NodeKind } from './Node'

// Module to encja modułu (np. NestJS @Module). Grupuje kontrolery i providery.
export class Module extends Node {
  constructor(id: string, name: string, file: string, app: string, functions: readonly Func[]) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'module'
  }
}
