import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Button } from '@mui/material'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { AppNode, GatewayMapper, Graph, Node, ScanProgress } from './model'
import GraphView from './components/GraphView'
import ScanModal from './components/ScanModal'
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

const Brand = styled.div`
  font-family: monospace;
  font-size: 18px;
  font-weight: 600;
  margin-left: 8px;
`

const Path = styled.span`
  flex: 1;
  color: ${colors.muted};
  font-size: 12px;
`

const Stage = styled.main`
  flex: 1;
  position: relative;
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
  const [mode, setMode] = useState<Mode>('idle')
  const [folder, setFolder] = useState('')
  const [graph, setGraph] = useState<Graph | null>(null)
  const [progress, setProgress] = useState<ScanProgress>(ScanProgress.initial())
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [title, setTitle] = useState('ai-architect')
  const [nav, setNav] = useState({ back: false, fwd: false })
  const [editor, setEditor] = useState<EditorTarget | null>(null)

  const pending = useRef<View>({ type: 'project' })
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

  const applyView = async (v: View) => {
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

  const pickAndScan = async () => {
    const picked = await window.api.pickFolder()

    if (picked) {
      setFolder(picked)
      scanProject(picked)
    }
  }

  // openFile otwiera edytor pliku (opcjonalnie przewinięty do funkcji).
  const openFile = (absFile: string, fn?: string) => {
    setEditor({ path: absFile, gotoFn: fn })
  }

  // Dwuklik w węzeł: serwis → drill-down; encja (klasa/serwis/funkcja) → edytor pliku.
  const openNode = (node: Node) => {
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
        <Button size="small" startIcon={<ArrowBackIcon />} disabled={!nav.back} onClick={back}>
          Wstecz
        </Button>
        <Button size="small" startIcon={<ArrowForwardIcon />} disabled={!nav.fwd} onClick={forward}>
          Dalej
        </Button>
        <Brand>{title}</Brand>
        <Path>{folder}</Path>
        <Button variant="contained" size="small" startIcon={<FolderOpenIcon />} onClick={pickAndScan}>
          Wybierz projekt
        </Button>
      </TopBar>

      <Stage>
        {mode === 'graph' && graph ? (
          <GraphView graph={graph} onNodeDoubleClick={openNode} />
        ) : (
          <Empty>
            <h2>Wybierz folder projektu, aby zobaczyć graf</h2>
            {folder ? (
              <Button variant="outlined" onClick={() => scanProject(folder)}>
                Skanuj ostatni: {folder}
              </Button>
            ) : null}
          </Empty>
        )}
      </Stage>

      <ScanModal open={mode === 'scanning'} progress={progress} log={log} error={error} />
        <CodeEditor target={editor} onClose={() => setEditor(null)} />
      </Layout>
    </EditorContext.Provider>
  )
}
