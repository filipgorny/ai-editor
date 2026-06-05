import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('idle')
  const [folder, setFolder] = useState('')
  const [graph, setGraph] = useState<Graph | null>(null)
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

  // Start aplikacji: automatycznie otwórz ostatnio edytowany projekt.
  useEffect(() => {
    window.api.lastFolder().then((f) => {
      setFolder(f)

      if (f) {
        scanProject(f)
      }
    })
  }, [])

  useEffect(() => {
    const offProgress = window.api.onProgress((raw) => {
      const p = GatewayMapper.progress(raw)

      setProgress(p)

      if (p.projectId) {
        scannedProjectId.current = p.projectId
      }

      if (p.message) {
        setLog((prev) => [...prev.slice(-300), p.message])
      }
    })

    const offEnd = window.api.onScanEnd(async () => {
      const target = pending.current

      // cichy re-skan po operacji: zaktualizuj graf W MIEJSCU (bez historii/modala)
      if (refreshing.current) {
        refreshing.current = false
        await applyView(target, false) // cichy refresh — bez fit/reset rozwinięć

        return
      }

      if (target.type === 'app') {
        await pushView(target)
      } else {
        history.current = [{ type: 'project' }]
        index.current = 0
        syncNav()
        await applyView({ type: 'project' })
      }
    })

    const offError = window.api.onScanError((m) => setError(m))

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

  const applyView = async (v: View, nav = true) => {
    if (v.type === 'app') {
      const raw = await window.api.getAppGraph(v.appId)

      setGraph(GatewayMapper.graph(raw))
      setTitle(v.name)
    } else {
      const raw = await window.api.getGraph(Number(scannedProjectId.current) || 0)

      setGraph(GatewayMapper.graph(raw))
      setTitle('ai-architect')
    }

    setMode('graph')

    if (nav) {
      setNavKey((n) => n + 1) // nawigacja → graf zrobi fit i zresetuje rozwinięcia
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
    await applyView(history.current[index.current])
  }

  const forward = async () => {
    if (index.current >= history.current.length - 1) {
      return
    }

    index.current++
    syncNav()
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
    window.api.startScan(path)
  }

  // refreshCurrentView CICHO odświeża aktualny widok po mutacji pliku — re-skan
  // w tle (bez modala, bez odmontowania grafu), graf aktualizuje się W MIEJSCU.
  const refreshCurrentView = () => {
    setFsVersion((n) => n + 1) // odśwież też drzewo plików (filer)
    refreshing.current = true
    const v = history.current[index.current]

    if (v && v.type === 'app') {
      pending.current = v
      window.api.startScanApp(v.appId)

      return
    }

    pending.current = { type: 'project' }
    window.api.startScan(folder)
  }

  const pickAndScan = async () => {
    const picked = await window.api.pickFolder()

    if (picked) {
      setFolder(picked)
      scanProject(picked)
    }
  }

  // openFile otwiera (lub aktywuje) okno edytora; można mieć kilka naraz.
  const openFile = (absFile: string, fn?: string) => {
    lastDir.current = absFile.replace(/[\\/][^\\/]+$/, '') // zapamiętaj folder

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
    setEditors((prev) => prev.filter((e) => e.path !== path))
    setMinimized((prev) => {
      const next = new Set(prev)
      next.delete(path)

      return next
    })
  }

  // Klik w zakładkę: przywróć (jeśli zminimalizowane) i uaktywnij.
  const selectEditor = (path: string) => {
    setMinimized((prev) => {
      const next = new Set(prev)
      next.delete(path)

      return next
    })
    setActiveEditor(path)
  }

  const minimizeEditor = (path: string) => {
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

    try {
      const res = await window.api.aiAgent(prompt, dir)

      // zawsze pokaż coś w dymku (komunikat, podsumowanie operacji albo info)
      setAgentReply(
        res?.message ||
          (res?.ops?.length ? t('agent.opsDone', { count: res.ops.length }) : t('agent.noOps'))
      )

      if (res?.openPath) {
        openFile(res.openPath)
      }

      if (res?.ops?.length) {
        setFocusPath(res.openPath || res.ops[0].path)
        refreshCurrentView() // odśwież bieżący widok po operacjach
      }
    } catch (e) {
      setAgentReply(t('agent.error', { message: String((e as Error)?.message || e) }))
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
      refreshCurrentView() // cichy re-skan — element zostaje

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
    setFocusPath(path)
    refreshCurrentView() // cichy re-skan w tle — nowy element zostaje i staje się prawdziwy
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
      setFocusPath(path)
      refreshCurrentView()
    }
  }

  // „Przenieś plik" (przeciągnięcie linii do folderu) — przenieś na dysku + rescan.
  const moveFile = async (node: Node, targetDir: string) => {
    if (!node.absFile) {
      return
    }

    const path = await window.api.moveFile(node.absFile, targetDir)
    window.api.publishEvent({ type: 'move', title: t('events.move'), file: path })
    setFocusPath(path)
    refreshCurrentView()
  }

  // „Usuń element" — usuń plik/folder (przez gateway → filer) i odśwież graf.
  const deleteElement = async (node: Node, path: string) => {
    if (!window.confirm(t('graph.deleteConfirm', { name: node.name }))) {
      return
    }

    await window.api.deleteFile(path)
    window.api.publishEvent({ type: 'delete', title: t('events.delete'), file: path })
    refreshCurrentView()
  }

  // Dwuklik w węzeł: serwis → drill-down; encja (klasa/serwis/funkcja) → edytor pliku.
  const openNode = (node: Node) => {
    if (mode === 'scanning') {
      return // unikamy podwójnego skanu (single + double click)
    }

    if (node instanceof AppNode) {
      pending.current = { type: 'app', appId: node.appId, name: node.name }
      resetProgress()
      setMode('scanning')
      window.api.startScanApp(node.appId)

      return
    }

    if (node.absFile) {
      openFile(node.absFile)
    }
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
              if (node instanceof AppNode) {
                openNode(node) // serwis/app → wejdź (drill)
              } else if (node.absFile) {
                openFile(node.absFile) // plik → edytor
              }
            }}
            onNodeDoubleClick={openNode}
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
        />
      </Layout>
    </EditorContext.Provider>
  )
}
