"use strict";
const path = require("path");
const promises = require("fs/promises");
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
let client;
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1320,
    height: 880,
    backgroundColor: "#0d1117",
    show: false,
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
  electron.ipcMain.handle("file:read", (_e, absPath) => promises.readFile(absPath, "utf8"));
  electron.ipcMain.handle("file:save", async (_e, payload) => {
    await promises.writeFile(payload.path, payload.content, "utf8");
    return true;
  });
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
    "event:publish",
    (_e, ev) => new Promise((resolve, reject) => {
      client.PublishEvent(ev, (err, resp) => err ? reject(err) : resolve(resp));
    })
  );
  electron.ipcMain.on("scan:start", (e, path2) => {
    const call = client.Scan({ path: path2 });
    call.on("data", (p) => e.sender.send("scan:progress", p));
    call.on("end", () => e.sender.send("scan:end"));
    call.on("error", (err) => e.sender.send("scan:error", String(err)));
  });
  electron.ipcMain.on("app:scan:start", (e, appId) => {
    const call = client.ScanApp({ appId });
    call.on("data", (p) => e.sender.send("scan:progress", p));
    call.on("end", () => e.sender.send("scan:end"));
    call.on("error", (err) => e.sender.send("scan:error", String(err)));
  });
}
electron.app.whenReady().then(() => {
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
