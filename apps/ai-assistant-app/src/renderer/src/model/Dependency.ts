// DependencyKind to rodzaj relacji między bytami (kreska w grafie).
export type DependencyKind =
  | 'import'
  | 'controller'
  | 'provider'
  | 'injects'
  | 'renders'
  | 'contains'

// Dependency to relacja skierowana między dwoma węzłami (po ich id).
export class Dependency {
  constructor(
    private readonly _from: string,
    private readonly _to: string,
    private readonly _kind: DependencyKind
  ) {}

  get from(): string {
    return this._from
  }

  get to(): string {
    return this._to
  }

  get kind(): DependencyKind {
    return this._kind
  }

  get id(): string {
    return `${this._from}->${this._to}:${this._kind}`
  }

  isInjection(): boolean {
    return this._kind === 'injects'
  }
}
