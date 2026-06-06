import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { colors } from '../styles/tokens'
import { appBus } from '../events'
import { isVimCommand, runVimCommand } from './vimCommand'

// Field — wrapper pola, by warstwy podpowiedzi (Hint) ułożyć względem textarei.
const Field = styled.div`
  position: relative;
  flex: 1;
  display: flex;
`

const Bar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid ${colors.border};
  background: ${colors.panel};
`

// Spinner rotation used by the "responding" status row.
const rotate = keyframes`
  to { transform: rotate(360deg); }
`

// StatusRow — sits one line below the field while the agent is busy.
const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
  color: color-mix(in srgb, var(--accent, #58a6ff) 80%, #c9d1d9);
`

// Spinner — small CSS-only spinning circle in the accent color.
const Spinner = styled.span`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent, #58a6ff) 25%, transparent);
  border-top-color: var(--accent, #58a6ff);
  animation: ${rotate} 0.8s linear infinite;
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

// AgentBar — pole AI w głównym widoku. Odpowiedź agenta pojawia się w TYM SAMYM polu
// (na żółto); klik/klawisz czyści ją i wraca do pisania.
export default function AgentBar({
  onSubmit,
  busy,
  reply,
  onClearReply
}: {
  onSubmit: (p: string) => void
  busy: boolean
  reply?: string
  onClearReply?: () => void
}) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const showingReply = !!reply
  // Brief status surfaced under the field after a vim ':' command runs (i18n key + vars).
  const [status, setStatus] = useState<{ key: string; vars?: Record<string, string | number>; error: boolean } | null>(null)
  // True while the current draft is a vim/ex command line (starts with ':').
  const vimMode = !showingReply && isVimCommand(prompt)
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

  // Po pojawieniu się odpowiedzi przewiń pole do jej początku.
  useEffect(() => {
    if (reply && inputRef.current) {
      inputRef.current.scrollTop = 0
    }
  }, [reply])

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

  // Klik / dowolny klawisz przy pokazanej odpowiedzi: wyczyść i wróć do pisania.
  const dismissReply = () => {
    onClearReply?.()
    inputRef.current?.focus()
  }

  // Liczba wierszy: większa, by zmieścić odpowiedź (do 10, potem scroll).
  const rows = showingReply ? Math.min(10, reply.split('\n').length + 1) : 3

  return (
    <Bar>
      <Field>
      <Input
        ref={inputRef}
        rows={rows}
        $busy={busy}
        $reply={showingReply}
        $vim={vimMode}
        readOnly={showingReply}
        placeholder={busy ? '' : t('agent.placeholderMain')}
        title={showingReply ? t('agent.closeHint') : undefined}
        value={showingReply ? reply : prompt}
        onMouseDown={showingReply ? () => dismissReply() : undefined}
        onChange={(e) => {
          if (!showingReply) {
            setPrompt(e.target.value)
            setHistIdx(-1) // ręczna edycja → wyjdź z trybu historii
            setStatus(null) // edycja czyści poprzedni status vim
          }
        }}
        onKeyDown={(e) => {
          if (showingReply) {
            dismissReply()

            return
          }

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
      {!showingReply && status && (
        <Hint $error={status.error}>{t(status.key, status.vars)}</Hint>
      )}
      {busy && !showingReply && (
        <StatusRow>
          <Spinner aria-hidden />
          {t('agent.responding')}
        </StatusRow>
      )}
      {!showingReply && !status && vimMode && <Hint>{t('aiArea.vimHint')}</Hint>}
      </Field>

    </Bar>
  )
}
