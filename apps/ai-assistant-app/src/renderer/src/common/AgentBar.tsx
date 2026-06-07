import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { colors } from '@/styles/tokens'
import { appBus } from '@/events'
import { isVimCommand, runVimCommand } from '@/common/editor/vimCommand'

// Field — wrapper pola, by warstwy podpowiedzi (Hint) ułożyć względem textarei.
const Field = styled.div`
  position: relative;
  flex: 1;
  display: flex;
  border-radius: 10px;
`

const Bar = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid ${colors.border};
  background: ${colors.panel};
`

// popIn — the comic bubble's quick entrance.
const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
`

// COMIC_BG / COMIC_FG — the comic palette, shared with the chat-history assistant bubbles.
const COMIC_BG = '#ffc24a'
const COMIC_BORDER = '#4a3300'

// ComicBubble — when the AI answers while the user is NOT on the chat screen, the reply is
// shown as a solid yellow-orange comic speech balloon attached above the input: full field
// width minus 20% (so 80%, left-aligned), dark text, a drop shadow, and a little tail near
// the left pointing down at the input. Click → dismiss + jump to the chat view. Auto-hides
// 10s. Scrolling lives on the inner BubbleText so the tail (a pseudo-element below the box)
// is never clipped.
const ComicBubble = styled.div`
  position: absolute;
  left: 12px;
  width: calc(80% - 24px);
  bottom: calc(100% + 14px);
  z-index: 60;
  background: ${COMIC_BG};
  border: 2px solid ${COMIC_BORDER};
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  animation: ${popIn} 140ms ease-out;

  /* Comic tail: a triangle near the left edge, pointing down to the input. The darker
     ::before is the outline; the ::after is the fill sitting just on top of it. */
  &::before {
    content: '';
    position: absolute;
    left: 24px;
    top: 100%;
    border: 13px solid transparent;
    border-top-color: ${COMIC_BORDER};
  }

  &::after {
    content: '';
    position: absolute;
    left: 27px;
    top: calc(100% - 3px);
    border: 10px solid transparent;
    border-top-color: ${COMIC_BG};
  }
`

// BubbleText — the scrollable content area inside the bubble (taller min-height; bold, dark
// text for legibility).
const BubbleText = styled.div`
  padding: 16px 18px;
  min-height: 72px;
  max-height: 42vh;
  overflow-y: auto;
  border-radius: 12px;
  color: #1a1205;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`

// flow — slides a multi-colour gradient sideways; drives the "thinking" glow on the input.
const flow = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
`

// pulse — gently breathes the glow's strength so it feels alive, not static.
const pulse = keyframes`
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.95; }
`

// BusyGlow — a soft animated rainbow halo behind the input, shown only while the agent is
// working. It sits just outside the textarea (inset: -3px) and is blurred, so it reads as a
// living colourful aura around the field instead of a status line of text.
const BusyGlow = styled.div`
  position: absolute;
  inset: -3px;
  border-radius: 12px;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(90deg, #ff6ec4, #7873f5, #4adede, #ffd86b, #ff6ec4);
  background-size: 200% 100%;
  filter: blur(8px);
  animation:
    ${flow} 2.2s linear infinite,
    ${pulse} 1.6s ease-in-out infinite;
`

// sweep — slides a colourful band across the inside of the field, left → right.
const sweep = keyframes`
  0% { transform: translateX(-120%); }
  100% { transform: translateX(120%); }
`

// BusyInner — an animation INSIDE the input while the agent works: a soft colourful band
// sweeps across the field interior. It sits above the textarea but is pointer-events:none and
// translucent, so it never blocks typing or hides text. Clipped to the input's rounded box.
const BusyInner = styled.div`
  position: absolute;
  inset: 1px;
  z-index: 2;
  border-radius: 9px;
  overflow: hidden;
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 55%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 110, 196, 0.18),
      rgba(120, 115, 245, 0.32),
      rgba(74, 222, 222, 0.28),
      transparent
    );
    filter: blur(6px);
    animation: ${sweep} 1.8s ease-in-out infinite;
  }
`

// Hint — small status line under the field. Shows the vim command-line affordance while
// the user is typing a ':' command, and the short result after one runs.
const Hint = styled.div<{ $error?: boolean }>`
  position: absolute;
  left: 14px;
  bottom: -2px;
  transform: translateY(100%);
  font-size: 12px;
  font-family: 'Hack', monospace;
  pointer-events: none;
  color: ${(p) => (p.$error ? '#f85149' : 'color-mix(in srgb, var(--accent, #58a6ff) 80%, #c9d1d9)')};
`

const Input = styled.textarea<{ $busy?: boolean; $reply?: boolean; $vim?: boolean }>`
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 14px 18px;
  border-radius: 10px;
  border: 1px solid ${(p) => (p.$vim ? 'var(--accent, #58a6ff)' : '#30363d')};
  background: ${(p) => (p.$busy ? 'color-mix(in srgb, var(--accent, #58a6ff) 8%, #1c2333)' : '#1c2333')};
  color: ${(p) => (p.$reply ? '#f2cc60' : '#ffffff')};
  font-size: 17px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.45;
  resize: vertical;
  outline: none;
  cursor: ${(p) => (p.$reply ? 'pointer' : 'text')};

  &::placeholder {
    color: #c9d1d9;
    opacity: 1;
  }

  &:focus {
    border-color: ${colors.controller};
    background: #20283a;
  }

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--accent, #58a6ff) 55%, transparent);
    border-radius: 8px;
  }
