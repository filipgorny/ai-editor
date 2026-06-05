import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Button,
  Typography
} from '@mui/material'
import { themeNames } from './themes'
import { changeLanguage, languages } from '../i18n'

export type ModelProvider = 'ollama' | 'claude'

// SettingsDialog — wybór dostawcy modelu i motywu edytora. LLM idzie przez gateway → ai.
export default function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange
}: {
  open: boolean
  onClose: () => void
  theme: string
  onThemeChange: (t: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [provider, setProvider] = useState<ModelProvider>('ollama')

  useEffect(() => {
    if (open) {
      window.api.getSettings().then((s) => setProvider((s?.provider as ModelProvider) ?? 'ollama'))
    }
  }, [open])

  const save = async () => {
    await window.api.setSettings({ provider })
    // przełącz dostawcę LLM w locie (przez gateway → ai)
    await window.api.aiSetProvider(provider).catch(() => undefined)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('settings.title')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          select
          label={t('settings.language')}
          size="small"
          value={i18n.language}
          onChange={(e) => changeLanguage(e.target.value)}
        >
          {languages.map((l) => (
            <MenuItem key={l.code} value={l.code}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label={t('settings.modelLabel')}
          size="small"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ModelProvider)}
        >
          <MenuItem value="ollama">{t('settings.ollama')}</MenuItem>
          <MenuItem value="claude">{t('settings.claude')}</MenuItem>
        </TextField>

        <TextField
          select
          label={t('settings.themeLabel')}
          size="small"
          value={theme}
          onChange={(e) => onThemeChange(e.target.value)}
        >
          {themeNames.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </TextField>

        {provider === 'claude' && (
          <Typography variant="caption" color="text.secondary">
            <Trans i18nKey="settings.claudeHint" components={[<code key="0" />, <code key="1" />]} />
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={save}>
          {t('editor.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
