import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  TextField,
  Alert,
  CircularProgress
} from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { toast } from '@/toast'

// ClaudeLoginDialog — shown when the "Claude (headless)" provider is selected but the server
// has no Claude OAuth token. "Generate token" opens a terminal running `claude setup-token`
// (browser OAuth); the user pastes the printed `sk-ant-oat…` token here and it's sent to the
// ai service (over the gateway), which stores it and uses it for every `claude -p` call.
export default function ClaudeLoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [hasToken, setHasToken] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  const check = async (): Promise<void> => {
    const ok = await window.api.claudeTokenStatus().catch(() => false)

    setHasToken(ok)
  }

  useEffect(() => {
    if (open) {
      setToken('')
      setHasToken(null)
      check()
    }
  }, [open])

  const generate = async (): Promise<void> => {
    await window.api.claudeSetupToken().catch(() => false)
  }

  const save = async (): Promise<void> => {
    const tok = token.trim()

    if (!tok) {
      return
    }

    setSaving(true)

    const ok = await window.api.claudeSaveToken(tok).catch(() => false)

    setSaving(false)

    if (ok) {
      setToken('')
      toast.success(t('claudeLogin.saved'))
      onClose() // zapisany → zamknij okno
    } else {
      toast.error(t('claudeLogin.saveFailed'))
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('claudeLogin.title')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2">{t('claudeLogin.body')}</Typography>

        <Button
          variant="outlined"
          startIcon={<OpenInNewIcon fontSize="small" />}
          onClick={generate}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('claudeLogin.generate')}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {t('claudeLogin.generateHint')}
        </Typography>

        <TextField
          label={t('claudeLogin.tokenLabel')}
          placeholder={t('claudeLogin.tokenPlaceholder')}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          autoComplete="off"
          fullWidth
          size="small"
          sx={{ mt: 0.5 }}
        />

        {hasToken === true ? (
          <Alert severity="info">{t('claudeLogin.has')}</Alert>
        ) : hasToken === false ? (
          <Alert severity="warning">{t('claudeLogin.none')}</Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || !token.trim()}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {t('claudeLogin.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
