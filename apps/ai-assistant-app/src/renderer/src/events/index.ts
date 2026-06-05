export { appBus } from './bus'
export type { AppEventMap, AppEventName, KeyEvent } from './bus'
export { installKeyEvents, normCombo, bindCombo, clearBoundCombos } from './keys'

import { appBus } from './bus'

// installDevLogger — in DEV, logs every event to the console. Makes the bus easy to
// inspect and hints script authors at which events are available (see EVENTS.md).
export function installDevLogger(): void {
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV

  if (!dev) {
    return
  }

  appBus.onAny((name, payload) => {
    console.debug('%c[appBus]%c ' + name, 'color:#58a6ff;font-weight:600', 'color:inherit', payload)
  })
}