`

// Session prompt history (newest last) — recalled with Up/Down in the field, jak w shellu.
const promptHistory: string[] = []

// AgentBar — pole AI w głównym widoku. The input is ALWAYS an editable prompt — the reply
// is never shown inside it. When the user is off the chat screen (asBubble), the answer
// appears as a comic speech bubble above the field; on the chat screen it lives only in the
// messages list (so nothing is shown here).
export default function AgentBar({
  onSubmit,
  busy,
  reply,
  onClearReply,
  asBubble = false,
  onOpenChat
}: {
  onSubmit: (p: string) => void
  busy: boolean
  reply?: string
  onClearReply?: () => void
  // asBubble — show the reply as the comic bubble (true when NOT on the chat/messages view).
  asBubble?: boolean
  // onOpenChat — navigate to the chat/messages view (used when the bubble is clicked).
  onOpenChat?: () => void
}) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The comic bubble shows only off the chat screen; on the chat screen the reply is in the list.
  const showingBubble = asBubble && !!reply
  // Brief status surfaced under the field after a vim ':' command runs (i18n key + vars).
  const [status, setStatus] = useState<{ key: string; vars?: Record<string, string | number>; error: boolean } | null>(null)
  // True while the current draft is a vim/ex command line (starts with ':').
  const vimMode = isVimCommand(prompt)
  // -1 = bieżący szkic; inaczej indeks w promptHistory. draftRef trzyma szkic
  // sprzed wejścia w historię, by Strzałka w dół mogła go przywrócić.
  const [histIdx, setHistIdx] = useState(-1)
  const draftRef = useRef('')

  // Strzałka w górę: starszy prompt; w dół: nowszy (na końcu — wraca do szkicu).
  const recallOlder = () => {
    if (!promptHistory.length) {
      return
    }

    if (histIdx === -1) {
      draftRef.current = prompt
      const i = promptHistory.length - 1
      setHistIdx(i)
      setPrompt(promptHistory[i])
    } else if (histIdx > 0) {
      const i = histIdx - 1
      setHistIdx(i)
      setPrompt(promptHistory[i])
    }
  }

  const recallNewer = () => {
    if (histIdx === -1) {
      return
    }

    if (histIdx >= promptHistory.length - 1) {
      setHistIdx(-1)
      setPrompt(draftRef.current)
    } else {
      const i = histIdx + 1
      setHistIdx(i)
      setPrompt(promptHistory[i])
    }
  }

  // The comic bubble auto-dismisses 10s after it appears.
  useEffect(() => {
    if (!showingBubble) {
      return
    }

    const id = window.setTimeout(() => onClearReply?.(), 10000)

    return () => window.clearTimeout(id)
  }, [showingBubble, reply, onClearReply])

  // Escape anywhere routes here: focus the AI input. The bound key script (and other
  // components) emit 'ai:focus' on the bus; we subscribe so focus always lands here.
  useEffect(() => {
    // The event is part of the shared contract; AppEventMap gains it in the integration
    // phase, so subscribe via a cast to stay decoupled from that edit.
    const off = (appBus.on as (name: string, cb: (p: unknown) => void) => () => void)('ai:focus', () => {
      const el = inputRef.current

      if (!el) {
        return
      }

      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })

    return off
  }, [])

  // runVim handles a ':' command line: execute it against the active editor, surface a
  // short status, and never forward it to the LLM.
  const runVim = async (text: string) => {
    setStatus({ key: 'vim.running', error: false })

    const res = await runVimCommand(text)

    if (res.messageKey) {
      setStatus({ key: res.messageKey, vars: res.messageVars, error: !res.ok })
    } else {
      setStatus(null)
    }
  }

  const send = () => {
    const text = prompt.trim()

    if (!text) {
      return
    }

    if (promptHistory[promptHistory.length - 1] !== text) {
      promptHistory.push(text) // zapisz do historii (bez powtórzeń z rzędu)
    }

    setHistIdx(-1)
    draftRef.current = ''

    // Vim/ex command line: handled locally against the active editor, NOT sent to the LLM.
    if (isVimCommand(text)) {
      setPrompt('')
      void runVim(text)

      return
    }

    setStatus(null)
    onClearReply?.() // wyczyść poprzednią odpowiedź zanim przyjdzie nowa
    onSubmit(text)
    setPrompt('')
  }

  // Click the comic bubble: dismiss it and jump to the chat/messages view.
  const onBubbleClick = () => {
    onClearReply?.()
    onOpenChat?.()
  }

  return (
    <Bar>
      {showingBubble && reply && (
        <ComicBubble onClick={onBubbleClick} title={t('agent.closeHint')}>
          <BubbleText>{reply}</BubbleText>
        </ComicBubble>
      )}

      <Field>
      {busy && <BusyGlow aria-hidden />}
      <Input
        ref={inputRef}
        rows={3}
        $busy={busy}
        $vim={vimMode}
        placeholder={busy ? '' : t('agent.placeholderMain')}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value)
          setHistIdx(-1) // ręczna edycja → wyjdź z trybu historii
          setStatus(null) // edycja czyści poprzedni status vim
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()

            return
          }

          // Strzałki przeglądają historię promptów — tylko gdy kursor jest na
          // pierwszym/ostatnim wierszu (by nie psuć edycji wieloliniowej).
          const ta = e.currentTarget
          const atFirstLine = ta.value.slice(0, ta.selectionStart).indexOf('\n') === -1
          const atLastLine = ta.value.slice(ta.selectionEnd).indexOf('\n') === -1

          if (e.key === 'ArrowUp' && atFirstLine) {
            e.preventDefault()
            recallOlder()
          } else if (e.key === 'ArrowDown' && atLastLine) {
            e.preventDefault()
            recallNewer()
          }
        }}
      />
      {busy && <BusyInner aria-hidden />}
      {status && <Hint $error={status.error}>{t(status.key, status.vars)}</Hint>}
      {!status && vimMode && <Hint>{t('aiArea.vimHint')}</Hint>}
      </Field>

    </Bar>
  )
}
