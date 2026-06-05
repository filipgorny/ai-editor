import { createTheme } from '@mui/material/styles'
import { colors } from './styles/tokens'
import { accentBy } from './styles/accents'

// makeTheme builds the dark MUI theme with a chosen accent (primary) colour —
// drives buttons and other primary-coloured widgets across the app.
export function makeTheme(accentKey = 'blue') {
  const accent = accentBy(accentKey)

  return createTheme({
    palette: {
      mode: 'dark',
      background: { default: colors.bg, paper: colors.panel },
      primary: { main: accent.color, ...(accent.contrast ? { contrastText: accent.contrast } : {}) },
      secondary: { main: colors.module },
      success: { main: colors.service },
      error: { main: colors.danger },
      divider: colors.border
    },
    shape: { borderRadius: 10 },
    typography: { fontFamily: 'Inter, system-ui, sans-serif' }
  })
}

// Default theme (blue) — used by the root ThemeProvider before App applies the saved one.
export const theme = makeTheme('blue')
