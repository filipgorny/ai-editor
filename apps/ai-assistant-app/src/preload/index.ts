import { contextBridge, ipcRenderer } from 'electron'

const api = {
  lastFolder: (): Promise<string> => ipcRenderer.invoke('app:lastFolder'),
  pickFolder: (): Promise<string> => ipcRenderer.invoke('dialog:pickFolder'),
  listProjects: (): Promise<any> => ipcRenderer.invoke('projects:list'),
  getGraph: (projectId: number): Promise<any> => ipcRenderer.invoke('graph:get', projectId),
  getAppGraph: (appId: number): Promise<any> => ipcRenderer.invoke('graph:getApp', appId),
  startScan: (path: string): void => ipcRenderer.send('scan:start', path),
  startScanApp: (appId: number): void => ipcRenderer.send('app:scan:start', appId),

  readFile: (absPath: string): Promise<string> => ipcRenderer.invoke('file:read', absPath),
  resolveImport: (from: string, spec: string): Promise<string> =>
    ipcRenderer.invoke('file:resolve', { from, spec }),
  createFile: (dir: string, file: string, name: string): Promise<string> =>
    ipcRenderer.invoke('file:create', { dir, file, name }),
  createFolder: (dir: string, name: string): Promise<string> =>
    ipcRenderer.invoke('file:mkdir', { dir, name }),
  moveFile: (oldPath: string, targetDir: string): Promise<string> =>
    ipcRenderer.invoke('file:move', { oldPath, targetDir }),
  deleteFile: (path: string): Promise<boolean> => ipcRenderer.invoke('file:delete', path),
  aiAgent: (
    prompt: string,
    dir: string,
    lang: string
  ): Promise<{ ops: { op: string; path: string }[]; openPath: string; message: string }> =>
    ipcRenderer.invoke('ai:agent', { prompt, dir, lang }),
  fsHome: (): Promise<string> => ipcRenderer.invoke('fs:home'),
  fsList: (path: string): Promise<unknown> => ipcRenderer.invoke('fs:list', path),
  fsFind: (path: string): Promise<unknown> => ipcRenderer.invoke('fs:find', path),
  fsConventions: (path: string): Promise<{ convention: string; extension: string }> =>
    ipcRenderer.invoke('fs:conventions', path),
  saveViewport: (key: string, vp: { x: number; y: number; zoom: number }): Promise<boolean> =>
    ipcRenderer.invoke('viewport:set', { key, vp }),
  getViewport: (key: string): Promise<{ x: number; y: number; zoom: number } | null> =>
    ipcRenderer.invoke('viewport:get', key),
  getSettings: (): Promise<{ provider: string }> => ipcRenderer.invoke('settings:get'),
  setSettings: (s: { provider: string }): Promise<boolean> => ipcRenderer.invoke('settings:set', s),
  aiSetProvider: (provider: string): Promise<string> => ipcRenderer.invoke('ai:provider', provider),
  renameFile: (oldPath: string, fileBase: string, className: string, oldName: string): Promise<string> =>
    ipcRenderer.invoke('file:rename', { oldPath, fileBase, className, oldName }),
  saveFile: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save', { path, content }),
  aiEdit: (code: string, prompt: string, file: string): Promise<string> =>
    ipcRenderer.invoke('ai:edit', { code, prompt, file }),
  aiModel: (): Promise<string> => ipcRenderer.invoke('ai:model'),
  aiComplete: (prefix: string, suffix: string, file: string): Promise<string> =>
    ipcRenderer.invoke('ai:complete', { prefix, suffix, file }),
  aiReview: (code: string, file: string, lang: string): Promise<{ line: number; text: string }[]> =>
    ipcRenderer.invoke('ai:review', { code, file, lang }),
  lintFile: (code: string, file: string): Promise<{ line: number; text: string; severity: number }[]> =>
    ipcRenderer.invoke('lint:file', { code, file }),
  publishEvent: (ev: {
    type: string
    title?: string
    body?: string
    appId?: number
    file?: string
    nodeId?: string
  }): Promise<unknown> => ipcRenderer.invoke('event:publish', ev),

  // --- User scripts (via gateway → scripting service; Postgres) ---
  // project is optional ('' = global). listScripts(project) → global + pinned.
  listScripts: (
    project?: string
  ): Promise<
    { id: number; name: string; content: string; project: string; createdAt: number; updatedAt: number }[]
  > => ipcRenderer.invoke('scripts:list', project ?? ''),
  getScript: (
    id: number
  ): Promise<{ id: number; name: string; content: string; project: string; createdAt: number; updatedAt: number }> =>
    ipcRenderer.invoke('scripts:get', id),
  saveScript: (s: {
    id?: number
    name: string
    content: string
    project?: string
  }): Promise<{ id: number; name: string; content: string; project: string; createdAt: number; updatedAt: number }> =>
    ipcRenderer.invoke('scripts:save', s),
  deleteScript: (id: number): Promise<boolean> => ipcRenderer.invoke('scripts:delete', id),

  onProgress: (cb: (p: any) => void): (() => void) => {
    const handler = (_e: unknown, p: any) => cb(p)

    ipcRenderer.on('scan:progress', handler)

    return () => ipcRenderer.removeListener('scan:progress', handler)
  },

  onScanEnd: (cb: () => void): (() => void) => {
    const handler = () => cb()

    ipcRenderer.on('scan:end', handler)

    return () => ipcRenderer.removeListener('scan:end', handler)
  },

  onScanError: (cb: (msg: string) => void): (() => void) => {
    const handler = (_e: unknown, msg: string) => cb(msg)

    ipcRenderer.on('scan:error', handler)

    return () => ipcRenderer.removeListener('scan:error', handler)
  },

  // --- Disk watcher: react to files appearing/disappearing on disk ---
  watchProject: (path: string): void => ipcRenderer.send('fs:watch:start', path),
  stopWatch: (): void => ipcRenderer.send('fs:watch:stop'),
  onFsChange: (cb: (ev: { path: string; op: string; dir: boolean }) => void): (() => void) => {
    const handler = (_e: unknown, ev: { path: string; op: string; dir: boolean }) => cb(ev)

    ipcRenderer.on('fs:change', handler)

    return () => ipcRenderer.removeListener('fs:change', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
