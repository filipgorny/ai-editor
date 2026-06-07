// Telescope — a fuzzy file + content finder overlay (opened by the Esc+Space chord).
// Layout mirrors neovim's telescope.nvim: a TALL results rectangle on top and a LARGE
// input at the bottom. As the user types we grep BOTH filenames AND file contents via
// window.api.telescopeFind. Each row shows a file-type icon, the path, and (for content
// matches) a preview line. Arrow keys move the selection; Enter opens the file.
//
// Self-contained per the view contract: this file imports only React, MUI, i18n, the
// shared bus (for the Esc+Space chord) and reaches the backend through window.api. It does
// NOT import App.tsx, the registry, or sibling views. The integration phase mounts a single
// <Telescope/> at app root and feeds it `open`/`onClose` + an `openFile` callback (it can
// reuse the exported `useTelescopeChord` hook to flip `open` on the Esc+Space chord).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircularProgress } from '@mui/material'
import styled from 'styled-components'
import CodeIcon from '@mui/icons-material/Code'
import JavascriptIcon from '@mui/icons-material/Javascript'
import HtmlIcon from '@mui/icons-material/Html'
import CssIcon from '@mui/icons-material/Css'
import DataObjectIcon from '@mui/icons-material/DataObject'
import DescriptionIcon from '@mui/icons-material/Description'
import ArticleIcon from '@mui/icons-material/Article'
import ImageIcon from '@mui/icons-material/Image'
import TerminalIcon from '@mui/icons-material/Terminal'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import { colors, kindColor } from '@/styles/tokens'
import { appBus } from '@/events/bus'

// ── file-type icon mapping ──────────────────────────────────────────────────────────────
// A small, dependency-free stand-in for nerd-font file icons: map an extension to a MUI
// icon + a tint color (reusing kindColor so it matches the rest of the app).
type IconSpec = { Icon: typeof CodeIcon; color: string }

function iconForPath(p: string): IconSpec {
  const ext = (p.split('.').pop() || '').toLowerCase()

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { Icon: JavascriptIcon, color: '#f1e05a' }

    case 'go':
    case 'rs':
    case 'py':
    case 'rb':
    case 'java':
    case 'php':
    case 'c':
    case 'h':
    case 'cpp':
    case 'cs':
      return { Icon: CodeIcon, color: kindColor.function }

    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return { Icon: DataObjectIcon, color: kindColor.app }

    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return { Icon: HtmlIcon, color: '#e34c26' }

    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return { Icon: CssIcon, color: kindColor.controller }

    case 'md':
    case 'mdx':
    case 'txt':
      return { Icon: ArticleIcon, color: colors.muted }

    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return { Icon: ImageIcon, color: kindColor.component }

    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return { Icon: TerminalIcon, color: kindColor.service }

    case 'lua':
      return { Icon: CodeIcon, color: kindColor.module }

    default:
      return { Icon: ext ? DescriptionIcon : InsertDriveFileIcon, color: colors.muted }
  }
}

// ── styled chrome ───────────────────────────────────────────────────────────────────────
// Backdrop sits above editor windows / dialogs (ScriptsDialog is z:1400) so the finder
// always wins focus. Clicking the dimmed area closes it.
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  width: min(820px, 92vw);
  height: min(70vh, 720px);
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.7);
`

// Results rectangle — the TALL list on top.
const Results = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
`

const Row = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  background: ${(p) => (p.$active ? 'rgba(88, 166, 255, 0.16)' : 'transparent')};
  box-shadow: ${(p) => (p.$active ? `inset 2px 0 0 ${colors.controller}` : 'none')};

  &:hover {
    background: ${(p) => (p.$active ? 'rgba(88, 166, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)')};
  }
`

const RowIcon = styled.span`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
`

const RowText = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
`

const PathLine = styled.div`
  font-family: Hack, monospace;
  font-size: 13px;
  color: #e6edf3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl; /* keep the filename visible when the path overflows */
  text-align: left;
`

const PreviewLine = styled.div`
  font-family: Hack, monospace;
  font-size: 12px;
  color: ${colors.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const LineNo = styled.span`
  flex: 0 0 auto;
  font-family: Hack, monospace;
  font-size: 11px;
  color: ${colors.muted};
  opacity: 0.8;
`

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: ${colors.muted};
  font-size: 14px;
`

// Input — the LARGE box at the bottom.
const InputBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid ${colors.border};
  padding: 0 14px;
`

const Prompt = styled.span`
  font-family: Hack, monospace;
  font-size: 18px;
  color: ${colors.controller};
`

const Input = styled.input`
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-family: Hack, monospace;
  font-size: 18px;
  padding: 16px 0;

  &::placeholder {
    color: ${colors.muted};
  }
`

const Count = styled.span`
  font-family: Hack, monospace;
  font-size: 12px;
  color: ${colors.muted};
  flex: 0 0 auto;
