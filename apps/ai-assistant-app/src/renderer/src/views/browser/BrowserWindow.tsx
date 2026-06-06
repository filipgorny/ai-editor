// BrowserWindow — one floating page window inside the browser view.
//
// The floating frame (drag via the title bar / middle mouse button / Alt+left, edge
// resizing and scene snapping) is delegated to the shared <Window> component; this file
// only adds the browser chrome: a title bar, an address bar (type a URL/term, Enter to go),
// navigation buttons, a macros button (opens MacrosPanel against THIS page's <webview>) and
// a close button. The page itself is an Electron <webview> isolated in its own partition.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardIos'
import RefreshIcon from '@mui/icons-material/Refresh'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CloseIcon from '@mui/icons-material/Close'
import styled from 'styled-components'
import Window, { type WindowGeom } from '../../components/Window'
import { colors } from '../../styles/tokens'
import type { Api } from './types'
import type { MacroWebview } from './macroRunner'
import MacrosPanel from './MacrosPanel'

const TitleBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  background: ${colors.panel};
  border-bottom: 1px solid ${colors.border};
  cursor: move;
  user-select: none;
`

const Grip = styled.div`
  flex: none;
  width: 28px;
  height: 8px;
  border-radius: 4px;
  background: repeating-linear-gradient(90deg, #555c66, #555c66 2px, transparent 2px, transparent 5px);
  opacity: 0.8;
`

const TitleText = styled.div`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #c9d1d9;
  font-size: 12px;
`

const Bar = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: ${colors.panel};
  border-bottom: 1px solid ${colors.border};
`

const Address = styled.input`
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  color: #e6edf3;
  font-family: 'Hack', monospace;
  font-size: 12.5px;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

const PageWrap = styled.div`
  flex: 1;
  min-height: 0;
  background: #fff;

  & > webview {
    width: 100%;
    height: 100%;
    border: 0;
  }
`

// Default search engine used only when the typed text is clearly NOT an address.
const SEARCH_URL = 'https://duckduckgo.com/?q='

// normalizeAddress decides locally whether the typed text is a URL or a search query and
// returns a loadable URL. It is authoritative — a real address must never bounce to search
// just because a best-effort main-process lookup disagreed.
function normalizeAddress(raw: string): string {
  const s = raw.trim()

  if (!s) return ''

  // Already has an explicit scheme — load as-is (http/https and also about:, file:, etc.).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|file):/i.test(s)) {
    return s
  }

  // localhost (optionally with a port/path) is an address.
  if (s === 'localhost' || /^localhost([:/]|$)/i.test(s)) {
    return `https://${s}`
  }

  // A bare IPv4[:port][/path] is an address.
  if (/^\d{1,3}(\.\d{1,3}){3}([:/]|$)/.test(s)) {
    return `https://${s}`
  }

  // A domain-like token (has a dot, no spaces) with an optional port/path is an address;
  // add the missing scheme. Anything else (e.g. words with spaces) is a search query.
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+([:/?#]|$)/.test(s)) {
    return `https://${s}`
  }

  return `${SEARCH_URL}${encodeURIComponent(s)}`
}

export interface PageState {
  id: string
  url: string
  title: string
  x: number
  y: number
  w: number
  h: number
  // snapped — the window currently fills the browser scene (top snap). Persisted so the
  // layout survives view switches, like the editor's snap state.
  snapped?: boolean
}

