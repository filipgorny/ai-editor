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
      sandbox: false
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
function registerIpc(win) {
  electron.ipcMain.handle("app:lastFolder", () => store.get("lastFolder", ""));
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
