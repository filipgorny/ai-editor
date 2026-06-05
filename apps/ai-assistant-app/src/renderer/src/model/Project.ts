// Project to encja przeskanowanego projektu (root: pojedyncza app albo monorepo).
export class Project {
  constructor(
    private readonly _id: string,
    private readonly _folder: string,
    private readonly _gitPath: string,
    private readonly _kind: string
  ) {}

  get id(): string {
    return this._id
  }

  get folder(): string {
    return this._folder
  }

  get gitPath(): string {
    return this._gitPath
  }

  get kind(): string {
    return this._kind
  }

  isMonorepo(): boolean {
    return this._kind === 'monorepo'
  }
}
