// Lua runtime — embeds a Lua 5.4 interpreter (wasmoon, compiled to WASM) in the renderer
// and bridges it to the two script-facing globals: the Commander (window.commander) and the
// event bus (window.appBus). User .lua scripts get a small set of globals — cmd / run / on /
// onAny / emit / log / register — and can therefore drive the editor and react to app events
// in exactly the same way a JS script could. See SCRIPTING.md.
//
// Lazily imported (by the `lua*` commands) so the ~270 KB wasm stays out of the initial bundle
// until a script actually runs.

import { LuaFactory, type LuaEngine } from 'wasmoon'
// ?url → Vite emits glue.wasm as an asset and hands us its URL, instead of letting wasmoon
// guess a path it can't resolve under a bundler. (If this ever fails to load under file:// in
// a packaged build, switch to a base64 data URL — see SCRIPTING.md.)
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url'
import { commander } from '../commander/Commander'
import { appBus, normCombo, bindCombo, clearBoundCombos } from '../events'
import type { AppEventName } from '../events'

// One engine per session. Kept alive while Lua `on`/`onAny` listeners are registered — closing
// it would invalidate the Lua callbacks the bus still holds.
let enginePromise: Promise<LuaEngine> | null = null
// Every appBus subscription a script makes, so disposeLua() can detach them all.
const unsubscribers: Array<() => void> = []

// One factory shared by the run engine and the validator engine (so the wasm loads once).
let factory: LuaFactory | null = null

function getFactory(): LuaFactory {
  if (!factory) {
    factory = new LuaFactory(glueWasmUrl)
  }

  return factory
}

async function getEngine(): Promise<LuaEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const lua = await getFactory().createEngine()

      installBridge(lua)

      return lua
    })()
  }

  return enginePromise
}

// A separate engine used ONLY to compile (not run) scripts for validation, so it never touches
// the live script state.
let validatorPromise: Promise<LuaEngine> | null = null

async function getValidator(): Promise<LuaEngine> {
  if (!validatorPromise) {
    validatorPromise = getFactory().createEngine()
  }

  return validatorPromise
}

// validateLua compiles the source with Lua `load` (no execution). Returns the first syntax error
// (1-based line + message), or null when the code is valid.
export async function validateLua(code: string): Promise<{ line: number; message: string } | null> {
  if (!code.trim()) {
    return null
  }

  const lua = await getValidator()

  lua.global.set('__src', code)
  const err = await lua.doString('local f, e = load(__src, "=script"); if f then return nil end; return e')

  if (!err) {
    return null
  }

  // Lua errors look like:  script:3: '=' expected near 'foo'
  const m = String(err).match(/:(\d+):\s*([\s\S]*)$/)

  return { line: m ? parseInt(m[1], 10) : 1, message: (m ? m[2] : String(err)).trim() }
}

