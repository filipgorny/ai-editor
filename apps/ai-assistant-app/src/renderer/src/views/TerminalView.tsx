// TerminalView — the terminal view (ViewKey 'terminal').
//
// A real terminal emulator built on xterm.js, wired to a main-process PTY through the
// window.api term* IPC (start/write/resize/onData/onExit). Hack font, near-white text on
// a black background, full ANSI colors. The terminal fits its container and resizes the
// PTY whenever the container changes size or the view becomes active.
//
// This view is keepMounted=true at the registry level, so the xterm instance and its PTY
// survive view switches — we therefore create the PTY once on mount and only re-fit/focus
// when the view becomes active again.
//
// xterm.js and its fit addon are heavy and only needed here, so they are lazy-imported.
// If that import fails (packages not installed) or the PTY backend reports unavailable
// (onTermExit with code -1), we render an i18n'd message instead of crashing.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import type { ViewContext } from './types'

// Minimal structural types for the lazily-imported xterm API so this file type-checks
// even before the @xterm packages are installed (they ship their own types once present).
type XtermTerminal = {
  open: (el: HTMLElement) => void
  write: (data: string) => void
  focus: () => void
  dispose: () => void
  loadAddon: (addon: unknown) => void
  onData: (cb: (data: string) => void) => { dispose: () => void }
  onResize: (cb: (size: { cols: number; rows: number }) => void) => { dispose: () => void }
  onTitleChange: (cb: (title: string) => void) => { dispose: () => void }
  cols: number
  rows: number
}

type XtermFitAddon = { fit: () => void }

const Wrap = styled.div`
  width: 100%;
  height: 100%;
  background: #000000;
  overflow: hidden;
  position: relative;
`

// The xterm host fills the wrap with a little padding so glyphs don't touch the edges.
const TermHost = styled.div`
  position: absolute;
  inset: 0;
  padding: 8px 10px;
  /* xterm injects its own canvas/DOM; we only own the box and the font here. */
  & .xterm,
  & .xterm-viewport,
  & .xterm-screen {
    height: 100% !important;
  }
`

const Notice = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: #c9d1d9;
  font-family: Hack, monospace;
  font-size: 14px;
  background: #000000;
`

// Near-white on black, full ANSI palette (GitHub-dark-ish so it sits with the app theme).
const THEME = {
  background: '#000000',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(255,255,255,0.25)',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
}

export default function TerminalView({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XtermTerminal | null>(null)
  const fitRef = useRef<XtermFitAddon | null>(null)
  const idRef = useRef<string>(`term-${Math.random().toString(36).slice(2)}`)

  // unavailable becomes true if xterm can't be loaded or the PTY backend isn't there.
  const [unavailable, setUnavailable] = useState(false)

  // fit + resize the PTY to match the current host size. Guarded so it is a no-op before
  // the terminal exists or while the host has zero size (hidden view).
  const fitNow = (): void => {
    const term = termRef.current
    const fit = fitRef.current

    if (!term || !fit) return

    try {
      fit.fit()
      ctx.api.termResize(idRef.current, term.cols, term.rows)
    } catch {
      // A zero-sized or detached host can throw inside fit(); ignore until visible.
    }
  }

  // One-time setup: lazy-import xterm, create the terminal + PTY, wire the data pipes.
  useEffect(() => {
    let disposed = false
    const id = idRef.current
    const offs: Array<() => void> = []

    ;(async () => {
      let mod: { Terminal: new (opts: unknown) => XtermTerminal }
      let fitMod: { FitAddon: new () => XtermFitAddon }

      try {
        // @ts-ignore — @xterm/xterm is an optional, lazily-installed dependency; the
        // specifier may be unresolved at type-check time until `pnpm install` runs.
        mod = (await import('@xterm/xterm')) as unknown as {
          Terminal: new (opts: unknown) => XtermTerminal
        }
        // @ts-ignore — see above; @xterm/addon-fit is installed alongside @xterm/xterm.
        fitMod = (await import('@xterm/addon-fit')) as unknown as {
          FitAddon: new () => XtermFitAddon
        }

        // @ts-ignore — CSS side-effect import; resolved by the bundler, not TS.
        await import('@xterm/xterm/css/xterm.css')
      } catch {
        if (!disposed) setUnavailable(true)

        return
      }

      if (disposed || !hostRef.current) return

      const term = new mod.Terminal({
        fontFamily: 'Hack, monospace',
        fontSize: 15,
        cursorBlink: true,
        allowProposedApi: true,
        theme: THEME
      })

      const fit = new fitMod.FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)

      termRef.current = term
      fitRef.current = fit
      fit.fit()

      // Pipe keystrokes from the terminal to the PTY.
      offs.push(
        term.onData((data) => {
          ctx.api.termWrite(id, data)
        }).dispose
      )

      // When the terminal reflows, tell the PTY the new geometry.
      offs.push(
        term.onResize(({ cols, rows }) => {
          ctx.api.termResize(id, cols, rows)
        }).dispose
      )

      // Report OSC title changes on the bus so the integration phase can label tabs.
      offs.push(
        term.onTitleChange((title) => {
          // 'terminal:title' is not yet in AppEventMap (integration-owned); emit via cast.
          ;(ctx.bus.emit as unknown as (name: string, payload: unknown) => void)('terminal:title', {
            id,
            title
          })
        }).dispose
      )

      // PTY → terminal output stream.
      offs.push(
        ctx.api.onTermData((ev) => {
          if (ev.id === id) term.write(ev.data)
        })
      )

      // PTY exit. code === -1 is the contract's "backend unavailable" signal.
      offs.push(
        ctx.api.onTermExit((ev) => {
          if (ev.id !== id) return

          if (ev.code === -1) {
            setUnavailable(true)

            return
          }

          term.write(`\r\n\x1b[90m[${t('terminal.closed')}]\x1b[0m\r\n`)
        })
      )

      // Start the PTY for this session in the open project (or home if none).
      ctx.api.termStart({
        id,
        cwd: ctx.folder || undefined,
        cols: term.cols,
        rows: term.rows
      })
    })()

    return () => {
      disposed = true

      for (const off of offs) {
        try {
          off()
        } catch {
          // ignore unsubscribe errors
        }
      }

      try {
        ctx.api.termKill(id)
      } catch {
        // backend may already be gone
      }

      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // Setup runs once for this mounted view; ctx fields read here are read at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Observe container size and refit (the view is keepMounted, so size can change while
  // hidden then shown). ResizeObserver also covers window resizes.
  useEffect(() => {
    const host = hostRef.current

    if (!host || unavailable) return

    const ro = new ResizeObserver(() => {
      fitNow()
    })

    ro.observe(host)

    return () => {
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable])

  // When this view becomes active, the host transitions from display:none to visible and
  // gains real dimensions — refit and focus so typing lands in the terminal immediately.
  useEffect(() => {
    if (!ctx.active || unavailable) return

    const raf = requestAnimationFrame(() => {
      fitNow()
      termRef.current?.focus()
    })

    return () => {
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.active, unavailable])

  if (unavailable) {
    return (
      <Wrap>
        <Notice>{t('terminal.unavailable')}</Notice>
      </Wrap>
    )
  }

  return (
    <Wrap onMouseDown={() => termRef.current?.focus()}>
      <TermHost ref={hostRef} />
    </Wrap>
  )
}
