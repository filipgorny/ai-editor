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
let client;
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1320,
    height: 880,
    backgroundColor: "#0d1117",
    show: false,
    autoHideMenuBar: true,
    title: "Avier",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  win.on("ready-to-show", () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
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
    store.set("settings", s);
    return true;
  });
  electron.ipcMain.handle("oauth:claude", async () => {
    await electron.shell.openExternal("https://claude.ai/login");
    return true;
  });
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
  electron.ipcMain.handle("file:delete", async (_e, path2) => (await call("DeletePath", { path: path2 })).ok ?? false);
  electron.ipcMain.handle("fs:home", async () => (await call("HomeDir", {})).path ?? "");
  electron.ipcMain.handle("fs:list", (_e, path2) => call("ListDir", { path: path2 }));
  electron.ipcMain.handle("fs:find", (_e, path2) => call("FindProjects", { path: path2 }));
  electron.ipcMain.handle("fs:conventions", (_e, path2) => call("DetectConventions", { path: path2 }));
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
        { code: payload.code, file: payload.file },
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
