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
    cursor?: number
    scroll?: number
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

  // Task — a tracked task (tasks view). status drives the column; active marks the
  // single in-progress task. jiraKey/branch link it to Jira + the auto-created branch.
  type Task = {
    id: number
    title: string
    description: string
    status: 'todo' | 'doing' | 'done'
    jiraKey?: string
    branch?: string
    active: boolean
    project: string
    createdAt: number
    updatedAt: number
  }
  type JiraConfig = { baseUrl: string; email: string; token: string; project: string }
  // Stats — daily counters shown in the topbar; day = YYYY-MM-DD (resets daily).
  type Stats = { keystrokes: number; lines: number; tasks: number; day: string }
  // TelescopeHit — one result row from the Esc+Space finder (filename or content match).
  type TelescopeHit = { path: string; absPath: string; line?: number; preview?: string; kind: 'name' | 'content' }

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
      getState<T = unknown>(key: string): Promise<T | null>
      setState(key: string, value: unknown): Promise<boolean>
      setLastFolder(folder: string): Promise<boolean>
      saveViewport(key: string, vp: { x: number; y: number; zoom: number }): Promise<boolean>
      getViewport(key: string): Promise<{ x: number; y: number; zoom: number } | null>
      getSettings(): Promise<{
        provider?: string
        appTheme?: string
        editorTheme?: string
        wallpaper?: string
        gitBlame?: 'off' | 'last'
        rainbowBrackets?: boolean
        vim?: boolean
        copilot?: boolean
        eachFnColor?: boolean
      }>
      setSettings(s: {
        provider?: string
        appTheme?: string
        editorTheme?: string
        wallpaper?: string
        gitBlame?: 'off' | 'last'
        rainbowBrackets?: boolean
        vim?: boolean
        copilot?: boolean
        eachFnColor?: boolean
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

      // ---- Terminal PTY (view 6) ----
      termStart(opts: { id: string; cwd?: string; cols?: number; rows?: number; shell?: string }): void
      termWrite(id: string, data: string): void
      termResize(id: string, cols: number, rows: number): void
      termKill(id: string): void
      onTermData(cb: (ev: { id: string; data: string }) => void): () => void
      onTermExit(cb: (ev: { id: string; code: number }) => void): () => void

      // ---- Web browser (view 7) ----
      browserSetEnabled(enabled: boolean): Promise<boolean>
      browserNavigate(id: string, url: string): Promise<{ url: string }>
      browserHistory(id: string): Promise<{ url: string; title: string; ts: number }[]>

      // ---- React app runner (Run button on the code diagram) ----
      reactDetectApi(cwd: string): Promise<{ url: string }>
      reactProbe(url: string): Promise<{ ok: boolean }>
      reactRun(cwd: string): Promise<{ url: string }>
      reactStop(): Promise<boolean>

      // ---- Tasks store (view 4) ----
      tasksList(project: string): Promise<Task[]>
      tasksSave(t: {
        id?: number
        title: string
        description?: string
        status?: string
        jiraKey?: string
        branch?: string
        project: string
      }): Promise<Task>
      tasksDelete(id: number): Promise<boolean>
      tasksSetActive(id: number): Promise<Task>
      jiraGetConfig(): Promise<JiraConfig | null>
      jiraSetConfig(cfg: JiraConfig): Promise<boolean>
      jiraImport(): Promise<Task[]>

      // ---- Telescope finder (Esc+Space) ----
      telescopeFind(
        query: string,
        opts?: { root?: string; limit?: number; content?: boolean }
      ): Promise<TelescopeHit[]>

      // ---- Stats counters (topbar) ----
      statsGet(): Promise<Stats>
      statsBump(field: 'keystrokes' | 'lines' | 'tasks', by?: number): Promise<Stats>

      // ---- Git auto-branch (tasks view) ----
      gitCurrentBranch(repoPath: string): Promise<{ branch: string; dirty: boolean }>
      gitCreateBranch(repoPath: string, name: string, base?: string): Promise<{ branch: string; created: boolean }>
      gitCheckoutBranch(repoPath: string, name: string): Promise<{ branch: string }>
    }
  }
}

export {}
