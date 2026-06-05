// Global, reusable toast system. Any module can fire a toast without knowing the UI:
//   import { toast } from '../toast'
//   toast.success('Saved')   toast.error('Failed')   toast.info(...)   toast.warning(...)
// A single <ToastHost/> (mounted once in App) subscribes and renders stacked MUI Snackbars.

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning'
export type ToastItem = { id: number; message: string; severity: ToastSeverity; duration: number }

type Sub = (items: ToastItem[]) => void

const DEFAULT_DURATION = 3000

let items: ToastItem[] = []
let seq = 0
const subs = new Set<Sub>()

function notify(): void {
  for (const s of [...subs]) {
    s(items)
  }
}

function show(message: string, severity: ToastSeverity, duration = DEFAULT_DURATION): number {
  const id = ++seq

  items = [...items, { id, message, severity, duration }]
  notify()

  return id
}

export const toast = {
  show,
  success: (message: string, duration?: number): number => show(message, 'success', duration),
  error: (message: string, duration?: number): number => show(message, 'error', duration),
  info: (message: string, duration?: number): number => show(message, 'info', duration),
  warning: (message: string, duration?: number): number => show(message, 'warning', duration),

  // dismiss removes a toast (e.g. on auto-hide or the close button).
  dismiss(id: number): void {
    items = items.filter((it) => it.id !== id)
    notify()
  },

  // subscribe registers a renderer (ToastHost); returns an unsubscribe fn.
  subscribe(fn: Sub): () => void {
    subs.add(fn)
    fn(items)

    return () => {
      subs.delete(fn)
    }
  }
}
