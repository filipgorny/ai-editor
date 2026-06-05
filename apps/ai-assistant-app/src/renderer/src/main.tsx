import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from './theme'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
import './styles/global.scss'

// Brak domyślnego (systemowego) menu kontekstowego okna.
window.addEventListener('contextmenu', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
)
