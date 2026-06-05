import { Func } from './Func'
import { Node, NodeKind } from './Node'

// FunctionNode to samodzielna, niezależna funkcja (kind=function). Dzieli typ
// funkcji (Func) z metodami klas.
export class FunctionNode extends Node {
  constructor(id: string, name: string, file: string, app: string, functions: readonly Func[] = []) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'function'
  }
}
