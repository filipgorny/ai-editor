import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '@/i18n'
import { logBus } from '@/events'

// ErrorBoundary — zamiast czarnego ekranu pokaż treść błędu renderowania.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  // Forward render errors to the logs service (via gateway) like any other error.
  componentDidCatch(error: Error, info: ErrorInfo): void {
    logBus.push('Render error: ' + (error?.stack || String(error)) + (info?.componentStack || ''), 'error')
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f85149', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h3>{i18n.t('error.render')}</h3>
          {String(this.state.error?.stack || this.state.error)}
        </div>
      )
    }

    return this.props.children
  }
}
