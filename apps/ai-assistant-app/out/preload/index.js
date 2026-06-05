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
  createFile: (dir, file, name) => electron.ipcRenderer.invoke("file:create", { dir, file, name }),
  createFolder: (dir, name) => electron.ipcRenderer.invoke("file:mkdir", { dir, name }),
  moveFile: (oldPath, targetDir) => electron.ipcRenderer.invoke("file:move", { oldPath, targetDir }),
  deleteFile: (path) => electron.ipcRenderer.invoke("file:delete", path),
  aiAgent: (prompt, dir, lang) => electron.ipcRenderer.invoke("ai:agent", { prompt, dir, lang }),
  fsHome: () => electron.ipcRenderer.invoke("fs:home"),
  fsList: (path) => electron.ipcRenderer.invoke("fs:list", path),
  fsFind: (path) => electron.ipcRenderer.invoke("fs:find", path),
  fsConventions: (path) => electron.ipcRenderer.invoke("fs:conventions", path),
  saveViewport: (key, vp) => electron.ipcRenderer.invoke("viewport:set", { key, vp }),
  getViewport: (key) => electron.ipcRenderer.invoke("viewport:get", key),
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  setSettings: (s) => electron.ipcRenderer.invoke("settings:set", s),
  aiSetProvider: (provider) => electron.ipcRenderer.invoke("ai:provider", provider),
  renameFile: (oldPath, fileBase, className, oldName) => electron.ipcRenderer.invoke("file:rename", { oldPath, fileBase, className, oldName }),
  saveFile: (path, content) => electron.ipcRenderer.invoke("file:save", { path, content }),
  aiEdit: (code, prompt, file) => electron.ipcRenderer.invoke("ai:edit", { code, prompt, file }),
  aiModel: () => electron.ipcRenderer.invoke("ai:model"),
  aiComplete: (prefix, suffix, file) => electron.ipcRenderer.invoke("ai:complete", { prefix, suffix, file }),
  aiReview: (code, file, lang) => electron.ipcRenderer.invoke("ai:review", { code, file, lang }),
  lintFile: (code, file) => electron.ipcRenderer.invoke("lint:file", { code, file }),
  publishEvent: (ev) => electron.ipcRenderer.invoke("event:publish", ev),
  // --- User scripts (via gateway → scripting service; Postgres) ---
  // project is optional ('' = global). listScripts(project) → global + pinned.
  listScripts: (project) => electron.ipcRenderer.invoke("scripts:list", project ?? ""),
  getScript: (id) => electron.ipcRenderer.invoke("scripts:get", id),
  saveScript: (s) => electron.ipcRenderer.invoke("scripts:save", s),
  deleteScript: (id) => electron.ipcRenderer.invoke("scripts:delete", id),
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
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
