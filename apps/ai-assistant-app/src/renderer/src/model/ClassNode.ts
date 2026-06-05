import { Func } from './Func'
import { Node, NodeKind } from './Node'

// ClassNode to zwykła (niedekorowana) klasa.
export class ClassNode extends Node {
  constructor(id: string, name: string, file: string, app: string, functions: readonly Func[]) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'class'
  }
}
