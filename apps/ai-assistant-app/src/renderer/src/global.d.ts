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

  // Zapamiętany układ okien edytorów dla projektu (SQLite w procesie main).
  type EditorWin = {
    path: string
    x?: number
    y?: number
    w?: number
    h?: number
    snapped?: boolean
    fullscreen?: boolean
  }
  type EditorLayout = { editors: EditorWin[]; active?: string; minimized?: string[]; snapped?: string[] }

  // Agent AI ze skillami (bidi). Treści/graf AI dobiera skillami wykonywanymi przez aplikację.
  type AiAskContext = {
    instruction?: string
    openFile?: string
    selectedKind?: string
    selectedName?: string
    selectedFile?: string
  }
  type AiAskStart = { prompt: string; dir?: string; lang?: string; edit?: boolean; context?: AiAskContext }
  type AiAskEvent =
    | { type: 'plan'; plan: string }
    | { type: 'tool'; tool: { name: string; args: string; result: string } }
    | { type: 'answer'; answer: string }
    | { type: 'done' }
    | { type: 'error'; message: string }
  type AiSkillRequest = { id: string; name: string; args: string }
  type AiSkillResult = { id: string; content?: string; error?: string }

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
      defLinks(
        path: string,
        content: string
      ): Promise<
        { fromLine: number; fromCol: number; toLine: number; toCol: number; targetPath: string; targetLine: number }[]
      >
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
      gitUpload(repoPath: string): Promise<{ ok: boolean; files: number; headBranch: string }>
      gitFileInfo(
        repoPath: string,
        file: string
      ): Promise<{
        tracked: boolean
        lastAuthor: string
        lastAuthorEmail: string
        lastCommitHash: string
        lastCommitTime: number
        lastMessage: string
      }>
      gitReview(
        repoPath: string,
        base?: string
      ): Promise<{ base: string; head: string; files: { path: string; absPath: string; status: string }[] }>
      gitFileDiff(
        repoPath: string,
        file: string,
        base?: string
      ): Promise<{ status: string; addedLines: number[]; modifiedLines: number[] }>
      getEditorLayout(folder: string): Promise<EditorLayout | null>
      saveEditorLayout(folder: string, data: EditorLayout): Promise<boolean>
      saveViewport(key: string, vp: { x: number; y: number; zoom: number }): Promise<boolean>
      getViewport(key: string): Promise<{ x: number; y: number; zoom: number } | null>
      getSettings(): Promise<{
        provider?: string
        appTheme?: string
        editorTheme?: string
        wallpaper?: string
        gitBlame?: 'off' | 'last'
        rainbowBrackets?: boolean
      }>
      setSettings(s: {
        provider?: string
        appTheme?: string
        editorTheme?: string
        wallpaper?: string
        gitBlame?: 'off' | 'last'
        rainbowBrackets?: boolean
      }): Promise<boolean>
      aiSetProvider(provider: string): Promise<string>
      claudeStatus(): Promise<{ loggedIn: boolean; email: string; method: string; installed: boolean }>
      claudeLogin(): Promise<boolean>
      claudeSetupToken(): Promise<boolean>
      claudeSaveToken(token: string): Promise<boolean>
      claudeTokenStatus(): Promise<boolean>
      renameFile(oldPath: string, fileBase: string, className: string, oldName: string): Promise<string>
      saveFile(path: string, content: string): Promise<boolean>
      aiEdit(code: string, prompt: string, file: string): Promise<string>
      aiModel(): Promise<string>
      aiComplete(prefix: string, suffix: string, file: string): Promise<string>
      aiReview(code: string, file: string, lang: string): Promise<{ line: number; text: string }[]>
      aiAsk(payload: AiAskStart): void
      aiSkillResult(res: AiSkillResult): void
      aiAskCancel(): void
      onAiEvent(cb: (ev: AiAskEvent) => void): () => void
      onAiSkill(cb: (req: AiSkillRequest) => void): () => void
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
      appendLogs(entries: { time: number; level: string; message: string; source?: string }[]): Promise<boolean>
      listLogs(limit?: number): Promise<{ id: number; time: number; level: string; message: string; source: string }[]>
      clearLogs(): Promise<boolean>
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
