// useViewKeys — global keyboard handling for the multi-view shell.
//
//   ALT+0..7      → select the view at that index (registry order)
//   Shift+Tab     → cycle to the next view (wraps)
//   ALT+Left      → previous open editor window (emits 'editor:nav' { dir: 'prev' })
//   ALT+Right     → next open editor window (emits 'editor:nav' { dir: 'next' })
//   Escape        → focus the bottom AI area (emits 'ai:focus')
//
// These are sensible HARDCODED defaults for now. They are deliberately implemented over
// the app bus (the same 'key' stream user Lua scripts listen to) so they can later be
// replaced by editable scripts: the integration phase can move Shift+Tab / ALT+n into
// the default Lua script and drop the matching branch here without touching callers.
//
// We subscribe to the bus 'key' event (not a raw DOM listener) so behaviour stays
// consistent with keys.ts and so a single capture-phase listener drives everything.

import { useEffect } from 'react'
import { appBus, type AppEventName, type KeyEvent } from '../events'
import type { ViewKey } from '../views/types'

// Bus events this hook emits that are not (yet) in AppEventMap. They are owned by the
// integration phase (events/bus.ts); until they're declared there we emit them with a
// cast, exactly like keys.ts does for its dynamic 'key:<combo>' events.
type EmitArgs = { 'view:change': { from: ViewKey | null; to: ViewKey }; 'editor:nav': { dir: 'prev' | 'next' }; 'ai:focus': { source?: string } }

function emit<K extends keyof EmitArgs>(name: K, payload: EmitArgs[K]): void {
  appBus.emit(name as AppEventName, payload as never)
}

export interface ViewKeysOptions {
  // Ordered view keys (registry order). index === ALT ordinal === Shift+Tab order.
  order: ViewKey[]
  // The currently active view key (read live).
  active: ViewKey
  // Switch the active view (App mutates state + emits 'view:change').
  setActive: (key: ViewKey) => void
}

export function useViewKeys(opts: ViewKeysOptions): void {
  const { order, active, setActive } = opts

  useEffect(() => {
    const onKey = (e: KeyEvent): void => {
      // — Escape: jump to the AI area. Always emitted; AgentBar grabs focus. The vim
      // ':' command-line split lives in App.runAsk, not here.
      if (e.combo === 'escape') {
        emit('ai:focus', { source: 'key' })

        return
      }

      // — ALT+digit: select the view at that ordinal (ignore out-of-range digits).
      if (e.alt && !e.ctrl && !e.meta && !e.shift && /^[0-9]$/.test(e.key)) {
        const idx = Number(e.key)
        const next = order[idx]

        if (next && next !== active) {
          setActive(next)
        }

        return
      }

      // — ALT+Arrow: cycle the open editor windows (App handles the actual switch).
      if (e.alt && !e.ctrl && !e.meta && !e.shift && e.key === 'arrowleft') {
        emit('editor:nav', { dir: 'prev' })

        return
      }

      if (e.alt && !e.ctrl && !e.meta && !e.shift && e.key === 'arrowright') {
        emit('editor:nav', { dir: 'next' })

        return
      }

      // — Shift+Tab: cycle to the next view (wraps). Implemented here as a default; the
      // integration phase may move this into the editable Lua script.
      if (e.shift && !e.ctrl && !e.alt && !e.meta && e.key === 'tab') {
        if (order.length === 0) {
          return
        }

        const cur = order.indexOf(active)
        const next = order[(cur + 1) % order.length]

        if (next) {
          setActive(next)
        }
      }
    }

    return appBus.on('key', onKey)
  }, [order, active, setActive])
}
