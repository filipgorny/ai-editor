import { Func } from './Func'
import { Node, NodeKind } from './Node'
import { Route } from './Route'

// Controller to encja kontrolera (np. NestJS @Controller) z route i akcjami.
export class Controller extends Node {
  constructor(
    id: string,
    name: string,
    file: string,
    app: string,
    functions: readonly Func[],
    private readonly _route: Route
  ) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'controller'
  }

  get route(): Route {
    return this._route
  }

  // actions to akcje HTTP kontrolera (jego metody publiczne).
  get actions(): readonly Func[] {
    return this.functions
  }

  handlesRoute(): boolean {
    return !this._route.isEmpty()
  }
}
