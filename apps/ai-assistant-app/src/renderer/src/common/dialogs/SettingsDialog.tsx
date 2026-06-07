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
  Divider,
  Tabs,
  Tab,
  Box
} from '@mui/material'
import { themeNames, RANDOM_DARK, RANDOM_LIGHT, AUTOGEN_DARK, AUTOGEN_LIGHT } from '@/common/editor/themes'
import { wallpapers } from '@/common/wallpapers'
import { accents } from '@/styles/accents'
import { changeLanguage, languages } from '@/i18n'
import { appBus } from '@/events'
import type { BlameMode } from '@/common/GitContext'

export type ModelProvider = 'ollama' | 'claude'

// SettingsDialog props.
// NOTE for the integration phase: the app-level vim / copilot toggles were moved out of the
// per-editor-window controls into this dialog (tab "Vim & Copilot"). App.tsx must own the
// vimOn / copilotOn / eachFnColor state and pass the value + a setter for each prop below,
// persisting via window.api.setSettings({ vim, copilot, eachFnColor }) (integration owns
// global.d.ts so it can add those three optional fields to get/setSettings).
type SettingsDialogProps = {
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
  // — App-level editor behaviour (moved here from inline editor-window toggles) —
  vimOn?: boolean
  onVimChange?: (on: boolean) => void
  copilotOn?: boolean
  onCopilotChange?: (on: boolean) => void
  eachFnColor?: boolean
  onEachFnColorChange?: (on: boolean) => void
}

// TabPanel — keeps inactive tabs mounted (display:none) so field state is preserved.
function TabPanel({
  active,
  children
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Box
      role="tabpanel"
      hidden={!active}
      sx={{ display: active ? 'flex' : 'none', flexDirection: 'column', gap: 2, pt: 2 }}
    >
      {children}
    </Box>
  )
}

// SettingsDialog — model provider + appearance (tab 1) and editor behaviour (tab 2).
// LLM traffic goes through gateway → ai.
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
  onRainbowChange,
  vimOn = false,
  onVimChange,
  copilotOn = false,
  onCopilotChange,
  eachFnColor = false,
  onEachFnColorChange
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation()
  const [provider, setProvider] = useState<ModelProvider>('ollama')
  const [tab, setTab] = useState(0)
  // Local stub for "additional options" placeholder toggle (no app-level state yet).
  const [extraOpts, setExtraOpts] = useState(false)

  useEffect(() => {
    if (open) {
      window.api.getSettings().then((s) => setProvider((s?.provider as ModelProvider) ?? 'ollama'))
    }
  }, [open])

  const save = async () => {
    await window.api.setSettings({
      provider,
      appTheme: accent,
      // Persist app-level editor behaviour. global.d.ts (integration-owned) adds these optional
      // fields to setSettings; cast keeps this view-owned file compiling before that lands.
      ...({ vim: vimOn, copilot: copilotOn, eachFnColor } as Record<string, unknown>)
    })
    // Switch the LLM provider on the fly (through gateway → ai).
    await window.api.aiSetProvider(provider).catch(() => undefined)
    appBus.emit('settings:provider-change', { provider })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>{t('settings.title')}</DialogTitle>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 3, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
      >
        <Tab label={t('settings.tab.general')} sx={{ minHeight: 40 }} />
        <Tab label={t('settings.tab.editor')} sx={{ minHeight: 40 }} />
      </Tabs>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 360 }}>
        <TabPanel active={tab === 0}>
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
            <MenuItem value={AUTOGEN_DARK} sx={{ fontWeight: 700, color: 'secondary.main' }}>
              {t('settings.themeAutogenDark')}
            </MenuItem>
            <MenuItem value={AUTOGEN_LIGHT} sx={{ fontWeight: 700, color: 'secondary.main' }}>
              {t('settings.themeAutogenLight')}
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
            control={
              <Switch checked={rainbow} onChange={(e) => onRainbowChange(e.target.checked)} />
            }
            label={t('settings.rainbowBrackets')}
          />

          {provider === 'claude' && (
            <Typography variant="caption" color="text.secondary">
              {t('settings.claudeHint')}
            </Typography>
          )}
        </TabPanel>

        <TabPanel active={tab === 1}>
          <Typography variant="overline" color="text.secondary">
            {t('settings.tab.editor')}
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={vimOn}
                onChange={(e) => onVimChange?.(e.target.checked)}
              />
            }
            label={t('settings.vim')}
          />

          <FormControlLabel
            control={
              <Switch
                checked={copilotOn}
                onChange={(e) => onCopilotChange?.(e.target.checked)}
              />
            }
            label={t('settings.copilot')}
          />

          <Divider />

          <FormControlLabel
            control={
              <Switch
                checked={eachFnColor}
                onChange={(e) => onEachFnColorChange?.(e.target.checked)}
              />
            }
            label={t('settings.eachFnColor')}
          />

          {/* Stub for future additional options (no app-level state yet). */}
          <FormControlLabel
            control={
              <Switch checked={extraOpts} onChange={(e) => setExtraOpts(e.target.checked)} />
            }
            label={t('settings.additionalOptions')}
          />
        </TabPanel>
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
