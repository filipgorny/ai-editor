// window.api to granica infrastruktury — zwraca surowe obiekty z gRPC, które
// warstwa antykorupcyjna (GatewayMapper) tłumaczy na model domenowy.
declare global {
  // Script — a user script record (scripting service). project '' = global;
  // createdAt/updatedAt: unix seconds.
  type Script = {
    id: number
    name: string
    content: string
    project: string
    createdAt: number
    updatedAt: number
  }

  interface Window {
    api: {
      lastFolder(): Promise<string>
      pickFolder(): Promise<string>
      listProjects(): Promise<unknown>
      getGraph(projectId: number): Promise<unknown>
      getAppGraph(appId: number): Promise<unknown>
      startScan(path: string): void
      startScanApp(appId: number): void
      readFile(absPath: string): Promise<string>
      resolveImport(from: string, spec: string): Promise<string>
      createFile(dir: string, file: string, name: string): Promise<string>
      createFolder(dir: string, name: string): Promise<string>
      moveFile(oldPath: string, targetDir: string): Promise<string>
      deleteFile(path: string): Promise<boolean>
      aiAgent(
        prompt: string,
        dir: string,
        lang: string
      ): Promise<{ ops: { op: string; path: string }[]; openPath: string; message: string }>
      fsHome(): Promise<string>
      fsList(path: string): Promise<unknown>
      fsFind(path: string): Promise<unknown>
      fsConventions(path: string): Promise<{ convention: string; extension: string }>
      saveViewport(key: string, vp: { x: number; y: number; zoom: number }): Promise<boolean>
      getViewport(key: string): Promise<{ x: number; y: number; zoom: number } | null>
      getSettings(): Promise<{ provider: string }>
      setSettings(s: { provider: string }): Promise<boolean>
      aiSetProvider(provider: string): Promise<string>
      renameFile(oldPath: string, fileBase: string, className: string, oldName: string): Promise<string>
      saveFile(path: string, content: string): Promise<boolean>
      aiEdit(code: string, prompt: string, file: string): Promise<string>
      aiModel(): Promise<string>
      aiComplete(prefix: string, suffix: string, file: string): Promise<string>
      aiReview(code: string, file: string, lang: string): Promise<{ line: number; text: string }[]>
      lintFile(code: string, file: string): Promise<{ line: number; text: string; severity: number }[]>
      publishEvent(ev: {
        type: string
        title?: string
        body?: string
        appId?: number
        file?: string
        nodeId?: string
      }): Promise<unknown>
      listScripts(project?: string): Promise<Script[]>
      getScript(id: number): Promise<Script>
      saveScript(s: { id?: number; name: string; content: string; project?: string }): Promise<Script>
      deleteScript(id: number): Promise<boolean>
      onProgress(cb: (p: unknown) => void): () => void
      onScanEnd(cb: () => void): () => void
      onScanError(cb: (msg: string) => void): () => void
      watchProject(path: string): void
      stopWatch(): void
      onFsChange(cb: (ev: { path: string; op: string; dir: boolean }) => void): () => void
    }
  }
}

export {}
