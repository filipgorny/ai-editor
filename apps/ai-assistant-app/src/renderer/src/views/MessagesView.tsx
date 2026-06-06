// MessagesView — the LLM messages log (ViewKey 'messages').
//
// A chronological chat log of everything that flows to/from the LLM. The view is a pure
// observer: it owns no AI state of its own, it just subscribes to the streams App already
// drives and mirrors them into a scrollback:
//   - appBus 'agent:start'   → an OUTGOING (user) bubble        (darker background)
//   - appBus 'agent:success' → an INCOMING (assistant) bubble   (lighter background)
//   - appBus 'agent:error'   → an INCOMING (assistant) error bubble
//   - api.onAiEvent 'tool'   → when the agent reads/writes a file we surface the code it
//                              is working on in a monospace "vibe coding" block.
//   - api.onAiEvent 'answer' → mirrors the final assistant text (covers the streaming
//                              aiAsk path which also resolves through 'agent:success').
//
// Fenced code blocks (```lang ... ```) inside an assistant message are split out and
// rendered as distinct monospace areas so vibe-coded snippets read clearly.
//
// This file follows the view contract: it imports ONLY ./types, and reaches the bus/api
// through ctx — never App, the registry, or sibling views.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import type { ViewContext } from './types'
import { colors } from '../styles/tokens'

// Role of a logged message — who authored it.
type Role = 'user' | 'assistant'

// Segment — a message body is split into plain-text and code segments so code renders
// in its own monospace "vibe coding" block.
type Segment = { kind: 'text'; text: string } | { kind: 'code'; lang: string; code: string }

// LogMessage — one entry in the scrollback.
type LogMessage = {
  id: number
  role: Role
  ts: number
  segments: Segment[]
  error?: boolean
}

// Cap the scrollback so a long session doesn't grow unbounded in memory.
const MAX_MESSAGES = 400

// FENCE matches a ```optional-lang\n...\n``` block; the lang capture may be empty.
const FENCE = /```([\w+-]*)\n?([\s\S]*?)```/g

// splitSegments turns a raw markdown-ish reply into ordered text/code segments. Inline
// code (single backticks) is left in the text segments untouched — only fenced blocks
// become dedicated code areas.
function splitSegments(raw: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null

  FENCE.lastIndex = 0

  while ((m = FENCE.exec(raw)) !== null) {
    const before = raw.slice(last, m.index)

    if (before.trim()) {
      out.push({ kind: 'text', text: before.trim() })
    }

    out.push({ kind: 'code', lang: m[1] || '', code: m[2].replace(/\n$/, '') })
    last = FENCE.lastIndex
  }

  const tail = raw.slice(last)

  if (tail.trim()) {
    out.push({ kind: 'text', text: tail.trim() })
  }

  // A reply with no text at all (e.g. empty) still gets a single empty text segment so
  // the bubble has something to render.
  if (out.length === 0) {
    out.push({ kind: 'text', text: raw })
  }

  return out
}

const Wrap = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${colors.bg};
`

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  &::-webkit-scrollbar {
    width: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${colors.border};
    border-radius: 6px;
  }
`

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.muted};
  font-size: 14px;
`

// Row stacks the meta + bubble; BOTH user and assistant messages align to the left and
// span the full container width (no right-aligned, narrow user bubbles).
const Row = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
`

const Bubble = styled.div<{ $role: Role; $error?: boolean }>`
  width: 100%;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid ${colors.border};
  /* Incoming (assistant) bubbles get a LIGHTER background; outgoing (user) a darker one. */
  background: ${(p) => (p.$role === 'assistant' ? '#1d2530' : '#11161d')};
  color: ${(p) => (p.$error ? colors.danger : '#e6edf3')};
`

const Meta = styled.div`
  font-size: 11px;
  color: ${colors.muted};
  margin: 0 4px 4px;
  display: flex;
  gap: 8px;
  align-items: baseline;
`

const Author = styled.span<{ $role: Role }>`
  font-weight: 600;
  color: ${(p) => (p.$role === 'user' ? colors.controller : colors.service)};
`

// CodeArea — the "vibe coding" block: monospace, distinct background, with a small lang
// caption above the code.
const CodeArea = styled.div`
  margin: 8px 0 2px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid ${colors.border};
  background: #0a0d12;
`

const CodeCaption = styled.div`
  font-family: 'Hack', monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${colors.muted};
  padding: 4px 10px;
  background: #0d1117;
  border-bottom: 1px solid ${colors.border};
`

