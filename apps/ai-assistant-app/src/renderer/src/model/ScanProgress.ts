// ScanProgress to obiekt wartości opisujący stan trwającego skanowania.
export class ScanProgress {
  constructor(
    private readonly _message: string,
    private readonly _currentFile: string,
    private readonly _filesDone: number,
    private readonly _entitiesDone: number,
    private readonly _done: boolean,
    private readonly _projectId: string
  ) {}

  static initial(): ScanProgress {
    return new ScanProgress('', '', 0, 0, false, '')
  }

  get message(): string {
    return this._message
  }

  get currentFile(): string {
    return this._currentFile
  }

  get filesDone(): number {
    return this._filesDone
  }

  get entitiesDone(): number {
    return this._entitiesDone
  }

  get done(): boolean {
    return this._done
  }

  get projectId(): string {
    return this._projectId
  }

  hasCurrentFile(): boolean {
    return this._currentFile !== ''
  }
}
