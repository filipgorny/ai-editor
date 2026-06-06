import { d as distExports } from "./__vite-browser-external-Cvo1cMax.js";
import glueWasmUrl from "./glue-QrOtmhPl.js";
import { c as clearBoundCombos, a as commander, b as appBus, n as normCombo, d as bindCombo } from "./index-DP3jkcw8.js";
let enginePromise = null;
const unsubscribers = [];
let factory = null;
function getFactory() {
  if (!factory) {
    factory = new distExports.LuaFactory(glueWasmUrl);
  }
  return factory;
}
async function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const lua = await getFactory().createEngine();
      installBridge(lua);
      return lua;
    })();
  }
  return enginePromise;
}
let validatorPromise = null;
async function getValidator() {
  if (!validatorPromise) {
    validatorPromise = getFactory().createEngine();
  }
  return validatorPromise;
}
async function validateLua(code) {
  if (!code.trim()) {
    return null;
  }
  const lua = await getValidator();
  lua.global.set("__src", code);
  const err = await lua.doString('local f, e = load(__src, "=script"); if f then return nil end; return e');
  if (!err) {
    return null;
  }
  const m = String(err).match(/:(\d+):\s*([\s\S]*)$/);
  return { line: m ? parseInt(m[1], 10) : 1, message: (m ? m[2] : String(err)).trim() };
}
function installBridge(lua) {
  const g = lua.global;
  g.set("run", (input) => commander.run(input));
  g.set(
    "cmd",
    (name, arg) => commander.run(arg != null && arg !== "" ? `${name}:${arg}` : name)
  );
  g.set("on", (event, fn) => {
    const off = appBus.on(event, (payload) => fn(payload));
    unsubscribers.push(off);
    return off;
  });
  g.set("onAny", (fn) => {
    const off = appBus.onAny((name, payload) => fn(name, payload));
    unsubscribers.push(off);
    return off;
  });
  g.set("onKey", (spec, fn) => {
    const combo = normCombo(spec);
    bindCombo(combo);
    const off = appBus.on(`key:${combo}`, (payload) => fn(payload));
    unsubscribers.push(off);
    return off;
  });
  g.set(
    "emit",
    (name, payload) => appBus.emit(name, payload ?? {})
  );
  g.set("log", (...args) => {
    const msg = args.map((a) => a !== null && typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    console.info("[lua]", msg);
  });
  g.set("register", (name, fn, summary) => {
    commander.register({
      name,
      group: "Lua",
      params: "arg",
      summary: summary || `Komenda Lua: ${name}`,
      run: (arg) => {
        fn(arg);
      }
    });
  });
  g.set("api", {
    // files / project (gateway → filer / designer)
    readFile: (path) => window.api.readFile(path),
    saveFile: (path, content) => window.api.saveFile(path, content),
    createFile: (dir, file, name) => window.api.createFile(dir, file, name),
    createFolder: (dir, name) => window.api.createFolder(dir, name),
    moveFile: (oldPath, targetDir) => window.api.moveFile(oldPath, targetDir),
    renameFile: (oldPath, fileBase, className, oldName) => window.api.renameFile(oldPath, fileBase, className, oldName),
    deleteFile: (path) => window.api.deleteFile(path),
    resolveImport: (from, spec) => window.api.resolveImport(from, spec),
    listProjects: () => window.api.listProjects(),
    getGraph: (projectId) => window.api.getGraph(projectId || 0),
    getAppGraph: (appId) => window.api.getAppGraph(appId),
    startScan: (path) => window.api.startScan(path),
    startScanApp: (appId) => window.api.startScanApp(appId),
    // disk browse (gateway → filer)
    fsHome: () => window.api.fsHome(),
    fsList: (path) => window.api.fsList(path),
    fsFind: (path) => window.api.fsFind(path),
    fsConventions: (path) => window.api.fsConventions(path),
    // AI (gateway → ai)
    aiAgent: (prompt, dir, lang) => window.api.aiAgent(prompt, dir, lang || "pl"),
    aiEdit: (code, prompt, file) => window.api.aiEdit(code, prompt, file),
    aiComplete: (prefix, suffix, file) => window.api.aiComplete(prefix, suffix, file),
    aiReview: (code, file, lang) => window.api.aiReview(code, file, lang || "pl"),
    aiModel: () => window.api.aiModel(),
    aiSetProvider: (provider) => window.api.aiSetProvider(provider),
    lintFile: (code, file) => window.api.lintFile(code, file),
    // backend events (gateway → events / Redis)
    publishEvent: (ev) => window.api.publishEvent(ev),
    // stored scripts (gateway → scripting / Postgres)
    listScripts: (project) => window.api.listScripts(project),
    getScript: (id) => window.api.getScript(id),
    saveScript: (s) => window.api.saveScript(s),
    deleteScript: (id) => window.api.deleteScript(id)
  });
}
async function runLuaSource(src) {
  const lua = await getEngine();
  await lua.doString(src);
}
async function runLuaFile(absPath) {
  const src = await window.api.readFile(absPath);
  await runLuaSource(src);
}
async function disposeLua() {
  for (const off of unsubscribers.splice(0)) {
    try {
      off();
    } catch (e) {
      console.error("[lua] unsubscribe failed", e);
    }
  }
  clearBoundCombos();
  if (enginePromise) {
    const lua = await enginePromise;
    lua.global.close();
    enginePromise = null;
  }
}
export {
  disposeLua,
  runLuaFile,
  runLuaSource,
  validateLua
};
