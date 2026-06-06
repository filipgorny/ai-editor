import { contextBridge, ipcRenderer } from 'electron'

// Zapamiętany układ okna edytora (pozycja/rozmiar/snap) + lista otwartych plików.
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

// --- Agent AI ze skillami (bidi stream przez gateway → ai) ---
// Lekki kontekst zadania; treści/graf AI dobiera skillami wykonywanymi przez aplikację.
type AskContext = {
  instruction?: string
  openFile?: string
  selectedKind?: string
  selectedName?: string
  selectedFile?: string
}
type AskStart = { prompt: string; dir?: string; lang?: string; edit?: boolean; context?: AskContext }
type AskEvent =
  | { type: 'plan'; plan: string }
  | { type: 'tool'; tool: { name: string; args: string; result: string } }
  | { type: 'answer'; answer: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
type SkillRequest = { id: string; name: string; args: string }
type SkillResult = { id: string; content?: string; error?: string }

// --- Tasks / Jira / stats (views 4 + topbar) ---
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
type Stats = { keystrokes: number; lines: number; tasks: number; day: string }
type TelescopeHit = { path: string; absPath: string; line?: number; preview?: string; kind: 'name' | 'content' }

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
  defLinks: (
    path: string,
    content: string
  ): Promise<
    { fromLine: number; fromCol: number; toLine: number; toCol: number; targetPath: string; targetLine: number }[]
  > => ipcRenderer.invoke('def:links', { path, content }),
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

  // --- Git: autorstwo + diff-review (przez gateway → serwis git) ---
  gitUpload: (repoPath: string): Promise<{ ok: boolean; files: number; headBranch: string }> =>
    ipcRenderer.invoke('git:upload', repoPath),
  gitFileInfo: (
    repoPath: string,
    file: string
  ): Promise<{
    tracked: boolean
    lastAuthor: string
    lastAuthorEmail: string
    lastCommitHash: string
    lastCommitTime: number
    lastMessage: string
  }> => ipcRenderer.invoke('git:fileInfo', { repoPath, file }),
  gitReview: (
    repoPath: string,
    base?: string
  ): Promise<{ base: string; head: string; files: { path: string; absPath: string; status: string }[] }> =>
    ipcRenderer.invoke('git:review', { repoPath, base: base ?? '' }),
  gitFileDiff: (
    repoPath: string,
    file: string,
    base?: string
  ): Promise<{ status: string; addedLines: number[]; modifiedLines: number[] }> =>
    ipcRenderer.invoke('git:fileDiff', { repoPath, file, base: base ?? '' }),

  // --- Układ okien edytorów per projekt (lokalny SQLite) ---
  getEditorLayout: (folder: string): Promise<EditorLayout | null> => ipcRenderer.invoke('editors:get', folder),
  saveEditorLayout: (folder: string, data: EditorLayout): Promise<boolean> =>
    ipcRenderer.invoke('editors:set', { folder, data }),

  // --- Pełny stan sesji per projekt (lokalny SQLite) + ostatnio otwarty projekt ---
  getState: <T = unknown>(key: string): Promise<T | null> => ipcRenderer.invoke('state:get', key),
  setState: (key: string, value: unknown): Promise<boolean> => ipcRenderer.invoke('state:set', { key, value }),
  setLastFolder: (folder: string): Promise<boolean> => ipcRenderer.invoke('app:setLastFolder', folder),

  saveViewport: (key: string, vp: { x: number; y: number; zoom: number }): Promise<boolean> =>
    ipcRenderer.invoke('viewport:set', { key, vp }),
  getViewport: (key: string): Promise<{ x: number; y: number; zoom: number } | null> =>
    ipcRenderer.invoke('viewport:get', key),
  getSettings: (): Promise<{
    provider?: string
    appTheme?: string
    editorTheme?: string
    wallpaper?: string
    gitBlame?: 'off' | 'last'
    rainbowBrackets?: boolean
    vim?: boolean
    copilot?: boolean
    eachFnColor?: boolean
  }> => ipcRenderer.invoke('settings:get'),
  setSettings: (s: {
    provider?: string
    appTheme?: string
    editorTheme?: string
    wallpaper?: string
    gitBlame?: 'off' | 'last'
    rainbowBrackets?: boolean
    vim?: boolean
    copilot?: boolean
    eachFnColor?: boolean
  }): Promise<boolean> => ipcRenderer.invoke('settings:set', s),
  aiSetProvider: (provider: string): Promise<string> => ipcRenderer.invoke('ai:provider', provider),
  claudeStatus: (): Promise<{ loggedIn: boolean; email: string; method: string; installed: boolean }> =>
    ipcRenderer.invoke('claude:status'),
  claudeLogin: (): Promise<boolean> => ipcRenderer.invoke('claude:login'),
  // setup-token: otwiera przeglądarkę i wypisuje token w terminalu (do wklejenia w okienku).
  claudeSetupToken: (): Promise<boolean> => ipcRenderer.invoke('claude:setupToken'),
  // wyślij token do serwisu ai (kontener zapisuje go u siebie). Zwraca, czy token jest ustawiony.
  claudeSaveToken: (token: string): Promise<boolean> => ipcRenderer.invoke('claude:saveToken', token),
  // czy serwis ai ma zapisany token Claude (źródło prawdy dla bramki logowania).
  claudeTokenStatus: (): Promise<boolean> => ipcRenderer.invoke('claude:tokenStatus'),
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

  // --- Agent AI ze skillami (bidi). aiAsk startuje turę; skille (read_file/list_dir/get_graph)
  // przychodzą jako onAiSkill, a aplikacja odsyła wynik przez aiSkillResult. ---
  aiAsk: (payload: AskStart): void => ipcRenderer.send('ai:ask:start', payload),
  aiSkillResult: (res: SkillResult): void => ipcRenderer.send('ai:skill:result', res),
  aiAskCancel: (): void => ipcRenderer.send('ai:ask:cancel'),
  onAiEvent: (cb: (ev: AskEvent) => void): (() => void) => {
    const handler = (_e: unknown, ev: AskEvent) => cb(ev)

    ipcRenderer.on('ai:event', handler)

    return () => ipcRenderer.removeListener('ai:event', handler)
  },
  onAiSkill: (cb: (req: SkillRequest) => void): (() => void) => {
    const handler = (_e: unknown, req: SkillRequest) => cb(req)

    ipcRenderer.on('ai:skill', handler)

    return () => ipcRenderer.removeListener('ai:skill', handler)
  },
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

  // --- App logs (via gateway → logs service; its own database) ---
  appendLogs: (entries: { time: number; level: string; message: string; source?: string }[]): Promise<boolean> =>
    ipcRenderer.invoke('logs:append', entries),
  listLogs: (
    limit?: number
  ): Promise<{ id: number; time: number; level: string; message: string; source: string }[]> =>
    ipcRenderer.invoke('logs:list', limit ?? 0),
  clearLogs: (): Promise<boolean> => ipcRenderer.invoke('logs:clear'),

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
  },

  // ---- Terminal PTY (view 6) ----
  // One PTY per id (string). Backed by node-pty in main (lazy-required); if the native
  // module is missing the main process emits an onTermExit with code -1.
  termStart: (opts: { id: string; cwd?: string; cols?: number; rows?: number; shell?: string }): void =>
    ipcRenderer.send('term:start', opts),
  termWrite: (id: string, data: string): void => ipcRenderer.send('term:write', { id, data }),
  termResize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('term:resize', { id, cols, rows }),
  termKill: (id: string): void => ipcRenderer.send('term:kill', id),
  onTermData: (cb: (ev: { id: string; data: string }) => void): (() => void) => {
    const handler = (_e: unknown, ev: { id: string; data: string }) => cb(ev)

    ipcRenderer.on('term:data', handler)

    return () => ipcRenderer.removeListener('term:data', handler)
  },
  onTermExit: (cb: (ev: { id: string; code: number }) => void): (() => void) => {
    const handler = (_e: unknown, ev: { id: string; code: number }) => cb(ev)

    ipcRenderer.on('term:exit', handler)

    return () => ipcRenderer.removeListener('term:exit', handler)
  },

  // ---- Web browser (view 7) ----
  browserSetEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('browser:setEnabled', enabled),
  browserNavigate: (id: string, url: string): Promise<{ url: string }> =>
    ipcRenderer.invoke('browser:navigate', { id, url }),
  browserHistory: (id: string): Promise<{ url: string; title: string; ts: number }[]> =>
    ipcRenderer.invoke('browser:history', id),

  // ---- Tasks store (view 4) ----
  tasksList: (project: string): Promise<Task[]> => ipcRenderer.invoke('tasks:list', project),
  tasksSave: (t: {
    id?: number
    title: string
    description?: string
    status?: string
    jiraKey?: string
    branch?: string
    project: string
  }): Promise<Task> => ipcRenderer.invoke('tasks:save', t),
  tasksDelete: (id: number): Promise<boolean> => ipcRenderer.invoke('tasks:delete', id),
  tasksSetActive: (id: number): Promise<Task> => ipcRenderer.invoke('tasks:setActive', id),
  jiraGetConfig: (): Promise<JiraConfig | null> => ipcRenderer.invoke('jira:getConfig'),
  jiraSetConfig: (cfg: JiraConfig): Promise<boolean> => ipcRenderer.invoke('jira:setConfig', cfg),
  jiraImport: (): Promise<Task[]> => ipcRenderer.invoke('jira:import'),

  // ---- Telescope finder (Esc+Space) ----
  telescopeFind: (
    query: string,
    opts?: { root?: string; limit?: number; content?: boolean }
  ): Promise<TelescopeHit[]> => ipcRenderer.invoke('telescope:find', { query, opts }),

  // ---- Stats counters (topbar) ----
  statsGet: (): Promise<Stats> => ipcRenderer.invoke('stats:get'),
  statsBump: (field: 'keystrokes' | 'lines' | 'tasks', by?: number): Promise<Stats> =>
    ipcRenderer.invoke('stats:bump', { field, by }),

  // ---- Git auto-branch (tasks view) ----
  gitCurrentBranch: (repoPath: string): Promise<{ branch: string; dirty: boolean }> =>
    ipcRenderer.invoke('git:currentBranch', repoPath),
  gitCreateBranch: (repoPath: string, name: string, base?: string): Promise<{ branch: string; created: boolean }> =>
    ipcRenderer.invoke('git:createBranch', { repoPath, name, base }),
  gitCheckoutBranch: (repoPath: string, name: string): Promise<{ branch: string }> =>
    ipcRenderer.invoke('git:checkoutBranch', { repoPath, name })
}

contextBridge.exposeInMainWorld('api', api)