const CodePre = styled.pre`
  margin: 0;
  padding: 10px 12px;
  font-family: 'Hack', monospace;
  font-size: 12.5px;
  line-height: 1.5;
  color: #c9d1d9;
  overflow-x: auto;
  white-space: pre;
`

const TextSeg = styled.div`
  & + & {
    margin-top: 6px;
  }
`

export default function MessagesView({ ctx }: { ctx: ViewContext }): React.JSX.Element {
  const { t } = useTranslation()
  const { bus, api, navKey } = ctx

  const [messages, setMessages] = useState<LogMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)

  // append pushes a new message and trims the scrollback to MAX_MESSAGES.
  const append = (role: Role, raw: string, error?: boolean): void => {
    setMessages((prev) => {
      const next: LogMessage = {
        id: ++idRef.current,
        role,
        ts: Date.now(),
        segments: splitSegments(raw),
        error
      }

      const all = [...prev, next]

      return all.length > MAX_MESSAGES ? all.slice(all.length - MAX_MESSAGES) : all
    })
  }

  // Reset the log when the scene changes (new project scan) so it doesn't mix sessions.
  useEffect(() => {
    setMessages([])
  }, [navKey])

  // Subscribe to the agent lifecycle on the bus and to the raw AI event stream. Both
  // streams describe the same turn; we keep them complementary:
  //   agent:start   → user prompt (only place the prompt is exposed)
  //   tool events   → vibe-coding stream (file reads/writes the agent performs)
  //   agent:success → final assistant answer (fired by both aiAsk and aiAgent paths)
  //   agent:error   → assistant error
  // The raw 'answer' event would duplicate agent:success, so we let agent:success own
  // the assistant bubble and use onAiEvent only for the 'tool' vibe-coding stream.
  useEffect(() => {
    const offStart = bus.on('agent:start', (p) => {
      append('user', p.prompt)
    })

    const offSuccess = bus.on('agent:success', (p) => {
      append('assistant', p.message)
    })

    const offError = bus.on('agent:error', (p) => {
      append('assistant', p.message, true)
    })

    const offEvent = api.onAiEvent((ev) => {
      if (ev.type !== 'tool') {
        return
      }

      const tool = ev.tool

      // A tool result that carries file content (read_file / write / create_file) is the
      // code the LLM is working on — surface it as a vibe-coding block. We wrap the result
      // in a fenced block so splitSegments renders it in a monospace area.
      const result = tool.result || ''
      const isCode = /read_file|write|create_file|edit/.test(tool.name) && result.trim().length > 0

      if (!isCode) {
        return
      }

      const lang = guessLang(tool.args)

      append('assistant', '```' + lang + '\n' + result + '\n```')
    })

    return () => {
      offStart()
      offSuccess()
      offError()
      offEvent()
    }
  }, [bus, api])

  // Keep the newest message in view. useLayoutEffect avoids a visible jump.
  useLayoutEffect(() => {
    const el = scrollRef.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  return (
    <Wrap>
      {messages.length === 0 ? (
        <Empty>{t('messages.empty')}</Empty>
      ) : (
        <Scroll ref={scrollRef}>
          {messages.map((m) => (
            <Row key={m.id}>
              <Meta>
                <Author $role={m.role}>
                  {m.role === 'user' ? t('messages.you') : t('messages.assistant')}
                </Author>

                <span>{formatTime(m.ts)}</span>
              </Meta>

              <Bubble $role={m.role} $error={m.error}>
                {m.segments.map((seg, i) =>
                  seg.kind === 'code' ? (
                    <CodeArea key={i}>
                      <CodeCaption>{seg.lang || t('messages.writingCode')}</CodeCaption>

                      <CodePre>{seg.code}</CodePre>
                    </CodeArea>
                  ) : (
                    <TextSeg key={i}>{seg.text}</TextSeg>
                  )
                )}
              </Bubble>
            </Row>
          ))}
        </Scroll>
      )}
    </Wrap>
  )
}

// guessLang derives a fence language hint from a tool's file-path argument (best-effort).
function guessLang(args: string): string {
  const ext = (args.match(/\.([a-z0-9]+)\b/i)?.[1] || '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    go: 'go',
    py: 'py',
    rs: 'rs',
    java: 'java',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'md'
  }

  return map[ext] || ''
}

// formatTime renders a HH:MM:SS timestamp for the message meta row.
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