export default function BrowserWindow({
  page,
  active,
  api,
  onActivate,
  onClose,
  onChange,
  onNavigate
}: {
  page: PageState
  active: boolean
  api: Api
  onActivate: () => void
  onClose: () => void
  onChange: (next: PageState) => void
  onNavigate: (id: string, url: string, title: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const viewRef = useRef<ElectronWebviewTag | null>(null)
  const [addr, setAddr] = useState(page.url)
  const [macrosOpen, setMacrosOpen] = useState(false)

  // Latest page for the webview event handlers, so a navigation never writes back stale
  // geometry (which previously un-snapped / shrank the window).
  const pageRef = useRef(page)
  pageRef.current = page

  // Sync the address bar when the page navigates externally (link click, macro goto).
  useEffect(() => {
    setAddr(page.url)
  }, [page.url])

  // Wire webview lifecycle events: keep url/title in sync (merged by id upstream).
  useEffect(() => {
    const el = viewRef.current

    if (!el) return

    const onNav = (): void => {
      onNavigate(pageRef.current.id, el.getURL(), el.getTitle())
    }

    const onTitle = (): void => {
      onChange({ ...pageRef.current, title: el.getTitle() })
    }

    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('page-title-updated', onTitle)

    return () => {
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('page-title-updated', onTitle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  const go = useCallback(async (): Promise<void> => {
    const raw = addr.trim()

    if (!raw) return

    // Resolve the target locally — authoritative, so a real address never bounces to search.
    const url = normalizeAddress(raw)
    const el = viewRef.current

    if (el) {
      await el.loadURL(url)
    }

    // Best-effort: let main record history; ignore whatever url it returns.
    api.browserNavigate?.(page.id, url).catch(() => {
      // IPC unavailable — local navigation already happened.
    })

    onNavigate(page.id, url, el ? el.getTitle() : '')
  }, [addr, api, page.id, onNavigate])

  // getScene resolves the browser scene container (the BrowserView Root, position:relative)
  // so the shared Window snaps in the same local coordinate space the page is positioned in.
  const getScene = useCallback((): DOMRect | null => {
    const el = viewRef.current?.closest('[data-browser-scene]') as HTMLElement | null

    return el ? el.getBoundingClientRect() : null
  }, [])

  // getWebview hands MacrosPanel a runner-shaped handle for THIS page.
  const getWebview = (): MacroWebview | null => {
    const el = viewRef.current

    if (!el) return null

    return {
      executeJavaScript: (code: string) => el.executeJavaScript(code),
      getURL: () => el.getURL(),
      loadURL: (url: string) => el.loadURL(url)
    }
  }

  const header = (
    <>
      <TitleBar>
        <Grip />

        <TitleText>{page.title || page.url || t('browser.newWindow')}</TitleText>
      </TitleBar>

      {/* The toolbar is not a drag region; mousedown stops here so a click never drags. */}
      <Bar onMouseDown={(e) => e.stopPropagation()}>
        <Tooltip title={t('browser.back')}>
          <IconButton size="small" onClick={() => viewRef.current?.goBack()} sx={{ color: '#8b949e' }}>
            <ArrowBackIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('browser.forward')}>
          <IconButton size="small" onClick={() => viewRef.current?.goForward()} sx={{ color: '#8b949e' }}>
            <ArrowForwardIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('browser.reload')}>
          <IconButton size="small" onClick={() => viewRef.current?.reload()} sx={{ color: '#8b949e' }}>
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>

        <Address
          value={addr}
          placeholder={t('browser.address')}
          spellCheck={false}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              go()
            }
          }}
        />

        <Tooltip title={t('browser.macros')}>
          <IconButton
            size="small"
            onClick={() => setMacrosOpen((v) => !v)}
            sx={{ color: macrosOpen ? colors.controller : '#8b949e' }}
          >
            <AutoFixHighIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common.close')}>
          <IconButton size="small" onClick={onClose} sx={{ color: '#8b949e' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {macrosOpen && <MacrosPanel api={api} getWebview={getWebview} onClose={() => setMacrosOpen(false)} />}
      </Bar>
    </>
  )

  return (
    <Window
      x={page.x}
      y={page.y}
      w={page.w}
      h={page.h}
      snapped={!!page.snapped}
      coordinate="absolute"
      active={active}
      minWidth={420}
      minHeight={300}
      zIndex={active ? 20 : 10}
      getScene={getScene}
      onActivate={onActivate}
      onChange={(g: WindowGeom) => onChange({ ...page, ...g })}
      onSnappedChange={(snapped) => onChange({ ...page, snapped })}
      header={header}
      style={{ background: '#fff' }}
    >
      <PageWrap>
        <webview
          ref={viewRef as unknown as React.Ref<HTMLElement>}
          src={page.url}
          partition="persist:aiarch-browser"
          allowpopups
        />
      </PageWrap>
    </Window>
  )
}
