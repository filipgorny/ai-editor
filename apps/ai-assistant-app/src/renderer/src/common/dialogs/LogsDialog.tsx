import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ClearAllIcon from '@mui/icons-material/ClearAll'
import styled from 'styled-components'
import { colors } from '@/styles/tokens'
import { logBus, type LogEntry } from '@/events'

const WIN_W = Math.min(900, Math.round(window.innerWidth * 0.8))
const WIN_H = Math.round(window.innerHeight * 0.6)

const Win = styled.div`
  position: fixed;
  display: flex;
  flex-direction: column;
  background: #000;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.65);
  z-index: 1400;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${colors.border};
  cursor: move;
`

const HeaderTitle = styled.div`
  flex: 1;
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
`

const Area = styled.div`
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
  font-family: Hack, monospace;
  font-size: 13px;
  line-height: 1.5;
  background: ${colors.bg};
`

const Row = styled.div<{ $error: boolean }>`
  white-space: pre-wrap;
  word-break: break-word;
  color: ${(p) => (p.$error ? '#f85149' : '#e6edf3')};
`

const Time = styled.span`
  color: ${colors.muted};
  margin-right: 8px;
`

const Empty = styled.div`
  color: ${colors.muted};
  padding: 8px 0;
`

// LogsDialog — a movable window that streams every log line (Lua `log()` + command errors)
// with its timestamp. Auto-scrolls to the newest entry.
export default function LogsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [pos, setPos] = useState({
    x: Math.round((window.innerWidth - WIN_W) / 2),
    y: Math.round((window.innerHeight - WIN_H) / 2)
  })
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    return logBus.subscribe(setEntries)
  }, [open])

  // Stick to the bottom as new lines arrive.
  useEffect(() => {
    const el = areaRef.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [entries])

  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const start = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }

    const move = (ev: MouseEvent): void => {
      setPos({ x: start.px + ev.clientX - start.mx, y: start.py + ev.clientY - start.my })
    }

    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!open) {
    return null
  }

  return (
    <Win style={{ left: pos.x, top: pos.y, width: WIN_W, height: WIN_H }}>
      <Header onMouseDown={startDrag}>
        <HeaderTitle>{t('logs.title')}</HeaderTitle>
        <Tooltip title={t('logs.clear')}>
          <IconButton
            size="small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              logBus.clear()
              window.api.clearLogs().catch(() => undefined)
            }}
          >
            <ClearAllIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Header>
      <Area ref={areaRef}>
        {entries.length === 0 ? (
          <Empty>{t('logs.empty')}</Empty>
        ) : (
          entries.map((e, i) => (
            <Row key={i} $error={e.level === 'error'}>
              <Time>{new Date(e.time).toLocaleString()}</Time>
              {e.message}
            </Row>
          ))
        )}
      </Area>
    </Win>
  )
}
