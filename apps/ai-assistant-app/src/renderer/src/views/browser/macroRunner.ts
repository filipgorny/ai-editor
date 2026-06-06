// macroRunner — runs a browser macro (Lua source) against a single Electron <webview>.
//
// A macro is a tiny Lua program that drives the loaded page through a handful of
// page-action globals — click / type / fill / wait / waitFor / goto / value — each of
// which is translated here into a webview.executeJavaScript call evaluated INSIDE the
// guest page (so the selectors resolve against the page DOM, not the host renderer).
//
// Example macro body:
//   type('#email', 'a@b.com')
//   type('#password', 'test')
//   click('#submit')
//
// We deliberately use a SEPARATE wasmoon engine from lua/runtime.ts: that engine exposes
// the Commander/app-bus/api surface and keeps long-lived `on()` subscriptions alive, while
// a macro is a one-shot program whose only globals are the page actions bound to one
// webview. Mixing them would either leak page globals into user scripts or let a macro
// reach the whole app API. The wasm itself is loaded lazily (and only once) so the ~270 KB
// blob stays out of the initial bundle until a macro actually runs.

import type { LuaEngine } from 'wasmoon'

// The subset of Electron's <webview> element we rely on. Kept local so this file does not
// depend on the global JSX webview typing (which the browser view declares for itself).
export interface MacroWebview {
  executeJavaScript(code: string): Promise<unknown>
  getURL(): string
  loadURL?(url: string): Promise<void>
  src?: string
}

// MacroLog — a single line emitted while a macro runs, surfaced in the macros panel so the
// user can see what each step did (and where it failed).
export interface MacroLog {
  level: 'info' | 'error'
  text: string
}

// One factory shared across runs so the wasm compiles once. Imported lazily inside a
// try/catch — if wasmoon is unavailable the runner degrades to a clear error instead of
// hard-failing the bundle (mirrors the optional-native rule used elsewhere).
let factoryPromise: Promise<{ createEngine(): Promise<LuaEngine> }> | null = null

async function getFactory(): Promise<{ createEngine(): Promise<LuaEngine> }> {
  if (!factoryPromise) {
    factoryPromise = (async () => {
      const { LuaFactory } = await import('wasmoon')
      const glue = (await import('wasmoon/dist/glue.wasm?url')).default

      return new LuaFactory(glue)
    })()
  }

  return factoryPromise
}

// jsString — JSON-encode a value for safe interpolation into an executeJavaScript snippet.
function jsString(v: unknown): string {
  return JSON.stringify(v == null ? '' : String(v))
}

// runInPage evaluates an expression inside the guest page and resolves with its result. The
// snippet is wrapped in an async IIFE so callers can `await` page work (e.g. dispatched
// events settling) uniformly.
async function runInPage(view: MacroWebview, expr: string): Promise<unknown> {
  const code = `(async () => { ${expr} })()`

  return view.executeJavaScript(code)
}

// pageActions are the Lua-visible globals. Each returns a promise; wasmoon awaits it before
// the next Lua statement runs, so a macro reads top-to-bottom even though every step is async.
function pageActions(view: MacroWebview, log: (l: MacroLog) => void): Record<string, unknown> {
  // click(selector) — click the first matching element; errors if none is found.
  const click = async (selector: string): Promise<void> => {
    const sel = jsString(selector)
    const expr = `
      const el = document.querySelector(${sel});

      if (!el) {
        throw new Error('no element for selector ' + ${sel});
      }

      el.scrollIntoView({ block: 'center' });
      el.click();
    `

    await runInPage(view, expr)

    log({ level: 'info', text: `click(${selector})` })
  }

  // type(selector, text) — focus the field, set its value, and fire input/change so React/Vue
  // controlled inputs pick the value up.
  const type = async (selector: string, text: string): Promise<void> => {
    const sel = jsString(selector)
    const val = jsString(text)
    const expr = `
      const el = document.querySelector(${sel});

      if (!el) {
        throw new Error('no element for selector ' + ${sel});
      }

      el.focus();
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');

      if (setter && setter.set) {
        setter.set.call(el, ${val});
      } else {
        el.value = ${val};
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    `

    await runInPage(view, expr)

    log({ level: 'info', text: `type(${selector}, …)` })
  }

  // value(selector) — read an element's value/text (returned to the Lua side).
  const value = async (selector: string): Promise<string> => {
    const sel = jsString(selector)
    const expr = `
      const el = document.querySelector(${sel});

      return el ? ('value' in el ? el.value : el.textContent) : '';
    `

    return (await runInPage(view, expr)) as string
  }

  // waitFor(selector, timeoutMs?) — poll the page until the selector appears or the timeout
  // elapses (default 5s). Lets macros wait for navigation/async UI before the next step.
  const waitFor = async (selector: string, timeoutMs?: number): Promise<void> => {
    const sel = jsString(selector)
    const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000
    const expr = `
      const start = Date.now();

      while (Date.now() - start < ${limit}) {
        if (document.querySelector(${sel})) {
          return true;
        }

        await new Promise((r) => setTimeout(r, 80));
      }

      throw new Error('timeout waiting for ' + ${sel});
    `

    await runInPage(view, expr)

    log({ level: 'info', text: `waitFor(${selector})` })
  }

  // wait(ms) — plain delay.
  const wait = async (ms: number): Promise<void> => {
    const delay = typeof ms === 'number' && ms > 0 ? ms : 0

    await new Promise((r) => setTimeout(r, delay))

    log({ level: 'info', text: `wait(${delay}ms)` })
  }

  // goto(url) — navigate the page (uses loadURL when available, else assigns src).
  const goto = async (url: string): Promise<void> => {
    if (view.loadURL) {
      await view.loadURL(url)
    } else {
      view.src = url
    }

    log({ level: 'info', text: `goto(${url})` })
  }

  // log(msg) — surface a custom line from the macro into the panel.
  const luaLog = (...args: unknown[]): void => {
    const text = args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')

    log({ level: 'info', text })
  }

  return { click, type, fill: type, value, waitFor, wait, goto, log: luaLog }
}

// runMacro compiles + runs `source` against `view`, streaming step logs through `onLog`.
// It resolves when the macro finishes and rejects (after logging) on a Lua/runtime error.
// The engine is created fresh per run and closed afterwards so macros never share state.
export async function runMacro(
  source: string,
  view: MacroWebview,
  onLog?: (l: MacroLog) => void
): Promise<void> {
  const log = (l: MacroLog): void => onLog?.(l)

  let engine: LuaEngine | null = null

  try {
    const factory = await getFactory()

    engine = await factory.createEngine()

    const actions = pageActions(view, log)

    for (const [name, fn] of Object.entries(actions)) {
      engine.global.set(name, fn)
    }

    await engine.doString(source)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    log({ level: 'error', text: msg })

    throw err
  } finally {
    if (engine) {
      try {
        engine.global.close()
      } catch {
        // engine teardown is best-effort
      }
    }
  }
}
