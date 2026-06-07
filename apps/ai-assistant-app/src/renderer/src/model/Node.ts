// Node to bazowa encja domenowa grafu (klocek). Ma tożsamość (id) i zachowanie;
// konkretne typy dziedziczą i nadają kind. Model w stylu DDD — hermetyzacja przez
// gettery, brak surowych pól DTO.

import { Func } from './Func'

export type NodeKind =
  | 'folder'
  | 'module'
  | 'controller'
  | 'service'
  | 'app'
  | 'package'
  | 'component'
  | 'class'
  | 'function'
  | 'model'

export abstract class Node {
  // framework źródłowy (nestjs|react|...) — ustawiany przez mapper, do etykiety/ikony.
  framework = ''
  // język (typescript|go|...) — ustawiany przez mapper; pokazywany z ikoną obok frameworka.
  language = ''
  // absolutna ścieżka pliku — do otwarcia w edytorze.
  absFile = ''

  protected constructor(
    private readonly _id: string,
    private readonly _name: string,
    private readonly _file: string,
    private readonly _app: string,
    private readonly _functions: readonly Func[]
  ) {}

  get id(): string {
    return this._id
  }

  get name(): string {
    return this._name
  }

  get file(): string {
    return this._file
  }

  get app(): string {
    return this._app
  }

  get functions(): readonly Func[] {
    return this._functions
  }

  abstract get kind(): NodeKind

  hasFunctions(): boolean {
    return this._functions.length > 0
  }

  functionCount(): number {
    return this._functions.length
  }
}
