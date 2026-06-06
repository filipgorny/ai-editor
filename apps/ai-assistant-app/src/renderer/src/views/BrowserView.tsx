// BrowserView — the web-browser view (ViewKey 'browser').
//
// Hosts one or more floating page windows (BrowserWindow), each an Electron <webview> with
// its own address bar and a macros button. Macros are Lua programs (stored via the scripts
// service under the '__browser__' project) translated to webview actions by macroRunner —
// e.g.  type('#email','a@b.com'); type('#password','test'); click('#submit').
//
// keepMounted=true in the registry: the view stays mounted (display:none when inactive) so
// open pages survive view switches, like editors and the terminal. This file imports ONLY
// the view contract (./types), MUI/styled, and its own ./browser/* helpers — never App or
// the registry — so the integration phase can register it by importing the default export.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import PublicIcon from '@mui/icons-material/Public'
import styled from 'styled-components'
import type { ViewContext, ViewDefinition } from './types'
import { colors } from '../styles/tokens'
import BrowserWindow, { type PageState } from './browser/BrowserWindow'

const Root = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0a0d12;
`

const Toolbar = styled.div`
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: ${colors.panel};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
`

const Empty = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: ${colors.muted};
  text-align: center;
`

const NewBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid ${colors.border};
  background: ${colors.panel};
  color: #e6edf3;
  font-size: 14px;
  cursor: pointer;

  &:hover {
    border-color: ${colors.controller};
  }
`

const HOME_URL = 'https://duckduckgo.com'

// sameOrigin reduces a URL to its origin so repeated "open" requests for the same dev server
// re-use one window instead of stacking new ones. Falls back to the raw string when unparsable.
function sameOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

let pageSeq = 0

function makePage(url: string, offset: number): PageState {
  pageSeq += 1

  return {
    id: `page-${pageSeq}`,
    url,
    title: '',
    x: 60 + offset * 28,
    y: 60 + offset * 28,
    w: 900,
    h: 600
  }
}

export default function BrowserView({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()
  const [pages, setPages] = useState<PageState[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const enabledRef = useRef(false)

  // Enable the <webview> tag the first time the view becomes active (main gates the
  // partition/webTag allowance behind browserSetEnabled). Idempotent — only flips once.
  useEffect(() => {
    if (ctx.active && !enabledRef.current) {
      enabledRef.current = true

      ctx.api.browserSetEnabled(true).catch(() => {
        // main may report disabled; pages still render but navigation may be limited
      })
    }
  }, [ctx.active, ctx.api])

  const addPage = useCallback((): void => {
    setPages((prev) => {
      const p = makePage(HOME_URL, prev.length)

      setActiveId(p.id)

      return [...prev, p]
    })
  }, [])

  const closePage = useCallback((id: string): void => {
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== id)

      setActiveId((cur) => (cur === id ? next[next.length - 1]?.id ?? '' : cur))

      return next
    })
  }, [])

  const changePage = useCallback((next: PageState): void => {
    setPages((prev) => prev.map((p) => (p.id === next.id ? next : p)))
  }, [])

  // Update url/title after a navigation and notify any address-bar/topbar listeners.
  const handleNavigate = useCallback(
    (id: string, url: string, title: string): void => {
      setPages((prev) => prev.map((p) => (p.id === id ? { ...p, url, title: title || p.title } : p)))

      // browser:navigate is part of the shared bus catalog but not yet in the typed
      // AppEventMap (integration phase adds it); emit through a loose cast so this view
      // compiles independently. Mirrors how the foundation emits its new events.
      ;(ctx.bus.emit as (name: string, payload: unknown) => void)('browser:navigate', { id, url })
    },
    [ctx.bus]
  )

  // openUrl opens (or re-focuses) a page at url — driven by the 'browser:open' bus event
  // (e.g. the code diagram's Run button after a React dev server boots). A page already on the
  // same origin is reused so repeated runs don't stack windows.
  const openUrl = useCallback(
    (url: string): void => {
      if (!url) {
        return
      }

      enabledRef.current = true
      ctx.api.browserSetEnabled(true).catch(() => undefined)

      setPages((prev) => {
        const existing = prev.find((p) => sameOrigin(p.url) === sameOrigin(url))

        if (existing) {
          setActiveId(existing.id)

          return prev.map((p) => (p.id === existing.id ? { ...p, url } : p))
        }

        const p = makePage(url, prev.length)
        setActiveId(p.id)

        return [...prev, p]
      })
    },
    [ctx.api]
  )

  // Subscribe for the whole view lifetime (keepMounted) so a page opens even while the browser
  // view is in the background — the diagram switches to it right after emitting.
  useEffect(() => {
    return ctx.bus.on('browser:open', (p: { url: string }) => openUrl(p.url))
  }, [ctx.bus, openUrl])

  const hasPages = pages.length > 0

  return (
    <Root data-browser-scene>
      {hasPages && (
        <Toolbar>
          <Tooltip title={t('browser.newWindow')}>
            <IconButton size="small" onClick={addPage} sx={{ color: '#8b949e' }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      )}

      {pages.map((p) => (
        <BrowserWindow
          key={p.id}
          page={p}
          active={p.id === activeId}
          api={ctx.api}
          onActivate={() => setActiveId(p.id)}
          onClose={() => closePage(p.id)}
          onChange={changePage}
          onNavigate={handleNavigate}
        />
      ))}

      {!hasPages && (
        <Empty>
          <PublicIcon sx={{ fontSize: 48, opacity: 0.5 }} />

          <NewBtn onClick={addPage}>
            <AddIcon fontSize="small" />
            {t('browser.newWindow')}
          </NewBtn>
        </Empty>
      )}
    </Root>
  )
}

// browserView — the registry entry the integration phase imports and appends to VIEWS.
// keepMounted so open pages and macro state survive view switches.
export const browserView: ViewDefinition = {
  key: 'browser',
  titleKey: 'views.browser',
  Icon: PublicIcon,
  Component: BrowserView,
  keepMounted: true
}