`

// baseName extracts the last path segment for display emphasis.
function baseName(p: string): string {
  const parts = p.split(/[\\/]/)

  return parts[parts.length - 1] || p
}

export interface TelescopeProps {
  open: boolean
  onClose: () => void
  // Absolute project root passed to telescopeFind (ctx.folder). '' = whole cwd fallback.
  root?: string
  // Opens the chosen file in the editor and switches to the editor view. The integration
  // phase passes ctx.openFile (it may also switch view / emit telescope:pick afterwards).
  onOpenFile: (absPath: string, line?: number) => void
  // Max rows requested from the backend (defaults to 80).
  limit?: number
}

// Telescope — the overlay component. Render it always at app root; it returns null while
// closed so it costs nothing. Opening focuses the input and resets the query.
export default function Telescope({ open, onClose, root, onOpenFile, limit = 80 }: TelescopeProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TelescopeHit[]>([])
  const [sel, setSel] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0) // guards against out-of-order async responses

  // On open: reset state and focus the input.
  useEffect(() => {
    if (!open) {
      return
    }

    setQuery('')
    setHits([])
    setSel(0)
    setLoading(false)
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)

    return () => window.clearTimeout(id)
  }, [open])

  // Debounced search whenever the query changes (filename + content grep via the backend).
  useEffect(() => {
    if (!open) {
      return
    }

    const q = query.trim()

    if (!q) {
      setHits([])
      setSel(0)
      setLoading(false)

      return
    }

    setLoading(true)
    const mine = ++reqId.current

    const handle = window.setTimeout(() => {
      window.api
        .telescopeFind(q, { root, limit, content: true })
        .then((res) => {
          if (mine !== reqId.current) {
            return
          }

          setHits(res)
          setSel(0)
          setLoading(false)
        })
        .catch(() => {
          if (mine !== reqId.current) {
            return
          }

          setHits([])
          setLoading(false)
        })
    }, 140)

    return () => window.clearTimeout(handle)
  }, [query, open, root, limit])

  // Keep the active row scrolled into view as the selection moves.
  useEffect(() => {
    const list = listRef.current

    if (!list) {
      return
    }

    const node = list.querySelector<HTMLElement>(`[data-idx="${sel}"]`)

    node?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = useCallback(
    (h: TelescopeHit | undefined) => {
      if (!h) {
        return
      }

      onOpenFile(h.absPath, h.line)
      onClose()
    },
    [onOpenFile, onClose]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        e.preventDefault()
        setSel((s) => (hits.length ? (s + 1) % hits.length : 0))

        return
      }

      if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault()
        setSel((s) => (hits.length ? (s - 1 + hits.length) % hits.length : 0))

        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        choose(hits[sel])

        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [hits, sel, choose, onClose]
  )

  const showEmpty = useMemo(
    () => !loading && query.trim().length > 0 && hits.length === 0,
    [loading, query, hits.length]
  )

  if (!open) {
    return null
  }

  return (
    <Backdrop onMouseDown={onClose}>
      <Panel onMouseDown={(e) => e.stopPropagation()}>
        <Results ref={listRef}>
          {showEmpty && <Empty>{t('telescope.noResults')}</Empty>}

          {!query.trim() && !loading && <Empty>{t('telescope.placeholder')}</Empty>}

          {hits.map((h, i) => {
            const spec = iconForPath(h.path)

            return (
              <Row
                key={`${h.absPath}:${h.line ?? ''}:${i}`}
                data-idx={i}
                $active={i === sel}
                onMouseMove={() => setSel(i)}
                onClick={() => choose(h)}
              >
                <RowIcon>
                  <spec.Icon style={{ color: spec.color, fontSize: 18 }} />
                </RowIcon>
                <RowText>
                  <PathLine title={h.path}>
                    {/* bdi keeps the rtl-trimmed path readable left-to-right per segment */}
                    <bdi>{h.path}</bdi>
                  </PathLine>

                  {h.kind === 'content' && h.preview && (
                    <PreviewLine title={h.preview}>
                      {h.line ? <LineNo>{h.line}: </LineNo> : null}
                      {h.preview.trim()}
                    </PreviewLine>
                  )}

                  {h.kind === 'name' && <PreviewLine>{baseName(h.path)}</PreviewLine>}
                </RowText>
              </Row>
            )
          })}
        </Results>

        <InputBar>
          <Prompt>{'>'}</Prompt>
          <Input
            ref={inputRef}
            value={query}
            placeholder={t('telescope.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />

          {loading ? (
            <CircularProgress size={16} sx={{ color: colors.muted }} />
          ) : (
            <Count>{hits.length || ''}</Count>
          )}
        </InputBar>
      </Panel>
    </Backdrop>
  )
}

// ── Esc+Space chord hook ────────────────────────────────────────────────────────────────
// useTelescopeChord wires the two-key chord (Escape THEN Space, within a short window) over
// the renderer key bus and invokes `onTrigger`. The integration phase can call this to flip
// the Telescope's `open` state without editing keys.ts. It is intentionally tiny and
// self-contained so it can also be used directly from App.tsx.
//
//   const [open, setOpen] = useState(false)
//   useTelescopeChord(() => setOpen(true))
//   <Telescope open={open} onClose={() => setOpen(false)} onOpenFile={...} />
//
// The chord arms on a plain Escape (no modifiers) and fires if Space follows within
// `windowMs`. While disarmed it never interferes with a normal Escape (which the bound Lua
// script uses to focus the AI area).
export function useTelescopeChord(onTrigger: () => void, windowMs = 600): void {
  useEffect(() => {
    let armedUntil = 0

    const off = appBus.on('key', (k) => {
      const now = Date.now()

      if (k.combo === 'escape') {
        armedUntil = now + windowMs

        return
      }

      if (k.combo === 'space' && now <= armedUntil) {
        armedUntil = 0
        onTrigger()

        return
      }

      // Any other key cancels a pending chord.
      armedUntil = 0
    })

    return off
  }, [onTrigger, windowMs])
}
