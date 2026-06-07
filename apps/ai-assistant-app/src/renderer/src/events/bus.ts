// In-app event bus — a purely frontend (renderer) event bus. Do NOT confuse it with
// window.api.publishEvent, which publishes to the backend (gateway → events/Redis).
//
// Goal: a single place all UI events flow through, so components (and, later, user
// scripts) can react to them without tight coupling. The bus is exposed globally as
// window.appBus — the hook point for scripts.

// ViewKey is type-only (a string-literal union) — importing it here does not create a
// runtime cycle with views/types.ts (which type-imports appBus back).
import type { ViewKey } from '../views/types'

// AppEventMap — the event catalog: name → payload shape. Source of truth for EVENTS.md.
export type AppEventMap = {
  // — Project / scanning —
  'project:open': { folder: string }
  'scan:start': { kind: 'project' | 'app'; path?: string; appId?: number }
  'scan:progress': { currentFile: string; filesDone: number; entitiesDone: number }
  'scan:end': { kind: 'project' | 'refresh' | 'expand' }
  'scan:error': { message: string }

  // — Navigation —
  'nav:back': Record<string, never>
  'nav:forward': Record<string, never>
  'nav:app-expand': { appId: number }

  // — File operations (on-disk mutations) —
  'file:create': { path: string; kind: 'class' | 'function' }
  'folder:create': { path: string }
  'file:rename': { from: string; to: string }
  'file:move': { from: string; to: string }
  'file:delete': { path: string }

  // — Disk watcher (external changes on disk, detected by the filer; not made by the app) —
  'disk:change': { path: string; op: 'create' | 'write' | 'remove' | 'rename' | 'chmod'; dir: boolean }
  'disk:refresh': { path: string }

  // — Editor —
  'editor:open': { path: string }
  'editor:close': { path: string }
  'editor:activate': { path: string }
  'editor:minimize': { path: string }
  'editor:save': { path: string }
  'editor:load-error': { path: string }
  'editor:fullscreen': { path: string; on: boolean }
  'editor:ai-edit': { path: string }
  // Re-read a file from disk into its open editor (F5). Empty path = reload every open editor.
  'editor:reload': { path: string }

  // — AI agent —
  'agent:start': { prompt: string; dir: string }
  'agent:success': { ops: number; message: string }
  'agent:error': { message: string }

  // — Graph —
  'graph:node-click': { id: string; kind: string }
  'graph:node-dblclick': { id: string; kind: string }
  'graph:folder-toggle': { id: string; expanded: boolean }
  'graph:search': { query: string }
  'graph:move-start': { path: string }
  // review mode toggled on/off (count = changed files when turning on)
  'review:toggle': { on: boolean; count?: number }

  // — Settings —
  'settings:provider-change': { provider: string }
  'settings:theme-change': { theme: string }
  'settings:language-change': { lang: string }

  // — Commander (see COMMANDS.md) —
  'command:run': { name: string; arg: string }
  'command:error': { name: string; arg: string; message: string }

  // — Multi-view shell (see VIEWS / the view registry) —
  // App switched the active view (ALT+n, Shift+Tab, rail click). Views subscribe to know
  // when they become active.
  'view:change': { from: ViewKey | null; to: ViewKey }
  // Any component asks App to switch views (deep-link / 'open in editor'); App is the only
  // listener that mutates the active view.
  'view:request': { to: ViewKey }

  // — AI prompt area —
  // Escape pressed anywhere: focus the bottom AI prompt textarea. AgentBar subscribes.
  'ai:focus': { source?: string }
  // A vim ':' command-line was submitted from the AI area; Commander/vim handles it, it is
  // NOT sent to the LLM. Commander subscribes and sets handled=true when consumed.
  'ai:command': { text: string; handled: boolean }

  // — Telescope finder (Esc+Space) —
  'telescope:open': Record<string, never>
  'telescope:pick': { absPath: string; line?: number }

  // — Editor window navigation (ALT+arrow / mouse back-forward in the editor view) —
  'editor:nav': { dir: 'prev' | 'next' }

  // — Tasks / stats / terminal / browser / deployment views —
  'tasks:active-change': { id: number; title: string; branch?: string }
  'stats:change': { keystrokes: number; lines: number; tasks: number }
  'terminal:title': { id: string; title: string }
  'browser:navigate': { id: string; url: string }
  // Any component asks the browser view to open a URL in a page (e.g. the diagram's Run
  // button opening a freshly-started React dev server). BrowserView subscribes.
  'browser:open': { url: string }
  'deployment:dirty': { changed: boolean }

  // — Keyboard (see keys.ts / SCRIPTING.md). 'key:<combo>' variants are emitted dynamically. —
  key: KeyEvent
  keyup: KeyEvent
}

// KeyEvent — payload for the keyboard events ('key'/'keyup' and their 'key:<combo>' variants).
export type KeyEvent = {
  key: string
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  combo: string
  repeat: boolean
  editable: boolean
}

export type AppEventName = keyof AppEventMap

type Handler<K extends AppEventName> = (payload: AppEventMap[K]) => void
type AnyHandler = <K extends AppEventName>(name: K, payload: AppEventMap[K]) => void

// EventBus — a minimal, synchronous emitter with per-name subscriptions and a wildcard
// (onAny) for scripts/loggers. Each handler is isolated in try/catch so one bad
// subscriber can't stop the rest or the emit.
class EventBus {
  private handlers = new Map<AppEventName, Set<Handler<AppEventName>>>()
  private anyHandlers = new Set<AnyHandler>()

  // on registers a handler and returns an unsubscribe function.
  on<K extends AppEventName>(name: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(name)

    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }

    set.add(handler as Handler<AppEventName>)

    return () => this.off(name, handler)
  }

  // once — like on, but unsubscribes after the first call.
  once<K extends AppEventName>(name: K, handler: Handler<K>): () => void {
    const off = this.on(name, (payload) => {
      off()
      handler(payload)
    })

    return off
  }

  off<K extends AppEventName>(name: K, handler: Handler<K>): void {
    this.handlers.get(name)?.delete(handler as Handler<AppEventName>)
  }

  // onAny listens to ALL events — the main hook for user scripts.
  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler)

    return () => {
      this.anyHandlers.delete(handler)
    }
  }

  // emit dispatches an event to its name subscribers and to every onAny handler.
  emit<K extends AppEventName>(name: K, payload: AppEventMap[K]): void {
    const set = this.handlers.get(name)

    if (set) {
      for (const h of [...set]) {
        try {
          h(payload)
        } catch (e) {
          console.error(`[appBus] handler for "${name}" threw`, e)
        }
      }
    }

    for (const h of [...this.anyHandlers]) {
      try {
        h(name, payload)
      } catch (e) {
        console.error(`[appBus] onAny handler threw on "${name}"`, e)
      }
    }
  }
}

export const appBus = new EventBus()

// Global access — the hook point for future user scripts.
declare global {
  interface Window {
    appBus: EventBus
  }
}

if (typeof window !== 'undefined') {
  window.appBus = appBus
}
