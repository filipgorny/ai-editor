import { createTheme } from '@mui/material/styles'
import { colors } from './styles/tokens'

// Ciemny motyw MUI (dla gotowych widgetów: Dialog, Button, LinearProgress).
export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: colors.bg, paper: colors.panel },
    primary: { main: colors.controller },
    secondary: { main: colors.module },
    success: { main: colors.service },
    error: { main: colors.danger },
    divider: colors.border
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: 'Inter, system-ui, sans-serif' }
})
