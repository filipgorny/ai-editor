import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from './theme'
import App from './App'
import ErrorBoundary from '@/ui/ErrorBoundary'
import {
  installDevLogger,
  installKeyEvents,
  installConsoleCapture,
  installLogPersist,
  installErrorCapture
} from './events'
import './i18n'
import './styles/global.scss'

// No default (system) window context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault())

// Don't let background focus() calls (CodeMirror, Commander, autoFocus, …) raise the
// OS window. When the app is backgrounded (document.hasFocus() === false), skip the
// focus so the window never pops to the foreground "by itself". User-driven focus
// happens while the window IS focused, so it's unaffected.
const nativeFocus = HTMLElement.prototype.focus
HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
  if (!document.hasFocus()) {
    return
  }

  return nativeFocus.call(this, options)
}

// Log every in-app event to the console in DEV (see EVENTS.md).
installDevLogger()

// Emit keyboard events on the app bus so scripts can bind keys/chords (see SCRIPTING.md).
installKeyEvents()

// Mirror every console.* call into the Logs window.
installConsoleCapture()

// Forward uncaught errors + unhandled promise rejections to the logs service.
installErrorCapture()

// Persist logs to the backend logs service (and load history) — always through the gateway.
installLogPersist()

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
