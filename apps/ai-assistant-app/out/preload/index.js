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
  saveFile: (path, content) => electron.ipcRenderer.invoke("file:save", { path, content }),
  aiEdit: (code, prompt, file) => electron.ipcRenderer.invoke("ai:edit", { code, prompt, file }),
  publishEvent: (ev) => electron.ipcRenderer.invoke("event:publish", ev),
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
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
