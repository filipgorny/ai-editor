// A tiny in-memory log store for the Logs window. Every console.* call is mirrored here (see
// installConsoleCapture), so script `log()` output, command errors and any other console output
// show up with a timestamp.

export type LogLevel = 'info' | 'error'
export type LogEntry = { time: number; message: string; level: LogLevel }

type Sub = (entries: LogEntry[]) => void

const MAX = 1000
const MAX_PENDING = 5000
let entries: LogEntry[] = []
let pending: LogEntry[] = [] // not-yet-persisted lines, flushed to the logs service in batches
const subs = new Set<Sub>()

function notify(): void {
  for (const s of [...subs]) {
    try {
      s(entries)
    } catch (e) {
      console.error('[logs] subscriber threw', e)
    }
  }
}

export const logBus = {
  // push appends a log line (timestamped now), queues it for persistence, and notifies.
  push(message: string, level: LogLevel = 'info'): void {
    const entry: LogEntry = { time: Date.now(), message, level }

    entries = [...entries.slice(-(MAX - 1)), entry]
    pending = [...pending.slice(-(MAX_PENDING - 1)), entry]
    notify()
  },

  // ingest adds entries for display only (e.g. history loaded from the service) — NOT re-queued
  // for persistence. Keeps the buffer in chronological order.
  ingest(list: LogEntry[]): void {
    if (!list.length) {
      return
    }

    entries = [...entries, ...list].sort((a, b) => a.time - b.time).slice(-MAX)
    notify()
  },

  get(): LogEntry[] {
    return entries
  },

  clear(): void {
    entries = []
    pending = []
    notify()
  },

  // subscribe registers a listener (called immediately with the current buffer) and returns an
  // unsubscribe function.
  subscribe(cb: Sub): () => void {
    subs.add(cb)
    cb(entries)

    return () => {
      subs.delete(cb)
    }
  }
}

// format turns console arguments into a single string (objects → JSON, falling back to String).
function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a === null || typeof a !== 'object') {
        return String(a)
      }

      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

let patched = false

// installConsoleCapture overrides console.log/info/warn/error so every call is also recorded in
// the log store (the original console still runs). Lua `log()` and command errors flow through
// console, so they appear too. console.debug is left alone (used by the noisy DEV event logger).
export function installConsoleCapture(): void {
  if (patched || typeof console === 'undefined') {
    return
  }

  patched = true

  const levels: [keyof Console, LogLevel][] = [
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'error'],
    ['error', 'error']
  ]

  for (const [name, level] of levels) {
    const c = console as unknown as Record<string, (...a: unknown[]) => void>
    const orig = c[name].bind(console)

    c[name] = (...args: unknown[]) => {
      orig(...args)

      try {
        logBus.push(format(args), level)
      } catch {
        // never let logging break the caller
      }
    }
  }
}

let errorCaptureInstalled = false

// installErrorCapture forwards UNCAUGHT errors and UNHANDLED promise rejections to the
// log store, so they're persisted to the logs service (via gateway) like everything else.
// Complements installConsoleCapture (which only catches console.* calls).
export function installErrorCapture(): void {
  if (errorCaptureInstalled || typeof window === 'undefined') {
    return
  }

  errorCaptureInstalled = true

  window.addEventListener('error', (e) => {
    try {
      const err = e.error as Error | undefined
      logBus.push('Uncaught error: ' + (err?.stack || err?.message || e.message || 'unknown'), 'error')
    } catch {
      // never let logging break anything
    }
  })

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e.reason as { stack?: string; message?: string } | string | undefined
      const msg = typeof r === 'string' ? r : r?.stack || r?.message || String(r)
      logBus.push('Unhandled promise rejection: ' + msg, 'error')
    } catch {
      // never let logging break anything
    }
  })
}

let persistInstalled = false

// installLogPersist wires the log store to the backend logs service (via gateway): loads recent
// history once, then flushes new lines in batches. Failures are swallowed (never logged — that
// would recurse through the console capture).
export function installLogPersist(): void {
  if (persistInstalled || typeof window === 'undefined' || !window.api) {
    return
  }

  persistInstalled = true

  // Load persisted history (previous sessions) for the Logs window.
  window.api
    .listLogs(500)
    .then((rows) => logBus.ingest(rows.map((r) => ({ time: r.time, message: r.message, level: r.level === 'error' ? 'error' : 'info' }))))
    .catch(() => undefined)

  const flush = (): void => {
    if (!pending.length) {
      return
    }

    const batch = pending
    pending = []

    window.api
      .appendLogs(batch.map((e) => ({ time: e.time, level: e.level, message: e.message })))
      .catch(() => undefined) // drop on failure; don't requeue (avoids unbounded growth / loops)
  }

  window.setInterval(flush, 2500)
}
