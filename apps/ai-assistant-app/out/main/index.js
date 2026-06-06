"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const path = require("path");
const os = require("os");
const fs = require("fs");
const promises = require("fs/promises");
const child_process = require("child_process");
const electron = require("electron");
const Store = require("electron-store");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const grpc__namespace = /* @__PURE__ */ _interopNamespaceDefault(grpc);
const protoLoader__namespace = /* @__PURE__ */ _interopNamespaceDefault(protoLoader);
let db;
let fallback = null;
function open() {
  if (db !== void 0) {
    return db;
  }
  try {
    const Database = require("better-sqlite3");
    const file = path.join(electron.app.getPath("userData"), "ai-architect.db");
    const d = new Database(file);
    d.pragma("journal_mode = WAL");
    d.exec(
      "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    );
    d.exec(
      'CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT "", status TEXT NOT NULL DEFAULT "todo", jira_key TEXT NOT NULL DEFAULT "", branch TEXT NOT NULL DEFAULT "", active INTEGER NOT NULL DEFAULT 0, project TEXT NOT NULL DEFAULT "", created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
    );
    db = d;
  } catch (e) {
    console.error("[db] better-sqlite3 niedostępny — fallback do electron-store:", e.message);
    db = null;
  }
  return db;
}
function store$1() {
  if (!fallback) {
    const Store2 = require("electron-store");
    fallback = new Store2({ name: "app-state" });
  }
  return fallback;
}
function kvGet(key) {
  const d = open();
  if (d) {
    try {
      const row = d.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
      return row ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  }
  const v = store$1().get(key);
  return v === void 0 || v === null ? null : v;
}
function kvSet(key, value) {
  const d = open();
  if (d) {
    try {
      d.prepare(
        "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run(key, JSON.stringify(value), Date.now());
    } catch (e) {
      console.error("[db] zapis nieudany:", e.message);
    }
    return;
  }
  store$1().set(key, value);
}
function rowToTask(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status || "todo",
    jiraKey: r.jira_key || void 0,
    branch: r.branch || void 0,
    active: !!r.active,
    project: r.project,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function fallbackTasks() {
  return kvGet("tasks:all") ?? [];
}
function setFallbackTasks(list) {
  kvSet("tasks:all", list);
}
function tasksList(project) {
  const d = open();
  if (d) {
    const rows = project ? d.prepare("SELECT * FROM tasks WHERE project = ? ORDER BY id DESC").all(project) : d.prepare("SELECT * FROM tasks ORDER BY id DESC").all();
    return rows.map(rowToTask);
  }
  const all = fallbackTasks();
  return all.filter((t) => !project || t.project === project).sort((a, b) => b.id - a.id);
}
function tasksSave(t) {
  const now = Date.now();
  const d = open();
  if (d) {
    if (t.id) {
      d.prepare(
        "UPDATE tasks SET title = ?, description = ?, status = ?, jira_key = ?, branch = ?, project = ?, updated_at = ? WHERE id = ?"
      ).run(t.title, t.description ?? "", t.status ?? "todo", t.jiraKey ?? "", t.branch ?? "", t.project, now, t.id);
      const row2 = d.prepare("SELECT * FROM tasks WHERE id = ?").get(t.id);
      return rowToTask(row2);
    }
    const res = d.prepare(
      "INSERT INTO tasks (title, description, status, jira_key, branch, active, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)"
    ).run(t.title, t.description ?? "", t.status ?? "todo", t.jiraKey ?? "", t.branch ?? "", t.project, now, now);
    const row = d.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(res.lastInsertRowid));
    return rowToTask(row);
  }
  const all = fallbackTasks();
  if (t.id) {
    const idx = all.findIndex((x) => x.id === t.id);
    if (idx >= 0) {
      const merged = {
        ...all[idx],
        title: t.title,
        description: t.description ?? "",
        status: t.status ?? all[idx].status,
        jiraKey: t.jiraKey,
        branch: t.branch,
        project: t.project,
        updatedAt: now
      };
      all[idx] = merged;
      setFallbackTasks(all);
      return merged;
    }
  }
  const nextId = all.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const created = {
    id: nextId,
    title: t.title,
    description: t.description ?? "",
    status: t.status ?? "todo",
    jiraKey: t.jiraKey,
    branch: t.branch,
    active: false,
    project: t.project,
    createdAt: now,
    updatedAt: now
  };
  all.push(created);
  setFallbackTasks(all);
  return created;
}
function tasksDelete(id) {
  const d = open();
  if (d) {
    const res = d.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return res.changes > 0;
  }
  const all = fallbackTasks();
  const next = all.filter((t) => t.id !== id);
  setFallbackTasks(next);
  return next.length !== all.length;
}
function tasksSetActive(id) {
  const now = Date.now();
  const d = open();
  if (d) {
    const tx = d.transaction(() => {
      d.prepare("UPDATE tasks SET active = 0, updated_at = ? WHERE active = 1").run(now);
      d.prepare("UPDATE tasks SET active = 1, updated_at = ? WHERE id = ?").run(now, id);
    });
    tx();
    const row = d.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return rowToTask(row);
  }
  const all = fallbackTasks();
  let found = null;
  for (const t of all) {
    const active = t.id === id;
    if (t.active !== active) {
      t.active = active;
      t.updatedAt = now;
    }
    if (active) {
      found = t;
    }
  }
  setFallbackTasks(all);
  return found ?? tasksList("")[0];
}
function jiraGetConfig() {
  return kvGet("jira:config");
}
function jiraSetConfig(cfg) {
  kvSet("jira:config", cfg);
}
function todayKey() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function freshStats() {
  return { keystrokes: 0, lines: 0, tasks: 0, day: todayKey() };
}
function statsGet() {
  const cur = kvGet("stats:daily");
  const today = todayKey();
  if (!cur || cur.day !== today) {
    const next = freshStats();
    kvSet("stats:daily", next);
    return next;
  }
  return cur;
}
function statsBump(field, by = 1) {
  const cur = statsGet();
  const next = { ...cur, [field]: cur[field] + by };
  kvSet("stats:daily", next);
  return next;
}
electron.app.setName("Blink");
electron.app.commandLine.appendSwitch("class", "Blink");
function resolveClaude() {
  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return "claude";
}
function spawnClaudeTerminal(claudeArgs) {
  const bin = resolveClaude();
  const cmd = [bin, ...claudeArgs];
  const term = process.env.TERMINAL || "";
  const candidates = [
    ...term ? [[term, ["-e", ...cmd]]] : [],
    ["kitty", cmd],
    ["alacritty", ["-e", ...cmd]],
    ["gnome-terminal", ["--", ...cmd]],
    ["konsole", ["-e", ...cmd]],
    ["xfce4-terminal", ["-x", ...cmd]],
    ["x-terminal-emulator", ["-e", ...cmd]],
    ["xterm", ["-e", ...cmd]]
  ];
  return new Promise((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        resolve(false);
        return;
      }
      const [t, args] = candidates[i++];
      try {
        const child = child_process.spawn(t, args, { detached: true, stdio: "ignore" });
        child.on("error", () => tryNext());
        child.unref();
        setTimeout(() => resolve(true), 300);
      } catch {
        tryNext();
      }
    };
    tryNext();
  });
}
const store = new Store();
const GATEWAY_ADDR = process.env.GATEWAY_ADDR || "127.0.0.1:50061";
const protoRoot = () => process.env.PROTO_ROOT || path.join(electron.app.getAppPath(), "..", "..", "proto");
function loadClient(rel, pkgPath, addr) {
  const def = protoLoader__namespace.loadSync(path.join(protoRoot(), rel), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  let svc = grpc__namespace.loadPackageDefinition(def);
  for (const seg of pkgPath) {
    svc = svc[seg];
  }
  return new svc(addr, grpc__namespace.credentials.createInsecure());
}
function stripFence(text) {
  const m = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : text;
}
function call(method, payload) {
  return new Promise((resolve, reject) => {
    client[method](payload, (err, resp) => err ? reject(err) : resolve(resp));
  });
}
async function listGitFiles(dir) {
  const out = [];
  const walk = async (d) => {
    const entries = await promises.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
  };
  await walk(dir);
  return out;
}
function writeChunk(callStream, obj) {
  return new Promise((resolve) => {
    if (callStream.write(obj)) {
      resolve();
    } else {
      callStream.once("drain", resolve);
    }
  });
}
async function streamGitFile(callStream, abs, rel, repoPath) {
  const fh = await promises.open(abs, "r");
  try {
    const size = (await fh.stat()).size;
    if (size === 0) {
      await writeChunk(callStream, { repoPath, relPath: rel, data: Buffer.alloc(0), eof: true });
      return;
    }
    const CHUNK = 512 * 1024;
    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = 0;
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
      pos += bytesRead;
      const data = Buffer.from(buf.subarray(0, bytesRead));
      await writeChunk(callStream, { repoPath, relPath: rel, data, eof: pos >= size });
    }
  } finally {
    await fh.close();
  }
}
async function uploadGit(repoPath) {
  const gitDir = path.join(repoPath, ".git");
  if (!fs.existsSync(gitDir)) {
    return { ok: false, files: 0, headBranch: "" };
  }
  const files = await listGitFiles(gitDir);
  return new Promise((resolve, reject) => {
    const callStream = client.UploadRepo((err, resp) => err ? reject(err) : resolve(resp));
    (async () => {
      try {
        for (const abs of files) {
          const rel = path.relative(gitDir, abs).split(path.sep).join("/");
          await streamGitFile(callStream, abs, rel, repoPath);
        }
        callStream.end();
      } catch (e) {
        try {
          callStream.cancel();
        } catch {
        }
        reject(e);
      }
    })();
  });
}
let client;
function onScreen(b) {
  return electron.screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
}
function createWindow() {
  const { width: sw, height: sh } = electron.screen.getPrimaryDisplay().workAreaSize;
  const saved = kvGet("window:main");
  const place = saved && saved.x != null && saved.y != null && onScreen({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }) ? { x: saved.x, y: saved.y } : { center: true };
  const win = new electron.BrowserWindow({
    width: saved?.width ?? Math.min(1480, Math.round(sw * 0.72)),
    height: saved?.height ?? Math.round(sh * 0.88),
    ...place,
    backgroundColor: "#0d1117",
    show: false,
    autoHideMenuBar: true,
    title: `Blink ${electron.app.getVersion()}`,
    icon: path.join(electron.app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      // Enable <webview> for the in-app web browser view (view 7). The renderer still
      // gates whether webviews are created via browserSetEnabled.
      webviewTag: true
    }
  });
  if (saved?.maximized) {
    win.maximize();
  }
  let saveTimer;
  const persistWindow = () => {
    const b = win.getNormalBounds();
    kvSet("window:main", { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() });
  };
  const persistSoon = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(persistWindow, 400);
  };
  win.on("resize", persistSoon);
  win.on("move", persistSoon);
  win.on("maximize", persistSoon);
  win.on("unmaximize", persistSoon);
  win.on("close", persistWindow);
  win.on("ready-to-show", () => win.show());
  const windowTitle = `Blink ${electron.app.getVersion()}`;
  win.webContents.on("page-title-updated", (e) => {
    e.preventDefault();
    win.setTitle(windowTitle);
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[renderer] did-fail-load", code, desc, url);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] render-process-gone", details.reason, details.exitCode);
  });
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.error(`[renderer-console] ${message} (${sourceId}:${line})`);
  });
  return win;
}
let ptyModule;
function loadPty() {
  if (ptyModule !== void 0) {
    return ptyModule;
  }
  try {
    ptyModule = require("node-pty");
  } catch (e) {
    console.error("[pty] node-pty unavailable:", e.message);
    ptyModule = null;
  }
  return ptyModule ?? null;
}
const ptys = /* @__PURE__ */ new Map();
function defaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}
function normalizeUrl(raw) {
  const s = raw.trim();
  if (!s) {
    return "";
  }
  if (/^https?:\/\//i.test(s)) {
    return s;
  }
  if (/^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(s) || s === "localhost" || s.startsWith("localhost:")) {
    return "https://" + s;
  }
  return "https://duckduckgo.com/?q=" + encodeURIComponent(s);
}
function browserHistoryKey(id) {
  return "browser:history:" + id;
}
function pushBrowserHistory(id, url) {
  const list = kvGet(browserHistoryKey(id)) ?? [];
  list.push({ url, title: "", ts: Date.now() });
  kvSet(browserHistoryKey(id), list.slice(-200));
}
const TELESCOPE_SKIP = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "out", ".next", "build", ".cache", "vendor", "target"]);
function hasRipgrep() {
  return new Promise((resolve) => {
    child_process.execFile("rg", ["--version"], { timeout: 3e3 }, (err) => resolve(!err));
  });
}
async function walkFiles(root, cap) {
  const out = [];
  const walk = async (dir) => {
    if (out.length >= cap) {
      return;
    }
    let entries;
    try {
      entries = await promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) {
        return;
      }
      if (e.name.startsWith(".") && e.name !== ".env") ;
      if (e.isDirectory()) {
        if (!TELESCOPE_SKIP.has(e.name) && !e.name.startsWith(".")) {
          await walk(path.join(dir, e.name));
        }
      } else if (e.isFile()) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  await walk(root);
  return out;
}
function telescopeRgContent(query, root, limit) {
  return new Promise((resolve) => {
    const args = [
      "--vimgrep",
      "--no-heading",
      "--smart-case",
      "--max-count",
      "5",
      "-g",
      "!node_modules",
      "-g",
      "!.git",
      "-g",
      "!dist",
      "-g",
      "!out",
      query,
      root
    ];
    child_process.execFile("rg", args, { timeout: 8e3, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
      const hits = [];
      const lines = (stdout || "").split("\n");
      for (const raw of lines) {
        if (hits.length >= limit) {
          break;
        }
        const m = raw.match(/^(.*?):(\d+):(\d+):(.*)$/);
        if (!m) {
          continue;
        }
        const absPath = m[1];
        hits.push({
          path: path.relative(root, absPath),
          absPath,
          line: Number(m[2]),
          preview: m[4].slice(0, 200),
          kind: "content"
        });
      }
      resolve(hits);
    });
  });
}
async function telescopeWalkContent(query, files, limit) {
  const hits = [];
  const needle = query.toLowerCase();
  for (const abs of files) {
    if (hits.length >= limit) {
      break;
    }
    try {
      const st = await promises.stat(abs);
      if (st.size > 1024 * 1024) {
        continue;
      }
      const text = await promises.readFile(abs, "utf8");
      if (text.includes("\0")) {
        continue;
      }
      const fileLines = text.split("\n");
      for (let i = 0; i < fileLines.length; i++) {
        if (hits.length >= limit) {
          break;
        }
        if (fileLines[i].toLowerCase().includes(needle)) {
          hits.push({
            path: abs,
            absPath: abs,
            line: i + 1,
            preview: fileLines[i].trim().slice(0, 200),
            kind: "content"
          });
        }
      }
    } catch {
    }
  }
  return hits;
}
async function telescopeFind(query, opts) {
  const root = opts?.root || "";
  const limit = opts?.limit ?? 50;
  if (!root || !query.trim()) {
    return [];
  }
  const files = await walkFiles(root, 5e3);
  const needle = query.toLowerCase();
  const nameHits = [];
  for (const abs of files) {
    if (nameHits.length >= limit) {
      break;
    }
    const rel = path.relative(root, abs);
    if (rel.toLowerCase().includes(needle)) {
      nameHits.push({ path: rel, absPath: abs, kind: "name" });
    }
  }
  if (opts?.content === false) {
    return nameHits.slice(0, limit);
  }
  let contentHits = [];
  if (await hasRipgrep()) {
    contentHits = (await telescopeRgContent(query, root, limit)).map((h) => ({
      ...h,
      path: path.relative(root, h.absPath)
    }));
  } else {
    const walked = await telescopeWalkContent(query, files, limit);
    contentHits = walked.map((h) => ({ ...h, path: path.relative(root, h.absPath) }));
  }
  return [...nameHits, ...contentHits].slice(0, limit * 2);
}
function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    child_process.execFile("git", ["-C", repoPath, ...args], { timeout: 15e3 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
async function gitCurrentBranch(repoPath) {
  const branch = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await runGit(repoPath, ["status", "--porcelain"]);
  return { branch, dirty: status.length > 0 };
}
async function gitCreateBranch(repoPath, name, base) {
  const existing = await runGit(repoPath, ["branch", "--list", name]).catch(() => "");
  if (existing.trim()) {
    await runGit(repoPath, ["checkout", name]);
    return { branch: name, created: false };
  }
  const args = base ? ["checkout", "-b", name, base] : ["checkout", "-b", name];
  await runGit(repoPath, args);
  return { branch: name, created: true };
}
async function gitCheckoutBranch(repoPath, name) {
  await runGit(repoPath, ["checkout", name]);
  return { branch: name };
}
async function jiraImport() {
  const cfg = jiraGetConfig();
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.token) {
    return [];
  }
  const base = cfg.baseUrl.replace(/\/$/, "");
  const jql = encodeURIComponent(`project = ${cfg.project} ORDER BY updated DESC`);
  const url = `${base}/rest/api/2/search?jql=${jql}&maxResults=50&fields=summary,description,status`;
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }
  });
  if (!res.ok) {
    throw new Error(`Jira HTTP ${res.status}`);
  }
  const body = await res.json();
  const issues = body.issues ?? [];
  const existing = tasksList(cfg.project);
  const byKey = new Map(existing.filter((t) => t.jiraKey).map((t) => [t.jiraKey, t]));
  for (const issue of issues) {
    const fields = issue.fields ?? {};
    const statusName = (fields.status?.name || "").toLowerCase();
    const status = statusName.includes("done") || statusName.includes("closed") ? "done" : statusName.includes("progress") ? "doing" : "todo";
    const prev = byKey.get(issue.key);
    tasksSave({
      id: prev?.id,
      title: fields.summary || issue.key,
      description: typeof fields.description === "string" ? fields.description : "",
      status,
      jiraKey: issue.key,
      branch: prev?.branch,
      project: cfg.project
    });
  }
  return tasksList(cfg.project);
}
function registerIpc(win) {
  electron.ipcMain.handle("app:lastFolder", () => store.get("lastFolder", ""));
  electron.ipcMain.handle("app:setLastFolder", (_e, folder) => {
    if (folder) {
      store.set("lastFolder", folder);
    }
    return true;
  });
  electron.ipcMain.handle("dialog:pickFolder", async () => {
    const res = await electron.dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (res.canceled || res.filePaths.length === 0) {
      return "";
    }
    const folder = res.filePaths[0];
    store.set("lastFolder", folder);
    return folder;
  });
  electron.ipcMain.handle(
    "graph:get",
    (_e, projectId) => new Promise((resolve, reject) => {
      client.GetGraph(
        { projectId: projectId || 0 },
        (err, resp) => err ? reject(err) : resolve(resp)
      );
    })
  );
  electron.ipcMain.handle(
    "graph:getApp",
    (_e, appId) => new Promise((resolve, reject) => {
      client.GetAppGraph({ appId }, (err, resp) => err ? reject(err) : resolve(resp));
    })
  );
  electron.ipcMain.handle(
    "projects:list",
    () => new Promise((resolve, reject) => {
      client.ListProjects({}, (err, resp) => err ? reject(err) : resolve(resp));
    })
  );
  electron.ipcMain.handle("viewport:get", async (_e, key) => {
    const data = (await call("GetGraphState", { key })).data ?? "";
    try {
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle(
    "viewport:set",
    (_e, p) => call("SaveGraphState", { key: p.key, data: JSON.stringify(p.vp) }).then(() => true)
  );
  electron.ipcMain.handle("settings:get", () => store.get("settings", { provider: "ollama" }));
  electron.ipcMain.handle("settings:set", (_e, s) => {
    const cur = store.get("settings", {}) ?? {};
    store.set("settings", { ...cur, ...s });
    return true;
  });
  electron.ipcMain.handle("oauth:claude", async () => {
    await electron.shell.openExternal("https://claude.ai/login");
    return true;
  });
  electron.ipcMain.handle(
    "claude:status",
    () => new Promise((resolve) => {
      child_process.execFile(resolveClaude(), ["auth", "status"], { timeout: 1e4 }, (err, stdout) => {
        try {
          const j = JSON.parse(stdout);
          resolve({ loggedIn: !!j.loggedIn, email: j.email ?? "", method: j.authMethod ?? "", installed: true });
        } catch {
          const installed = !(err && err.code === "ENOENT");
          resolve({ loggedIn: false, email: "", method: "", installed });
        }
      });
    })
  );
  electron.ipcMain.handle("claude:login", () => spawnClaudeTerminal(["auth", "login"]));
  electron.ipcMain.handle("claude:setupToken", () => spawnClaudeTerminal(["setup-token"]));
  electron.ipcMain.handle(
    "claude:saveToken",
    async (_e, token) => (await call("AiSetClaudeToken", { token })).hasToken ?? false
  );
  electron.ipcMain.handle("claude:tokenStatus", async () => (await call("AiClaudeStatus", {})).hasToken ?? false);
  electron.ipcMain.handle("file:read", async (_e, absPath) => (await call("ReadFile", { path: absPath })).content ?? "");
  electron.ipcMain.handle("file:save", (_e, p) => call("SaveFile", p).then(() => true));
  electron.ipcMain.handle(
    "file:create",
    async (_e, p) => (await call("CreateFile", p)).path ?? ""
  );
  electron.ipcMain.handle(
    "file:mkdir",
    async (_e, p) => (await call("CreateFolder", p)).path ?? ""
  );
  electron.ipcMain.handle(
    "file:move",
    async (_e, p) => (await call("MoveFile", p)).path ?? ""
  );
  electron.ipcMain.handle(
    "file:rename",
    async (_e, p) => (await call("RenameFile", p)).path ?? ""
  );
  electron.ipcMain.handle(
    "file:resolve",
    async (_e, p) => (await call("ResolveImport", p)).path ?? ""
  );
  electron.ipcMain.handle(
    "def:links",
    async (_e, p) => (await call("Links", p)).links ?? []
  );
  electron.ipcMain.handle("file:delete", async (_e, path2) => (await call("DeletePath", { path: path2 })).ok ?? false);
  electron.ipcMain.handle("fs:home", async () => (await call("HomeDir", {})).path ?? "");
  electron.ipcMain.handle("fs:list", (_e, path2) => call("ListDir", { path: path2 }));
  electron.ipcMain.handle("fs:find", (_e, path2) => call("FindProjects", { path: path2 }));
  electron.ipcMain.handle("fs:conventions", (_e, path2) => call("DetectConventions", { path: path2 }));
  electron.ipcMain.handle("editors:get", (_e, folder) => kvGet("editors:" + folder));
  electron.ipcMain.handle("editors:set", (_e, p) => {
    kvSet("editors:" + p.folder, p.data);
    return true;
  });
  electron.ipcMain.handle("state:get", (_e, key) => kvGet(key));
  electron.ipcMain.handle("state:set", (_e, p) => {
    kvSet(p.key, p.value);
    return true;
  });
  electron.ipcMain.handle("git:upload", (_e, repoPath) => uploadGit(repoPath));
  electron.ipcMain.handle("git:fileInfo", (_e, p) => call("GitFileInfo", p));
  electron.ipcMain.handle(
    "git:review",
    (_e, p) => call("GitReviewStatus", { repoPath: p.repoPath, base: p.base ?? "" })
  );
  electron.ipcMain.handle(
    "git:fileDiff",
    (_e, p) => call("GitFileDiff", { repoPath: p.repoPath, file: p.file, base: p.base ?? "" })
  );
  electron.ipcMain.handle("ai:agent", (_e, p) => call("AiAgent", p));
  electron.ipcMain.handle("ai:provider", async (_e, provider) => (await call("AiSetProvider", { provider })).name ?? "");
  electron.ipcMain.handle(
    "ai:edit",
    (_e, payload) => new Promise((resolve, reject) => {
      client.AiEdit(
        { code: payload.code, prompt: payload.prompt, file: payload.file },
        (err, resp) => err ? reject(err) : resolve(stripFence(resp?.code ?? ""))
      );
    })
  );
  electron.ipcMain.handle(
    "ai:complete",
    async (_e, p) => (await call("AiComplete", p)).text ?? ""
  );
  electron.ipcMain.handle(
    "ai:model",
    () => new Promise((resolve, reject) => {
      client.AiModel({}, (err, resp) => err ? reject(err) : resolve(resp?.name ?? ""));
    })
  );
  electron.ipcMain.handle(
    "ai:review",
    (_e, payload) => new Promise((resolve, reject) => {
      client.AiReview(
        { code: payload.code, file: payload.file, lang: payload.lang },
        (err, resp) => err ? reject(err) : resolve(resp?.remarks ?? [])
      );
    })
  );
  electron.ipcMain.handle("lint:file", async (_e, payload) => {
    const runLint = async (eslint) => {
      const results = await eslint.lintText(payload.code, { filePath: payload.file });
      const messages = results[0]?.messages ?? [];
      return messages.map((m) => ({
        line: m.line || 1,
        text: m.message + (m.ruleId ? ` [${m.ruleId}]` : ""),
        severity: m.severity
      }));
    };
    try {
      const eslintMod = await import("eslint");
      const ESLint = eslintMod.ESLint ?? eslintMod.default?.ESLint;
      const dir = path.dirname(payload.file);
      try {
        return await runLint(new ESLint({ cwd: dir, errorOnUnmatchedPattern: false }));
      } catch {
        const tseslintMod = await import("typescript-eslint");
        const tseslint = tseslintMod.default ?? tseslintMod;
        return await runLint(
          new ESLint({
            cwd: dir,
            overrideConfigFile: true,
            overrideConfig: tseslint.config(...tseslint.configs.recommended)
          })
        );
      }
    } catch {
      return [];
    }
  });
  electron.ipcMain.handle(
    "event:publish",
    (_e, ev) => new Promise((resolve, reject) => {
      client.PublishEvent(ev, (err, resp) => err ? reject(err) : resolve(resp));
    })
  );
  electron.ipcMain.handle(
    "scripts:list",
    async (_e, project) => (await call("ListScripts", { project: project ?? "" })).scripts ?? []
  );
  electron.ipcMain.handle("scripts:get", (_e, id) => call("GetScript", { id }));
  electron.ipcMain.handle(
    "scripts:save",
    (_e, s) => call("SaveScript", { id: s.id ?? 0, name: s.name, content: s.content, project: s.project ?? "" })
  );
  electron.ipcMain.handle("scripts:delete", async (_e, id) => (await call("DeleteScript", { id })).ok ?? false);
  electron.ipcMain.handle(
    "logs:append",
    (_e, entries) => call("AppendLogs", { entries }).then(() => true)
  );
  electron.ipcMain.handle("logs:list", async (_e, limit) => (await call("ListLogs", { limit: limit ?? 0 })).entries ?? []);
  electron.ipcMain.handle("logs:clear", () => call("ClearLogs", {}).then(() => true));
  electron.ipcMain.on("scan:start", (e, path2) => {
    const call2 = client.Scan({ path: path2 });
    call2.on("data", (p) => e.sender.send("scan:progress", p));
    call2.on("end", () => e.sender.send("scan:end"));
    call2.on("error", (err) => e.sender.send("scan:error", String(err)));
  });
  electron.ipcMain.on("app:scan:start", (e, appId) => {
    const call2 = client.ScanApp({ appId });
    call2.on("data", (p) => e.sender.send("scan:progress", p));
    call2.on("end", () => e.sender.send("scan:end"));
    call2.on("error", (err) => e.sender.send("scan:error", String(err)));
  });
  let watchCall = null;
  const stopWatch = () => {
    if (watchCall) {
      try {
        watchCall.cancel();
      } catch {
      }
      watchCall = null;
    }
  };
  electron.ipcMain.on("fs:watch:start", (e, path2) => {
    stopWatch();
    if (!path2) {
      return;
    }
    const call2 = client.WatchFiles({ path: path2 });
    watchCall = call2;
    call2.on("data", (ev) => e.sender.send("fs:change", ev));
    call2.on("end", () => void 0);
    call2.on("error", () => void 0);
  });
  electron.ipcMain.on("fs:watch:stop", () => stopWatch());
  let askStream = null;
  const cancelAsk = () => {
    if (askStream) {
      try {
        askStream.cancel();
      } catch {
      }
      askStream = null;
    }
  };
  electron.ipcMain.on("ai:ask:start", (e, payload) => {
    cancelAsk();
    const stream = client.AiAsk();
    askStream = stream;
    stream.on("data", (ev) => {
      const kind = ev.event;
      if (kind === "plan") {
        e.sender.send("ai:event", { type: "plan", plan: ev.plan });
      } else if (kind === "tool") {
        e.sender.send("ai:event", { type: "tool", tool: ev.tool });
      } else if (kind === "answer") {
        e.sender.send("ai:event", { type: "answer", answer: ev.answer });
      } else if (kind === "skillRequest") {
        e.sender.send("ai:skill", ev.skillRequest);
      }
    });
    stream.on("end", () => {
      e.sender.send("ai:event", { type: "done" });
      if (askStream === stream) {
        askStream = null;
      }
    });
    stream.on("error", (err) => {
      e.sender.send("ai:event", { type: "error", message: String(err?.message || err) });
      if (askStream === stream) {
        askStream = null;
      }
    });
    stream.write({ start: payload });
  });
  electron.ipcMain.on("ai:skill:result", (_e, res) => {
    if (askStream) {
      try {
        askStream.write({ skillResult: res });
      } catch {
      }
    }
  });
  electron.ipcMain.on("ai:ask:cancel", () => cancelAsk());
  electron.ipcMain.on("term:start", (e, opts) => {
    const mod = loadPty();
    if (!mod) {
      e.sender.send("term:exit", { id: opts.id, code: -1 });
      return;
    }
    const prev = ptys.get(opts.id);
    if (prev) {
      try {
        prev.kill();
      } catch {
      }
      ptys.delete(opts.id);
    }
    try {
      const proc = mod.spawn(opts.shell || defaultShell(), [], {
        name: "xterm-color",
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: opts.cwd || os.homedir(),
        env: process.env
      });
      ptys.set(opts.id, proc);
      proc.onData((data) => {
        if (!e.sender.isDestroyed()) {
          e.sender.send("term:data", { id: opts.id, data });
        }
      });
      proc.onExit(({ exitCode }) => {
        ptys.delete(opts.id);
        if (!e.sender.isDestroyed()) {
          e.sender.send("term:exit", { id: opts.id, code: exitCode });
        }
      });
    } catch (err) {
      console.error("[pty] spawn failed:", err.message);
      e.sender.send("term:exit", { id: opts.id, code: -1 });
    }
  });
  electron.ipcMain.on("term:write", (_e, p) => {
    const proc = ptys.get(p.id);
    if (proc) {
      try {
        proc.write(p.data);
      } catch {
      }
    }
  });
  electron.ipcMain.on("term:resize", (_e, p) => {
    const proc = ptys.get(p.id);
    if (proc) {
      try {
        proc.resize(p.cols, p.rows);
      } catch {
      }
    }
  });
  electron.ipcMain.on("term:kill", (_e, id) => {
    const proc = ptys.get(id);
    if (proc) {
      try {
        proc.kill();
      } catch {
      }
      ptys.delete(id);
    }
  });
  electron.ipcMain.handle("browser:setEnabled", (_e, enabled) => {
    kvSet("browser:enabled", !!enabled);
    return !!enabled;
  });
  electron.ipcMain.handle("browser:navigate", (_e, p) => {
    const url = normalizeUrl(p.url);
    if (url) {
      pushBrowserHistory(p.id, url);
    }
    return { url };
  });
  electron.ipcMain.handle("browser:history", (_e, id) => kvGet(browserHistoryKey(id)) ?? []);
  electron.ipcMain.handle("tasks:list", (_e, project) => tasksList(project ?? ""));
  electron.ipcMain.handle("tasks:save", (_e, t) => tasksSave(t));
  electron.ipcMain.handle("tasks:delete", (_e, id) => tasksDelete(id));
  electron.ipcMain.handle("tasks:setActive", (_e, id) => tasksSetActive(id));
  electron.ipcMain.handle("jira:getConfig", () => jiraGetConfig());
  electron.ipcMain.handle("jira:setConfig", (_e, cfg) => {
    jiraSetConfig(cfg);
    return true;
  });
  electron.ipcMain.handle("jira:import", () => jiraImport());
  electron.ipcMain.handle(
    "telescope:find",
    (_e, p) => telescopeFind(p.query, p.opts)
  );
  electron.ipcMain.handle("stats:get", () => statsGet());
  electron.ipcMain.handle(
    "stats:bump",
    (_e, p) => statsBump(p.field, p.by)
  );
  electron.ipcMain.handle("git:currentBranch", (_e, repoPath) => gitCurrentBranch(repoPath));
  electron.ipcMain.handle(
    "git:createBranch",
    (_e, p) => gitCreateBranch(p.repoPath, p.name, p.base)
  );
  electron.ipcMain.handle(
    "git:checkoutBranch",
    (_e, p) => gitCheckoutBranch(p.repoPath, p.name)
  );
  win.on("closed", () => {
    for (const proc of ptys.values()) {
      try {
        proc.kill();
      } catch {
      }
    }
    ptys.clear();
  });
}
electron.app.whenReady().then(() => {
  electron.Menu.setApplicationMenu(null);
  client = loadClient("gateway/v1/gateway.proto", ["gateway", "v1", "Gateway"], GATEWAY_ADDR);
  const win = createWindow();
  registerIpc(win);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
