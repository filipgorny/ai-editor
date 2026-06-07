import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import NotesIcon from '@mui/icons-material/Notes'
import TaskAltIcon from '@mui/icons-material/TaskAlt'
import { colors } from '@/styles/tokens'
import { appBus } from '@/events/bus'

// TopBarStats — compact horizontal display of today's activity counters (keystrokes,
// lines of code written, tasks finished). It replaces the old 'ai-architect' label in
// the topbar. Values come from the main process (window.api.statsGet); the component
// stays fresh by subscribing to the 'stats:change' bus event AND polling as a fallback
// (the event is emitted by the integration phase after every statsBump).

// The 'stats:change' event is not yet part of AppEventMap (the integration phase owns
// events/bus.ts and will add it). We subscribe via a typed cast so this component is
// self-contained today and needs no edit once the event lands in the catalog.
type StatsChange = { keystrokes: number; lines: number; tasks: number }
const STATS_CHANGE = 'stats:change' as never

// How often we re-read the counters from main as a safety net (the bus event makes
// updates instant; polling just guarantees eventual consistency and the daily reset).
const POLL_MS = 5000

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  user-select: none;
`

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  color: ${colors.muted};

  svg {
    font-size: 15px;
    opacity: 0.75;
  }
`

// Number — monospace so digit width is stable and the row never jitters as counters tick.
const Count = styled.span`
  font-family: 'Hack', 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
  color: ${colors.controller};
  min-width: 1.6ch;
  text-align: right;
`

const Label = styled.span`
  font-size: 11px;
  letter-spacing: 0.02em;
`

const Today = styled.span`
  font-family: 'Hack', 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${colors.muted};
  opacity: 0.6;
`

function emptyStats(): Stats {
  return { keystrokes: 0, lines: 0, tasks: 0, day: '' }
}

export function TopBarStats(): React.ReactElement {
  const { t } = useTranslation()
  const [stats, setStats] = useState<Stats>(emptyStats)

  useEffect(() => {
    let alive = true

    const refresh = async (): Promise<void> => {
      try {
        const s = await window.api.statsGet()

        if (alive && s) {
          setStats(s)
        }
      } catch {
        // Stats are non-critical UI sugar — never surface a failure here.
      }
    }

    refresh()

    // Instant updates: the integration phase emits 'stats:change' after each statsBump.
    const off = appBus.on(STATS_CHANGE, (p: StatsChange) => {
      setStats((prev) => ({ ...prev, ...p }))
    })

    const timer = window.setInterval(refresh, POLL_MS)

    return () => {
      alive = false
      off()
      window.clearInterval(timer)
    }
  }, [])

  return (
    <Row title={t('stats.today')}>
      <Item title={t('stats.keystrokes')}>
        <KeyboardIcon />
        <Count>{stats.keystrokes}</Count>
        <Label>{t('stats.keystrokes')}</Label>
      </Item>

      <Item title={t('stats.lines')}>
        <NotesIcon />
        <Count>{stats.lines}</Count>
        <Label>{t('stats.lines')}</Label>
      </Item>

      <Item title={t('stats.tasks')}>
        <TaskAltIcon />
        <Count>{stats.tasks}</Count>
        <Label>{t('stats.tasks')}</Label>
      </Item>

      <Today>{t('stats.today')}</Today>
    </Row>
  )
}

// installKeystrokeCounter — a lightweight, self-contained global keystroke counter. It
// batches keydowns in the renderer and flushes a single statsBump('keystrokes', n) on a
// timer, so we never hit IPC on every key (mirrors installLogPersist's batching). The
// integration phase calls this once (e.g. in App's mount effect) and stores the returned
// disposer; nothing else is required from App.
//
//   useEffect(() => installKeystrokeCounter(), [])
//
// Returns an unsubscribe () => void that detaches the listener and flushes any remainder.
export function installKeystrokeCounter(flushMs = 2500): () => void {
  let pending = 0
  let flushing = false

  const flush = async (): Promise<void> => {
    if (pending === 0 || flushing) return

    const n = pending
    pending = 0
    flushing = true

    try {
      const s = await window.api.statsBump('keystrokes', n)

      // Echo onto the bus so TopBarStats (and any listener) updates instantly without
      // waiting for its poll. Emitted via cast until 'stats:change' joins AppEventMap.
      if (s) {
        appBus.emit(STATS_CHANGE, { keystrokes: s.keystrokes, lines: s.lines, tasks: s.tasks } as never)
      }
    } catch {
      // Restore the count so a transient IPC failure doesn't silently drop keystrokes.
      pending += n
    } finally {
      flushing = false
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    // Ignore auto-repeat and pure modifier presses — they are not "real" keystrokes.
    if (e.repeat) return

    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return

    pending += 1
  }

  window.addEventListener('keydown', onKeyDown, true)

  const timer = window.setInterval(() => void flush(), flushMs)

  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.clearInterval(timer)
    void flush()
  }
}

export default TopBarStats
