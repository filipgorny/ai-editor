import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircularProgress } from '@mui/material'
import styled from 'styled-components'
import { colors } from '../styles/tokens'

const Bar = styled.div`
  position: relative;
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid ${colors.border};
  background: ${colors.panel};
`

// Komiksowy dymek z odpowiedzią AI — po prawej, nad przyciskiem, żółto-pomarańczowy.
const Bubble = styled.div`
  position: absolute;
  right: 14px;
  bottom: calc(100% + 12px);
  max-width: 560px;
  max-height: 320px;
  overflow: auto;
  background: #f2cc60;
  color: #1a1200;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid #d29922;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  z-index: 5;

  &::after {
    content: '';
    position: absolute;
    right: 40px;
    bottom: -10px;
    border: 10px solid transparent;
    border-top-color: #f2cc60;
    border-bottom: 0;
  }
`

const Input = styled.textarea`
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  color: #e6edf3;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.4;
  resize: vertical;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

// AgentBar — pole AI w głównym widoku. Agent (przez gateway → ai/filer) potrafi
// dodawać + wypełniać pliki, usuwać, zmieniać nazwy i przenosić pliki oraz foldery.
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

  // dymek znika sam po 5 s (albo po kliknięciu)
  useEffect(() => {
    if (!reply) {
      return
    }

    const t = window.setTimeout(() => onClearReply?.(), 5000)

    return () => window.clearTimeout(t)
  }, [reply, onClearReply])

  const send = () => {
    if (prompt.trim() && !busy) {
      onSubmit(prompt.trim())
      setPrompt('')
    }
  }

  return (
    <Bar>
      {reply ? (
        <Bubble onClick={() => onClearReply?.()} title={t('agent.closeHint')}>
          {reply}
        </Bubble>
      ) : null}
      <Input
        rows={2}
        className={busy ? 'ai-thinking' : undefined}
        style={{ ['--ai-accent' as string]: colors.controller }}
        placeholder={t('agent.placeholderMain')}
        value={prompt}
        disabled={busy}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <Button variant="contained" onClick={send} disabled={busy} sx={{ minWidth: 96 }}>
        {busy ? <CircularProgress size={16} color="inherit" /> : t('agent.send')}
      </Button>
    </Bar>
  )
}
