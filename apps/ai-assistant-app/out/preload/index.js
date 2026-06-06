"use strict";
const electron = require("electron");
const api = {
  lastFolder: () => electron.ipcRenderer.invoke("app:lastFolder"),
  pickFolder: () => electron.ipcRenderer.invoke("dialog:pickFolder"),
  listProjects: () => electron.ipcRenderer.invoke("projects:list"),
  getGraph: (projectId) => electron.ipcRenderer.invoke("graph:get", projectId),
  getAppGraph: (appId) => electron.ipcRenderer.invoke("graph:getApp", appId),
  startScan: (path) => electron.ipcRenderer.send("scan:start", path),
  startScanApp: (appId) => electron.ipcRenderer.send("app:scan:start", appId),
  readFile: (absPath) => electron.ipcRenderer.invoke("file:read", absPath),
  resolveImport: (from, spec) => electron.ipcRenderer.invoke("file:resolve", { from, spec }),
  defLinks: (path, content) => electron.ipcRenderer.invoke("def:links", { path, content }),
  createFile: (dir, file, name) => electron.ipcRenderer.invoke("file:create", { dir, file, name }),
  createFolder: (dir, name) => electron.ipcRenderer.invoke("file:mkdir", { dir, name }),
  moveFile: (oldPath, targetDir) => electron.ipcRenderer.invoke("file:move", { oldPath, targetDir }),
  deleteFile: (path) => electron.ipcRenderer.invoke("file:delete", path),
  aiAgent: (prompt, dir, lang) => electron.ipcRenderer.invoke("ai:agent", { prompt, dir, lang }),
  fsHome: () => electron.ipcRenderer.invoke("fs:home"),
  fsList: (path) => electron.ipcRenderer.invoke("fs:list", path),
  fsFind: (path) => electron.ipcRenderer.invoke("fs:find", path),
  fsConventions: (path) => electron.ipcRenderer.invoke("fs:conventions", path),
  // --- Git: autorstwo + diff-review (przez gateway → serwis git) ---
  gitUpload: (repoPath) => electron.ipcRenderer.invoke("git:upload", repoPath),
  gitFileInfo: (repoPath, file) => electron.ipcRenderer.invoke("git:fileInfo", { repoPath, file }),
  gitReview: (repoPath, base) => electron.ipcRenderer.invoke("git:review", { repoPath, base: base ?? "" }),
  gitFileDiff: (repoPath, file, base) => electron.ipcRenderer.invoke("git:fileDiff", { repoPath, file, base: base ?? "" }),
  // --- Układ okien edytorów per projekt (lokalny SQLite) ---
  getEditorLayout: (folder) => electron.ipcRenderer.invoke("editors:get", folder),
  saveEditorLayout: (folder, data) => electron.ipcRenderer.invoke("editors:set", { folder, data }),
  // --- Pełny stan sesji per projekt (lokalny SQLite) + ostatnio otwarty projekt ---
  getState: (key) => electron.ipcRenderer.invoke("state:get", key),
  setState: (key, value) => electron.ipcRenderer.invoke("state:set", { key, value }),
  setLastFolder: (folder) => electron.ipcRenderer.invoke("app:setLastFolder", folder),
  saveViewport: (key, vp) => electron.ipcRenderer.invoke("viewport:set", { key, vp }),
  getViewport: (key) => electron.ipcRenderer.invoke("viewport:get", key),
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  setSettings: (s) => electron.ipcRenderer.invoke("settings:set", s),
  aiSetProvider: (provider) => electron.ipcRenderer.invoke("ai:provider", provider),
  claudeStatus: () => electron.ipcRenderer.invoke("claude:status"),
  claudeLogin: () => electron.ipcRenderer.invoke("claude:login"),
  // setup-token: otwiera przeglądarkę i wypisuje token w terminalu (do wklejenia w okienku).
  claudeSetupToken: () => electron.ipcRenderer.invoke("claude:setupToken"),
  // wyślij token do serwisu ai (kontener zapisuje go u siebie). Zwraca, czy token jest ustawiony.
  claudeSaveToken: (token) => electron.ipcRenderer.invoke("claude:saveToken", token),
  // czy serwis ai ma zapisany token Claude (źródło prawdy dla bramki logowania).
  claudeTokenStatus: () => electron.ipcRenderer.invoke("claude:tokenStatus"),
  renameFile: (oldPath, fileBase, className, oldName) => electron.ipcRenderer.invoke("file:rename", { oldPath, fileBase, className, oldName }),
  saveFile: (path, content) => electron.ipcRenderer.invoke("file:save", { path, content }),
  aiEdit: (code, prompt, file) => electron.ipcRenderer.invoke("ai:edit", { code, prompt, file }),
  aiModel: () => electron.ipcRenderer.invoke("ai:model"),
  aiComplete: (prefix, suffix, file) => electron.ipcRenderer.invoke("ai:complete", { prefix, suffix, file }),
  aiReview: (code, file, lang) => electron.ipcRenderer.invoke("ai:review", { code, file, lang }),
  // --- Agent AI ze skillami (bidi). aiAsk startuje turę; skille (read_file/list_dir/get_graph)
  // przychodzą jako onAiSkill, a aplikacja odsyła wynik przez aiSkillResult. ---
  aiAsk: (payload) => electron.ipcRenderer.send("ai:ask:start", payload),
  aiSkillResult: (res) => electron.ipcRenderer.send("ai:skill:result", res),
  aiAskCancel: () => electron.ipcRenderer.send("ai:ask:cancel"),
  onAiEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    electron.ipcRenderer.on("ai:event", handler);
    return () => electron.ipcRenderer.removeListener("ai:event", handler);
  },
  onAiSkill: (cb) => {
    const handler = (_e, req) => cb(req);
    electron.ipcRenderer.on("ai:skill", handler);
    return () => electron.ipcRenderer.removeListener("ai:skill", handler);
  },
  lintFile: (code, file) => electron.ipcRenderer.invoke("lint:file", { code, file }),
  publishEvent: (ev) => electron.ipcRenderer.invoke("event:publish", ev),
  // --- User scripts (via gateway → scripting service; Postgres) ---
  // project is optional ('' = global). listScripts(project) → global + pinned.
  listScripts: (project) => electron.ipcRenderer.invoke("scripts:list", project ?? ""),
  getScript: (id) => electron.ipcRenderer.invoke("scripts:get", id),
  saveScript: (s) => electron.ipcRenderer.invoke("scripts:save", s),
  deleteScript: (id) => electron.ipcRenderer.invoke("scripts:delete", id),
  // --- App logs (via gateway → logs service; its own database) ---
  appendLogs: (entries) => electron.ipcRenderer.invoke("logs:append", entries),
  listLogs: (limit) => electron.ipcRenderer.invoke("logs:list", limit ?? 0),
  clearLogs: () => electron.ipcRenderer.invoke("logs:clear"),
  onProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    electron.ipcRenderer.on("scan:progress", handler);
    return () => electron.ipcRenderer.removeListener("scan:progress", handler);
  },
  onScanEnd: (cb) => {
    const handler = () => cb();
    electron.ipcRenderer.on("scan:end", handler);
    return () => electron.ipcRenderer.removeListener("scan:end", handler);
  },
  onScanError: (cb) => {
    const handler = (_e, msg) => cb(msg);
    electron.ipcRenderer.on("scan:error", handler);
    return () => electron.ipcRenderer.removeListener("scan:error", handler);
  },
  // --- Disk watcher: react to files appearing/disappearing on disk ---
  watchProject: (path) => electron.ipcRenderer.send("fs:watch:start", path),
  stopWatch: () => electron.ipcRenderer.send("fs:watch:stop"),
  onFsChange: (cb) => {
    const handler = (_e, ev) => cb(ev);
    electron.ipcRenderer.on("fs:change", handler);
    return () => electron.ipcRenderer.removeListener("fs:change", handler);
  },
  // ---- Terminal PTY (view 6) ----
  // One PTY per id (string). Backed by node-pty in main (lazy-required); if the native
  // module is missing the main process emits an onTermExit with code -1.
  termStart: (opts) => electron.ipcRenderer.send("term:start", opts),
  termWrite: (id, data) => electron.ipcRenderer.send("term:write", { id, data }),
  termResize: (id, cols, rows) => electron.ipcRenderer.send("term:resize", { id, cols, rows }),
  termKill: (id) => electron.ipcRenderer.send("term:kill", id),
  onTermData: (cb) => {
    const handler = (_e, ev) => cb(ev);
    electron.ipcRenderer.on("term:data", handler);
    return () => electron.ipcRenderer.removeListener("term:data", handler);
  },
  onTermExit: (cb) => {
    const handler = (_e, ev) => cb(ev);
    electron.ipcRenderer.on("term:exit", handler);
    return () => electron.ipcRenderer.removeListener("term:exit", handler);
  },
  // ---- Web browser (view 7) ----
  browserSetEnabled: (enabled) => electron.ipcRenderer.invoke("browser:setEnabled", enabled),
  browserNavigate: (id, url) => electron.ipcRenderer.invoke("browser:navigate", { id, url }),
  browserHistory: (id) => electron.ipcRenderer.invoke("browser:history", id),
  // ---- Tasks store (view 4) ----
  tasksList: (project) => electron.ipcRenderer.invoke("tasks:list", project),
  tasksSave: (t) => electron.ipcRenderer.invoke("tasks:save", t),
  tasksDelete: (id) => electron.ipcRenderer.invoke("tasks:delete", id),
  tasksSetActive: (id) => electron.ipcRenderer.invoke("tasks:setActive", id),
  jiraGetConfig: () => electron.ipcRenderer.invoke("jira:getConfig"),
  jiraSetConfig: (cfg) => electron.ipcRenderer.invoke("jira:setConfig", cfg),
  jiraImport: () => electron.ipcRenderer.invoke("jira:import"),
  // ---- Telescope finder (Esc+Space) ----
  telescopeFind: (query, opts) => electron.ipcRenderer.invoke("telescope:find", { query, opts }),
  // ---- Stats counters (topbar) ----
  statsGet: () => electron.ipcRenderer.invoke("stats:get"),
  statsBump: (field, by) => electron.ipcRenderer.invoke("stats:bump", { field, by }),
  // ---- Git auto-branch (tasks view) ----
  gitCurrentBranch: (repoPath) => electron.ipcRenderer.invoke("git:currentBranch", repoPath),
  gitCreateBranch: (repoPath, name, base) => electron.ipcRenderer.invoke("git:createBranch", { repoPath, name, base }),
  gitCheckoutBranch: (repoPath, name) => electron.ipcRenderer.invoke("git:checkoutBranch", { repoPath, name })
};
electron.contextBridge.exposeInMainWorld("api", api);
