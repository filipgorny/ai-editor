import { useEffect, useRef } from 'react'
import { appBus } from '../events'

export function useDiskWatch(folder: string, refreshForPath: (p: string) => void) {
  // Keep the latest refresh fn for the disk watcher (avoids a stale closure without
  // re-subscribing on every render).
  const refreshRef = useRef(refreshForPath)
  refreshRef.current = refreshForPath

  // React to on-disk changes: the filer watches the project tree (gateway → main →
  // here) so the graph reflects files created/removed/renamed outside the app —
  // including those written by `claude -p` in headless mode.
  useEffect(() => {
    if (!folder) {
      return
    }

    // Guard against a stale preload (dev): the watcher API only exists after a full
    // `pnpm dev` restart, so skip cleanly instead of crashing the renderer.
    if (typeof window.api.watchProject !== 'function' || typeof window.api.onFsChange !== 'function') {
      return
    }

    window.api.watchProject(folder)

    let timer: number | undefined
    let pending = ''

    const off = window.api.onFsChange((ev) => {
      appBus.emit('disk:change', {
        path: ev.path,
        op: ev.op as 'create' | 'write' | 'remove' | 'rename' | 'chmod',
        dir: ev.dir
      })

      // Only structural changes (new/removed/renamed entries) reshape the graph;
      // plain content writes (incl. the app's own saves) are ignored to avoid loops.
      if (ev.op === 'write' || ev.op === 'chmod') {
        return
      }

      pending = ev.path
      window.clearTimeout(timer)
      // Debounce bursts (e.g. a git checkout) into a single refresh.
      timer = window.setTimeout(() => {
        appBus.emit('disk:refresh', { path: pending })
        refreshRef.current(pending)
      }, 400)
    })

    return () => {
      window.clearTimeout(timer)
      off()
      window.api.stopWatch()
    }
  }, [folder])
}
