import { Func } from './Func'
import { Node, NodeKind } from './Node'

// Service to encja serwisu (np. NestJS @Injectable) — logika domenowa aplikacji.
export class Service extends Node {
  constructor(id: string, name: string, file: string, app: string, functions: readonly Func[]) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'service'
  }
}
