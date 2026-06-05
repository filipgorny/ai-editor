import { Node, NodeKind } from './Node'

// FolderNode to żółty root monorepo, do którego podpięte są serwisy.
export class FolderNode extends Node {
  constructor(id: string, name: string, file: string, app: string) {
    super(id, name, file, app, [])
  }

  get kind(): NodeKind {
    return 'folder'
  }
}
