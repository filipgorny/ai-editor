import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Button,
  Typography,
  FormControlLabel,
  Switch,
  Divider
} from '@mui/material'
import { themeNames, RANDOM_DARK, RANDOM_LIGHT } from './themes'
import { wallpapers } from './wallpapers'
import { accents } from '../styles/accents'
import { changeLanguage, languages } from '../i18n'
import { appBus } from '../events'
import type { BlameMode } from './GitContext'

export type ModelProvider = 'ollama' | 'claude'

// SettingsDialog — wybór dostawcy modelu i motywu edytora. LLM idzie przez gateway → ai.
export default function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  wallpaper,
  onWallpaperChange,
  accent,
  onAccentChange,
  blame,
  onBlameChange,
  rainbow,
  onRainbowChange
}: {
  open: boolean
  onClose: () => void
  theme: string
  onThemeChange: (t: string) => void
  wallpaper: string
  onWallpaperChange: (url: string) => void
  accent: string
  onAccentChange: (key: string) => void
  blame: BlameMode
  onBlameChange: (b: BlameMode) => void
  rainbow: boolean
  onRainbowChange: (on: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const [provider, setProvider] = useState<ModelProvider>('ollama')

  useEffect(() => {
    if (open) {
      window.api.getSettings().then((s) => setProvider((s?.provider as ModelProvider) ?? 'ollama'))
    }
  }, [open])

  const save = async () => {
    await window.api.setSettings({ provider, appTheme: accent })
    // przełącz dostawcę LLM w locie (przez gateway → ai)
    await window.api.aiSetProvider(provider).catch(() => undefined)
    appBus.emit('settings:provider-change', { provider })
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
          onChange={(e) => {
            changeLanguage(e.target.value)
            appBus.emit('settings:language-change', { lang: e.target.value })
          }}
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
          label={t('settings.accentLabel', { defaultValue: 'Kolor motywu' })}
          size="small"
          value={accent}
          onChange={(e) => onAccentChange(e.target.value)}
        >
          {accents.map((a) => (
            <MenuItem key={a.key} value={a.key}>
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: a.color,
                  marginRight: 8,
                  verticalAlign: 'middle'
                }}
              />
              {i18n.language.startsWith('en') ? a.en : a.pl}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label={t('settings.themeLabel')}
          size="small"
          value={theme}
          onChange={(e) => {
            onThemeChange(e.target.value)
            appBus.emit('settings:theme-change', { theme: e.target.value })
          }}
        >
          <MenuItem value={RANDOM_DARK} sx={{ fontWeight: 700, color: 'primary.main' }}>
            {t('settings.themeVariedDark')}
          </MenuItem>
          <MenuItem value={RANDOM_LIGHT} sx={{ fontWeight: 700, color: 'primary.main' }}>
            {t('settings.themeVariedLight')}
          </MenuItem>
          <Divider />
          {themeNames.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label={t('settings.wallpaperLabel', { defaultValue: 'Tapeta' })}
          size="small"
          value={wallpaper}
          onChange={(e) => onWallpaperChange(e.target.value)}
        >
          {wallpapers.map((w) => (
            <MenuItem key={w.url || 'none'} value={w.url}>
              {i18n.language.startsWith('en') ? w.en : w.pl}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label={t('settings.gitBlameLabel')}
          size="small"
          value={blame}
          onChange={(e) => onBlameChange(e.target.value as BlameMode)}
        >
          <MenuItem value="off">{t('settings.gitBlameOff')}</MenuItem>
          <MenuItem value="last">{t('settings.gitBlameLast')}</MenuItem>
        </TextField>

        <FormControlLabel
          control={<Switch checked={rainbow} onChange={(e) => onRainbowChange(e.target.checked)} />}
          label={t('settings.rainbowBrackets')}
        />

        {provider === 'claude' && (
          <Typography variant="caption" color="text.secondary">
            {t('settings.claudeHint')}
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
