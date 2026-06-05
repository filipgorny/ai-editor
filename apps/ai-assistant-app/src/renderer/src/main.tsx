import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from './theme'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installDevLogger } from './events'
import './i18n'
import './styles/global.scss'

// No default (system) window context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault())

// Log every in-app event to the console in DEV (see EVENTS.md).
installDevLogger()

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
