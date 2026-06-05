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
  saveFile: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('file:save', { path, content }),
  aiEdit: (code: string, prompt: string, file: string): Promise<string> =>
    ipcRenderer.invoke('ai:edit', { code, prompt, file }),
  publishEvent: (ev: {
    type: string
    title?: string
    body?: string
    appId?: number
    file?: string
    nodeId?: string
  }): Promise<unknown> => ipcRenderer.invoke('event:publish', ev),

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
  }
}

contextBridge.exposeInMainWorld('api', api)
