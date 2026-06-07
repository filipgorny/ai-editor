import { Func } from './Func'
import { Node, NodeKind } from './Node'

// Model to encja modelu danych (np. message/enum Protobuf). Pola modelu trafiają
// w listę funkcji (wspólny typ), więc renderują się jak metody na klocku.
export class Model extends Node {
  constructor(id: string, name: string, file: string, app: string, functions: readonly Func[] = []) {
    super(id, name, file, app, functions)
  }

  get kind(): NodeKind {
    return 'model'
  }
}
