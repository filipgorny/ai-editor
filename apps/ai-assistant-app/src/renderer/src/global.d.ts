// window.api to granica infrastruktury — zwraca surowe obiekty z gRPC, które
// warstwa antykorupcyjna (GatewayMapper) tłumaczy na model domenowy.
declare global {
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
      saveFile(path: string, content: string): Promise<boolean>
      aiEdit(code: string, prompt: string, file: string): Promise<string>
      publishEvent(ev: {
        type: string
        title?: string
        body?: string
        appId?: number
        file?: string
        nodeId?: string
      }): Promise<unknown>
      onProgress(cb: (p: unknown) => void): () => void
      onScanEnd(cb: () => void): () => void
      onScanError(cb: (msg: string) => void): () => void
    }
  }
}

export {}
