import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mergeAppGraphs, type RawGraph } from './utils/mergeGraph'
import styled from 'styled-components'
import { Button } from '@mui/material'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import SettingsIcon from '@mui/icons-material/Settings'
import { AppNode, GatewayMapper, Graph, Node, ScanProgress } from './model'
import GraphView from './components/GraphView'
import ScanModal from './components/ScanModal'
import SettingsDialog from './components/SettingsDialog'
import AgentBar from './components/AgentBar'
import EditorTabs from './components/EditorTabs'
import FileBrowser from './components/FileBrowser'
import CodeEditor, { type EditorTarget } from './components/CodeEditor'
import { EditorContext } from './components/EditorContext'
import { appBus } from './events'
import { colors } from './styles/tokens'

const Layout = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
`

const TopBar = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.panel};
`

const ProjectName = styled.div`
  font-family: monospace;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
`

// Wiersz głównej zawartości: lewy panel plików + graf (od paska edytorów do promptu).
const Content = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
`

const Stage = styled.main`
  flex: 1;
  position: relative;
  min-width: 0;
`

const Empty = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: ${colors.muted};
  text-align: center;
`

type Mode = 'idle' | 'scanning' | 'graph'
type View = { type: 'project' } | { type: 'app'; appId: number; name: string }

export default function App() {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<Mode>('idle')
  const [folder, setFolder] = useState('')
  // monorepo graph (raw) + internal graphs of inline-expanded apps; merged below
  const [rawBase, setRawBase] = useState<RawGraph | null>(null)
  const [rawApps, setRawApps] = useState<Record<number, RawGraph>>({})
  const rawAppsRef = useRef<Record<number, RawGraph>>({})
  const expanding = useRef<number | null>(null) // app being inline-expanded
  const [progress, setProgress] = useState<ScanProgress>(ScanProgress.initial())
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [title, setTitle] = useState('ai-architect')
  const [nav, setNav] = useState({ back: false, fwd: false })
  const [editors, setEditors] = useState<EditorTarget[]>([])
  const [activeEditor, setActiveEditor] = useState('')
  const [minimized, setMinimized] = useState<Set<string>>(new Set())
  // wersja systemu plików — bump po operacji, by drzewo plików się odświeżyło
  const [fsVersion, setFsVersion] = useState(0)
  // globalne ustawienia edytorów (wspólne dla wszystkich okien)
  const [vimOn, setVimOn] = useState(true)
  const [copilotOn, setCopilotOn] = useState(true)
  const [editorTheme, setEditorTheme] = useState('Czarny (domyślny)')
  const [wallpaper, setWallpaper] = useState('') // graph background image url
  const [focusPath, setFocusPath] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentReply, setAgentReply] = useState('')
  // ostatnio otwarty folder (kontekst dla agenta — domyślny katalog nowych plików)
  const lastDir = useRef('')

  const pending = useRef<View>({ type: 'project' })
  const refreshing = useRef(false) // cichy re-skan (bez modala) po operacji na pliku
  const [navKey, setNavKey] = useState(0) // ++ przy NAWIGACJI (drill/back) — graf fituje/resetuje rozwinięcia
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
      // inline-expand: fetch the app's internal graph and merge it under the app node
      if (expanding.current != null) {
        const appId = expanding.current
        expanding.current = null
        const raw = (await window.api.getAppGraph(appId)) as RawGraph
        setRawApps((prev) => ({ ...prev, [appId]: raw }))
        appBus.emit('scan:end', { kind: 'expand' })

        return
      }

      // silent refresh after a file op: re-fetch base + all expanded apps in place
      if (refreshing.current) {
        refreshing.current = false
        const base = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph
        setRawBase(base)

        for (const id of Object.keys(rawAppsRef.current).map(Number)) {
          const r = (await window.api.getAppGraph(id)) as RawGraph
          setRawApps((prev) => ({ ...prev, [id]: r }))
        }

        appBus.emit('scan:end', { kind: 'refresh' })

        return
      }

      // initial project scan → fresh monorepo graph (no apps expanded)
      const base = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph
      setRawBase(base)
      setRawApps({})
      setMode('graph')
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

  const syncNav = () => {
    setNav({ back: index.current > 0, fwd: index.current < history.current.length - 1 })
  }

  // Apps no longer drill into a separate scene — they expand inline. applyView only
  // re-applies the monorepo (project) graph (used by back/forward).
  const applyView = async (_v: View, nav = true) => {
    const raw = (await window.api.getGraph(Number(scannedProjectId.current) || 0)) as RawGraph

    setRawBase(raw)
    setTitle('ai-architect')
    setMode('graph')

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
    resetProgress()
    setMode('scanning')
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

    if (expanding.current != null || refreshing.current) {
      return // a scan is already in flight
    }

    const appId = appIdForPath(path)

    if (appId != null) {
      expanding.current = appId // reuse the inline-expand flow: deep-scan + re-merge
      window.api.startScanApp(appId)

      return
    }

    refreshing.current = true
    window.api.startScan(folder)
  }

  // refreshCurrentView — refresh without a specific path (re-scans the project).
  const refreshCurrentView = () => {
    setFsVersion((n) => n + 1)

    if (expanding.current != null || refreshing.current) {
      return
    }

    refreshing.current = true
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

  // openFile otwiera (lub aktywuje) okno edytora; można mieć kilka naraz.
  const openFile = (absFile: string, fn?: string) => {
    lastDir.current = absFile.replace(/[\\/][^\\/]+$/, '') // zapamiętaj folder
    appBus.emit('editor:open', { path: absFile })

    setEditors((prev) =>
      prev.some((e) => e.path === absFile)
        ? prev.map((e) => (e.path === absFile ? { path: absFile, gotoFn: fn } : e))
        : [...prev, { path: absFile, gotoFn: fn }]
    )

    setActiveEditor(absFile)
    setMinimized((prev) => {
      if (!prev.has(absFile)) {
        return prev
      }

      const next = new Set(prev)
      next.delete(absFile)

      return next
    })
  }

  const closeEditor = (path: string) => {
    appBus.emit('editor:close', { path })
    setEditors((prev) => prev.filter((e) => e.path !== path))
    setMinimized((prev) => {
      const next = new Set(prev)
      next.delete(path)

      return next
    })
  }

  // Klik w zakładkę: przywróć (jeśli zminimalizowane) i uaktywnij.
  const selectEditor = (path: string) => {
    appBus.emit('editor:activate', { path })
    setMinimized((prev) => {
      const next = new Set(prev)
      next.delete(path)

      return next
    })
    setActiveEditor(path)
  }

  const minimizeEditor = (path: string) => {
    appBus.emit('editor:minimize', { path })
    setMinimized((prev) => new Set(prev).add(path))
  }

  // runAgent — prompt AI w głównym widoku. Agent (gateway → ai/filer) wykonuje
  // operacje na plikach; nowy plik domyślnie w ostatnio otwartym folderze.
  const runAgent = async (prompt: string) => {
    const dir = lastDir.current || folder

    if (!dir) {
      return
    }

    setAgentBusy(true)
    appBus.emit('agent:start', { prompt, dir })

    try {
      const res = await window.api.aiAgent(prompt, dir, i18n.language)

      // zawsze pokaż coś w dymku (komunikat, podsumowanie operacji albo info)
      const reply =
        res?.message ||
        (res?.ops?.length ? t('agent.opsDone', { count: res.ops.length }) : t('agent.noOps'))

      setAgentReply(reply)
      appBus.emit('agent:success', { ops: res?.ops?.length ?? 0, message: reply })

      if (res?.openPath) {
        openFile(res.openPath)
      }

      if (res?.ops?.length) {
        const p = res.openPath || res.ops[0].path
        setFocusPath(p)
        refreshForPath(p) // refresh the app/project that the ops touched
      }
    } catch (e) {
      const message = String((e as Error)?.message || e)

      setAgentReply(t('agent.error', { message }))
      appBus.emit('agent:error', { message })
    } finally {
      setAgentBusy(false)
    }
  }

  // „Dodaj element" — folder: utwórz katalog; klasa: utwórz plik w katalogu
  // docelowym (folderu z menu lub roota), AI wypełnia pustą klasę, otwórz + rescan.
  const addElement = async (name: string, file: string, kind: 'class' | 'function' | 'folder', targetDir?: string) => {
    const base = targetDir || folder

    if (!base) {
      return
    }

    if (kind === 'folder') {
      const dir = await window.api.createFolder(base, file)
      window.api.publishEvent({ type: 'create', title: t('events.createFolder'), file: dir })
      appBus.emit('folder:create', { path: dir })
      refreshForPath(dir) // deep-rescan the app that contains the new folder

      return
    }

    const path = await window.api.createFile(base, file, name)

    if (!path) {
      return
    }

    // AI wypełnia pustą klasę/funkcję o podanej nazwie.
    const what = kind === 'function' ? `pustą funkcję o nazwie ${name}` : `pustą klasę o nazwie ${name}`
    const generated = await window.api
      .aiEdit('', `Utwórz ${what}. Zwróć tylko kod, bez komentarzy.`, path)
      .catch(() => '')

    if (generated && generated.trim()) {
      await window.api.saveFile(path, generated)
    }

    openFile(path)
    window.api.publishEvent({ type: 'create', title: t('events.createElement'), file: path })
    appBus.emit('file:create', { path, kind })
    setFocusPath(path)
    refreshForPath(path) // deep-rescan the app so the new class appears on the graph
  }

  // „Zmień nazwę" — zmień nazwę klasy w kodzie i nazwę pliku, otwórz nowy plik.
  const renameElement = async (node: Node, className: string, fileBase: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.renameFile(node.absFile, fileBase, className, node.name)

    if (path) {
      openFile(path)
      window.api.publishEvent({ type: 'rename', title: t('events.rename'), file: path })
      appBus.emit('file:rename', { from: node.absFile, to: path })
      setFocusPath(path)
      refreshForPath(path)
    }
  }

  // „Przenieś plik" (przeciągnięcie linii do folderu) — przenieś na dysku + rescan.
  const moveFile = async (node: Node, targetDir: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.moveFile(node.absFile, targetDir)
    window.api.publishEvent({ type: 'move', title: t('events.move'), file: path })
    appBus.emit('file:move', { from: node.absFile, to: path })
    setFocusPath(path)
    refreshForPath(path)
  }

  // „Usuń element" — usuń plik/folder (przez gateway → filer) i odśwież graf.
  const deleteElement = async (node: Node, path: string) => {
    if (!window.confirm(t('graph.deleteConfirm', { name: node.name }))) {
      return
    }

    await window.api.deleteFile(path)
    window.api.publishEvent({ type: 'delete', title: t('events.delete'), file: path })
    appBus.emit('file:delete', { path })
    refreshForPath(path)
  }

  // Dwuklik w węzeł: serwis → drill-down; encja (klasa/serwis/funkcja) → edytor pliku.
  // Inline-expand an app: deep-scan it (silent) then merge its internal graph under
  // the app node. The monorepo graph stays visible the whole time.
  const expandApp = (appId: number) => {
    if (rawAppsRef.current[appId] || expanding.current != null) {
      return // already loaded or a scan is in flight
    }

    expanding.current = appId
    appBus.emit('nav:app-expand', { appId })
    appBus.emit('scan:start', { kind: 'app', appId })
    window.api.startScanApp(appId)
  }

  return (
    <EditorContext.Provider value={openFile}>
      <Layout>
        <TopBar>
        <ProjectName>{title === 'ai-architect' ? folder.split('/').pop() || '' : title}</ProjectName>
        <div style={{ flex: 1 }} />
        <Button variant="contained" size="small" startIcon={<FolderOpenIcon />} onClick={pickAndScan}>
          {t('topbar.pickProject')}
        </Button>
        <Button size="small" startIcon={<SettingsIcon />} onClick={() => setSettingsOpen(true)}>
          {t('topbar.settings')}
        </Button>
      </TopBar>

      <EditorTabs
        editors={editors}
        active={activeEditor}
        minimized={minimized}
        onSelect={selectEditor}
        onClose={closeEditor}
      />

      <Content>
        <FileBrowser root={folder} version={fsVersion} onOpenFile={(p) => openFile(p)} />

        <Stage>
        {mode === 'graph' && graph ? (
          <GraphView
            graph={graph}
            onNodeClick={(node) => {
              if (node.absFile) {
                openFile(node.absFile) // file → editor (apps are handled inline by GraphView)
              }
            }}
            onExpandApp={(appId) => expandApp(appId)}
            wallpaper={wallpaper}
            onAddElement={addElement}
            onRename={renameElement}
            onMoveFile={moveFile}
            onDelete={deleteElement}
            focusPath={focusPath}
            navKey={navKey}
          />
        ) : (
          <Empty>
            <h2>{t('empty.title')}</h2>
            {folder ? (
              <Button variant="outlined" onClick={() => scanProject(folder)}>
                {t('empty.scanLast', { folder })}
              </Button>
            ) : null}
          </Empty>
        )}
        </Stage>
      </Content>

      {mode === 'graph' && (
        <AgentBar
          onSubmit={runAgent}
          busy={agentBusy}
          reply={agentReply}
          onClearReply={() => setAgentReply('')}
        />
      )}

      <ScanModal open={mode === 'scanning'} progress={progress} log={log} error={error} />
        {editors.map((t, i) => (
          <CodeEditor
            key={t.path}
            target={t}
            index={i}
            active={activeEditor === t.path}
            onActivate={() => setActiveEditor(t.path)}
            minimized={minimized.has(t.path)}
            onMinimize={() => minimizeEditor(t.path)}
            onClose={() => closeEditor(t.path)}
            onOpen={(nt) => openFile(nt.path, nt.gotoFn)}
            vim={vimOn}
            onVimChange={setVimOn}
            copilot={copilotOn}
            onCopilotChange={setCopilotOn}
            theme={editorTheme}
            root={folder}
          />
        ))}
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          theme={editorTheme}
          onThemeChange={setEditorTheme}
          wallpaper={wallpaper}
          onWallpaperChange={setWallpaper}
        />
      </Layout>
    </EditorContext.Provider>
  )
}