// installBridge exposes the script API as Lua globals. JS values passed into a Lua callback are
// auto-converted (objects → tables), so event payloads read naturally, e.g. `p.path`.
function installBridge(lua: LuaEngine): void {
  const g = lua.global

  // run("write:hi") — run a raw command string (async; result usually ignored by scripts).
  g.set('run', (input: string) => commander.run(input))

  // cmd("write", "hi") — same, but name + arg are joined with ":". Arg is optional.
  g.set('cmd', (name: string, arg?: string) =>
    commander.run(arg != null && arg !== '' ? `${name}:${arg}` : name)
  )

  // on("editor:save", fn) — subscribe to one event; returns an unsubscribe function.
  g.set('on', (event: string, fn: (payload: unknown) => void) => {
    const off = appBus.on(event as AppEventName, (payload) => fn(payload))

    unsubscribers.push(off)

    return off
  })

  // onAny(fn) — subscribe to every event (fn receives name, payload).
  g.set('onAny', (fn: (name: string, payload: unknown) => void) => {
    const off = appBus.onAny((name, payload) => fn(name, payload))

    unsubscribers.push(off)

    return off
  })

  // onKey("ctrl+shift+s", fn) — bind a key chord. Unlike on("key:…"), this is a real
  // keybinding: the chord's default action (e.g. Shift+Tab outdent) is suppressed. The
  // payload is the KeyEvent table. Modifier order/casing in the spec doesn't matter.
  g.set('onKey', (spec: string, fn: (e: unknown) => void) => {
    const combo = normCombo(spec)

    bindCombo(combo)

    const off = appBus.on(`key:${combo}` as AppEventName, (payload) => fn(payload))

    unsubscribers.push(off)

    return off
  })

  // emit("my:event", { x = 1 }) — fire an event on the bus.
  g.set('emit', (name: string, payload?: unknown) =>
    appBus.emit(name as AppEventName, (payload ?? {}) as never)
  )

  // console.info is mirrored into the Logs window by installConsoleCapture().
  g.set('log', (...args: unknown[]) => {
    const msg = args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')

    console.info('[lua]', msg)
  })

  // register("hr", fn, "summary") — define a new Commander command backed by a Lua function.
  g.set('register', (name: string, fn: (arg: string) => unknown, summary?: string) => {
    commander.register({
      name,
      group: 'Lua',
      params: 'arg',
      summary: summary || `Komenda Lua: ${name}`,
      run: (arg) => {
        fn(arg)
      }
    })
  })

  // api — the backend (gateway) surface, so scripts can read/write files, drive the AI,
  // scan projects, publish events, and manage stored scripts. Each call returns a promise;
  // wasmoon resolves it for the Lua side. Mirrors window.api (see global.d.ts / EVENTS bridge).
  g.set('api', {
    // files / project (gateway → filer / designer)
    readFile: (path: string) => window.api.readFile(path),
    saveFile: (path: string, content: string) => window.api.saveFile(path, content),
    createFile: (dir: string, file: string, name: string) => window.api.createFile(dir, file, name),
    createFolder: (dir: string, name: string) => window.api.createFolder(dir, name),
    moveFile: (oldPath: string, targetDir: string) => window.api.moveFile(oldPath, targetDir),
    renameFile: (oldPath: string, fileBase: string, className: string, oldName: string) =>
      window.api.renameFile(oldPath, fileBase, className, oldName),
    deleteFile: (path: string) => window.api.deleteFile(path),
    resolveImport: (from: string, spec: string) => window.api.resolveImport(from, spec),
    listProjects: () => window.api.listProjects(),
    getGraph: (projectId: number) => window.api.getGraph(projectId || 0),
    getAppGraph: (appId: number) => window.api.getAppGraph(appId),
    startScan: (path: string) => window.api.startScan(path),
    startScanApp: (appId: number) => window.api.startScanApp(appId),
    // disk browse (gateway → filer)
    fsHome: () => window.api.fsHome(),
    fsList: (path: string) => window.api.fsList(path),
    fsFind: (path: string) => window.api.fsFind(path),
    fsConventions: (path: string) => window.api.fsConventions(path),
    // AI (gateway → ai)
    aiAgent: (prompt: string, dir: string, lang: string) => window.api.aiAgent(prompt, dir, lang || 'pl'),
    aiEdit: (code: string, prompt: string, file: string) => window.api.aiEdit(code, prompt, file),
    aiComplete: (prefix: string, suffix: string, file: string) => window.api.aiComplete(prefix, suffix, file),
    aiReview: (code: string, file: string, lang: string) => window.api.aiReview(code, file, lang || 'pl'),
    aiModel: () => window.api.aiModel(),
    aiSetProvider: (provider: string) => window.api.aiSetProvider(provider),
    lintFile: (code: string, file: string) => window.api.lintFile(code, file),
    // backend events (gateway → events / Redis)
    publishEvent: (ev: Parameters<typeof window.api.publishEvent>[0]) => window.api.publishEvent(ev),
    // stored scripts (gateway → scripting / Postgres)
    listScripts: (project?: string) => window.api.listScripts(project),
    getScript: (id: number) => window.api.getScript(id),
    saveScript: (s: { id?: number; name: string; content: string; project?: string }) => window.api.saveScript(s),
    deleteScript: (id: number) => window.api.deleteScript(id)
  })
}

// runLuaSource executes Lua source against the shared engine.
export async function runLuaSource(src: string): Promise<void> {
  const lua = await getEngine()

  await lua.doString(src)
}

// runLuaFile reads a .lua file from disk (via the existing preload bridge) and runs it.
export async function runLuaFile(absPath: string): Promise<void> {
  const src = await window.api.readFile(absPath)

  await runLuaSource(src)
}

// disposeLua detaches every script subscription and tears down the engine — the clean slate a
// re-run needs. The next runLua* call builds a fresh engine.
export async function disposeLua(): Promise<void> {
  for (const off of unsubscribers.splice(0)) {
    try {
      off()
    } catch (e) {
      console.error('[lua] unsubscribe failed', e)
    }
  }

  clearBoundCombos() // drop key bindings registered via onKey

  if (enginePromise) {
    const lua = await enginePromise

    lua.global.close()
    enginePromise = null
  }
}
