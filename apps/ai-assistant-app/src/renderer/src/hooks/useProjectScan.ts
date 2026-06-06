import { useEffect, useMemo, useRef, useState } from 'react'
import { mergeAppGraphs, type RawGraph } from '../utils/mergeGraph'
import { GatewayMapper, Graph, ScanProgress } from '../model'
import { appBus } from '../events'

// Internal navigation-history entry (mouse back/forward through the graph). Distinct
// from ViewKey: this tracks WHICH graph scene is shown, not which view is active.
type View = { type: 'project' } | { type: 'app'; appId: number; name: string }

export function useProjectScan(onInitialScan: () => void) {
  const [scanning, setScanning] = useState(false)
  // True once an initial project scan has produced a graph — gates graph-only chrome
  // (e.g. the review button) without coupling it to the active view.
  const [hasGraph, setHasGraph] = useState(false)
  const [folder, setFolder] = useState('')
  // monorepo graph (raw) + internal graphs of inline-expanded apps; merged below
  const [rawBase, setRawBase] = useState<RawGraph | null>(null)
  const [rawApps, setRawApps] = useState<Record<number, RawGraph>>({})
  const rawAppsRef = useRef<Record<number, RawGraph>>({})
  // what the in-flight scan is for (drives onScanEnd). null = none / initial scan.
  const scanKind = useRef<'project' | 'refresh' | { app: number } | null>(null)
  const [progress, setProgress] = useState<ScanProgress>(ScanProgress.initial())
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [nav, setNav] = useState({ back: false, fwd: false })
  // wersja systemu plików — bump po operacji, by drzewo plików się odświeżyło
  const [fsVersion, setFsVersion] = useState(0)
  const [navKey, setNavKey] = useState(0) // ++ przy NAWIGACJI (drill/back) — graf fituje/resetuje rozwinięcia

  const pending = useRef<View>({ type: 'project' })
  const scannedProjectId = useRef('')
  const history = useRef<View[]>([])
  const index = useRef(-1)

  // merged graph: monorepo + expanded apps (apps expand in place like folders)
  const graph = useMemo(
    () =>
      rawBase
        ? GatewayMapper.graph(
            mergeAppGraphs(rawBase, rawApps) as unknown as Parameters<typeof GatewayMapper.graph>[0]
          )
        : null,
    [rawBase, rawApps]
  )

  useEffect(() => {
    rawAppsRef.current = rawApps
  }, [rawApps])

  // Najnowszy graf pod ręką dla skilla get_graph (handler AI rejestrujemy raz, bez deps).
  const graphRef = useRef<Graph | null>(null)

  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  const syncNav = () => {
    setNav({ back: index.current > 0, fwd: index.current < history.current.length - 1 })
  }

  // Apps no longer drill into a separate scene — they expand inline. applyView only
  // re-applies the monorepo (project) graph (used by back/forward).
  const applyView = async (_v: View, nav = true) => {
    const raw = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph

    setRawBase(raw)
    setHasGraph(true)

    if (nav) {
      setNavKey((n) => n + 1)
    }
  }

  const pushView = async (v: View) => {
    history.current = [...history.current.slice(0, index.current + 1), v]
    index.current = history.current.length - 1
    syncNav()
    await applyView(v)
  }

  const back = async () => {
    if (index.current <= 0) {
      return
    }

    index.current--
    syncNav()
    appBus.emit('nav:back', {})
    await applyView(history.current[index.current])
  }

  const forward = async () => {
    if (index.current >= history.current.length - 1) {
      return
    }

    index.current++
    syncNav()
    appBus.emit('nav:forward', {})
    await applyView(history.current[index.current])
  }

  const resetProgress = () => {
    setError('')
    setLog([])
    setProgress(ScanProgress.initial())
  }

  const scanProject = (path: string) => {
    if (!path) {
      return
    }

    pending.current = { type: 'project' }
    scanKind.current = 'project'
    resetProgress()
    setScanning(true)
    appBus.emit('scan:start', { kind: 'project', path })
    window.api.startScan(path)
  }

  // appIdForPath finds the expanded app whose directory contains the given path.
  const appIdForPath = (path: string): number | null => {
    for (const [appIdStr, g] of Object.entries(rawAppsRef.current)) {
      const root = (g.nodes ?? []).find((n) => n.id === 'folder:.')
      const dir = typeof root?.file === 'string' ? root.file : ''

      if (dir && path.startsWith(dir)) {
        return Number(appIdStr)
      }
    }

    return null
  }

  // refreshForPath silently refreshes the graph after a file op. A file inside an
  // expanded app triggers a deep re-scan of THAT app (so its internals update); a
  // monorepo-level change re-scans the project. Both update the graph in place.
  const refreshForPath = (path: string) => {
    setFsVersion((n) => n + 1) // also refresh the file tree (filer)

    if (scanKind.current != null) {
      return // a scan is already in flight
    }

    const appId = appIdForPath(path)

    if (appId != null) {
      scanKind.current = { app: appId } // reuse the inline-expand flow: deep-scan + re-merge
      window.api.startScanApp(appId)

      return
    }

    scanKind.current = 'refresh'
    window.api.startScan(folder)
  }

  // refreshCurrentView — refresh without a specific path (re-scans the project).
  const refreshCurrentView = () => {
    setFsVersion((n) => n + 1)

    if (scanKind.current != null) {
      return
    }

    scanKind.current = 'refresh'
    window.api.startScan(folder)
  }

  const pickAndScan = async () => {
    const picked = await window.api.pickFolder()

    if (picked) {
      setFolder(picked)
      appBus.emit('project:open', { folder: picked })
      scanProject(picked)
    }
  }

  // Dwuklik w węzeł: serwis → drill-down; encja (klasa/serwis/funkcja) → edytor pliku.
  // Inline-expand an app: deep-scan it (silent) then merge its internal graph under
  // the app node. The monorepo graph stays visible the whole time.
  const expandApp = (appId: number) => {
    if (rawAppsRef.current[appId] || scanKind.current != null) {
      return // already loaded or a scan is in flight
    }

    scanKind.current = { app: appId }
    appBus.emit('nav:app-expand', { appId })
    appBus.emit('scan:start', { kind: 'app', appId })
    window.api.startScanApp(appId)
  }

  // Start aplikacji: automatycznie otwórz ostatnio edytowany projekt.
  useEffect(() => {
    window.api.lastFolder().then((f) => {
      setFolder(f)

      if (f) {
        appBus.emit('project:open', { folder: f })
        scanProject(f)
      }
    })
  }, [])

  useEffect(() => {
    const offProgress = window.api.onProgress((raw) => {
      const p = GatewayMapper.progress(raw)

      setProgress(p)
      appBus.emit('scan:progress', {
        currentFile: p.currentFile,
        filesDone: p.filesDone,
        entitiesDone: p.entitiesDone
      })

      if (p.projectId) {
        scannedProjectId.current = p.projectId
      }

      if (p.message) {
        setLog((prev) => [...prev.slice(-300), p.message])
      }
    })

    const offEnd = window.api.onScanEnd(async () => {
      const kind = scanKind.current
      scanKind.current = null

      // inline-expand / per-app refresh: re-fetch that app and merge it in place
      if (kind && typeof kind === 'object') {
        const appId = kind.app
        const raw = (await window.api.getAppGraph(appId)) as RawGraph
        setRawApps((prev) => ({ ...prev, [appId]: raw }))
        appBus.emit('scan:end', { kind: 'expand' })

        return
      }

      // silent refresh after a file op: re-fetch base + all expanded apps in place
      if (kind === 'refresh') {
        const base = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph
        setRawBase(base)

        for (const id of Object.keys(rawAppsRef.current).map(Number)) {
          const r = (await window.api.getAppGraph(id)) as RawGraph
          setRawApps((prev) => ({ ...prev, [id]: r }))
        }

        appBus.emit('scan:end', { kind: 'refresh' })

        return
      }

      // initial project scan ('project' or null) → fresh monorepo graph (apps collapsed)
      const base = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph
      setRawBase(base)
      setRawApps({})
      setScanning(false)
      setHasGraph(true)
      // Initial project scan finished — reveal the code-diagram view.
      onInitialScan()
      setNavKey((n) => n + 1)
      appBus.emit('scan:end', { kind: 'project' })
    })

    const offError = window.api.onScanError((m) => {
      setError(m)
      appBus.emit('scan:error', { message: m })
    })

    return () => {
      offProgress()
      offEnd()
      offError()
    }
  }, [])

  // Przyciski myszy: wstecz / dalej w historii otwartych nodów.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      }

      if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }

    window.addEventListener('mouseup', onMouse)

    return () => window.removeEventListener('mouseup', onMouse)
  }, [])

  return {
    folder,
    setFolder,
    rawBase,
    rawApps,
    rawAppsRef,
    graph,
    graphRef,
    scanning,
    hasGraph,
    progress,
    log,
    error,
    nav,
    navKey,
    fsVersion,
    scanKind,
    history,
    index,
    syncNav,
    applyView,
    pushView,
    back,
    forward,
    scanProject,
    pickAndScan,
    refreshForPath,
    refreshCurrentView,
    expandApp,
    appIdForPath
  }
}
