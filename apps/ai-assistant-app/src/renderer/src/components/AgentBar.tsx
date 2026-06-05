import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { colors } from '../styles/tokens'

// Animated striped progress — blue stripes flowing to the right inside the AI field
// while it's waiting for a response.
const stripeFlow = keyframes`
  from { background-position: 0 0; }
  to { background-position: 30px 0; }
`

const busyStripes = css`
  background-color: color-mix(in srgb, var(--accent, #58a6ff) 8%, transparent);
  background-image: linear-gradient(
    -45deg,
    color-mix(in srgb, var(--accent, #58a6ff) 30%, transparent) 25%,
    transparent 25%,
    transparent 50%,
    color-mix(in srgb, var(--accent, #58a6ff) 30%, transparent) 50%,
    color-mix(in srgb, var(--accent, #58a6ff) 30%, transparent) 75%,
    transparent 75%,
    transparent
  );
  background-size: 30px 30px;
  animation: ${stripeFlow} 0.6s linear infinite;
`

const Bar = styled.div`
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid ${colors.border};
  background: ${colors.panel};
`

const Input = styled.textarea<{ $busy?: boolean; $reply?: boolean }>`
  flex: 1;
  padding: 14px 18px;
  border-radius: 10px;
  border: 1px solid #30363d;
  background: #1c2333;
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

  ${(p) => p.$busy && busyStripes}
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

  const send = () => {
    const text = prompt.trim()

    if (text) {
      if (promptHistory[promptHistory.length - 1] !== text) {
        promptHistory.push(text) // zapisz do historii (bez powtórzeń z rzędu)
      }

      setHistIdx(-1)
      draftRef.current = ''
      onClearReply?.() // wyczyść poprzednią odpowiedź zanim przyjdzie nowa
      onSubmit(text)
      setPrompt('')
    }
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
      <Input
        ref={inputRef}
        rows={rows}
        $busy={busy}
        $reply={showingReply}
        readOnly={showingReply}
        placeholder={busy ? '' : t('agent.placeholderMain')}
        title={showingReply ? t('agent.closeHint') : undefined}
        value={showingReply ? reply : prompt}
        onMouseDown={showingReply ? () => dismissReply() : undefined}
        onChange={(e) => {
          if (!showingReply) {
            setPrompt(e.target.value)
            setHistIdx(-1) // ręczna edycja → wyjdź z trybu historii
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
    </Bar>
  )
}
