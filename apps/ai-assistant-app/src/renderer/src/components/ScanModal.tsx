import { Dialog, LinearProgress } from '@mui/material'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ScanProgress } from '../model'
import { colors } from '../styles/tokens'

const Title = styled.h3`
  font-family: monospace;
  margin: 16px 20px 8px;
`

const Body = styled.div`
  padding: 8px 20px 20px;
`

const Label = styled.div`
  color: ${colors.muted};
  font-size: 13px;
  margin-bottom: 4px;
`

const CurrentFile = styled.div`
  font-family: monospace;
  min-height: 24px;
  word-break: break-all;
`

const Counters = styled.div`
  display: flex;
  gap: 8px;
  margin: 12px 0;
`

const Counter = styled.span`
  background: ${colors.border};
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
  color: ${colors.muted};
`

const Log = styled.div`
  margin-top: 8px;
  padding: 8px;
  height: 160px;
  overflow-y: auto;
  background: ${colors.bg};
  border-radius: 8px;
  font-family: monospace;
  font-size: 12px;
  color: ${colors.muted};
`

const ErrorText = styled.div`
  margin-top: 8px;
  color: ${colors.danger};
`

// ScanModal: modal podczas skanowania — progress bar + aktualnie czytany plik,
// liczniki i log na żywo.
export default function ScanModal({
  open,
  progress,
  log,
  error
}: {
  open: boolean
  progress: ScanProgress
  log: string[]
  error: string
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: colors.panel, backgroundImage: 'none' } }}>
      <Title>{t('scan.title')}</Title>
      <Body>
        <LinearProgress color={error ? 'error' : 'primary'} sx={{ mb: 2, borderRadius: 1 }} />

        <Label>{t('scan.reading')}</Label>
        <CurrentFile>{progress.currentFile || '—'}</CurrentFile>

        <Counters>
          <Counter>{t('scan.files')} {progress.filesDone}</Counter>
          <Counter>{t('scan.entities')} {progress.entitiesDone}</Counter>
        </Counters>

        <Log>
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </Log>

        {error ? <ErrorText>{error}</ErrorText> : null}
      </Body>
    </Dialog>
  )
}
