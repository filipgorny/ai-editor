import { useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type ReactFlowInstance
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, MenuItem } from '@mui/material'
import { Graph, Node } from '../model'
import { kindColor } from '../styles/tokens'
import NodeCard from './NodeCard'
import TempCard from './TempCard'
import ContextMenu from './ContextMenu'

const nodeTypes = { entity: NodeCard, temp: TempCard }

type Pos = { x: number; y: number }
type Link = { from: string; to: string; kind: string }
type FileConvention = 'dash' | 'camel'

// baseName zwraca nazwę pliku bez katalogów i rozszerzenia (np. users.service).
function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? ''

  return file.replace(/\.[^.]+$/, '')
}

// Konwencję nazw (dash/camel) i rozszerzenie wykrywa serwis filer (przez gateway).

// classToFile zamienia nazwę klasy na nazwę pliku wg konwencji (dash / camel).
function classToFile(cls: string, conv: FileConvention): string {
  const words = cls
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)

  if (conv === 'dash') {
    return words.map((w) => w.toLowerCase()).join('-')
  }

  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('')
}

// estHeight szacuje wysokość klocka (nagłówek + lista funkcji ograniczona do 168px
// + stopka frameworka), by wiersze drzewka się nie nakładały.
function estHeight(n: Node | undefined): number {
  if (!n) {
    return 90
  }

  if (n.kind === 'folder') {
    return 58
  }

  const fns = n.functions.length
  const listH = fns > 0 ? Math.min(fns * 20 + 18, 168) : 0
  const footerH = n.framework ? 30 : 0

  return 70 + listH + footerH
}

// treeLayout układa węzły jak w eksploratorze plików: OD GÓRY W DÓŁ, każdy w
// swoim wierszu; subfoldery niżej i wcięte w prawo; foldery na górze.
function treeLayout(nodes: Node[], links: Link[]): Map<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const l of links) {
    if (l.kind !== 'contains') {
      continue
    }

    if (!children.has(l.from)) {
      children.set(l.from, [])
    }

    children.get(l.from)!.push(l.to)
    hasParent.add(l.to)
  }

  // Foldery na górę, potem alfabetycznie.
  const sortKids = (ids: string[]): string[] =>
    [...ids].sort((a, b) => {
      const na = byId.get(a)
      const nb = byId.get(b)
      const fa = na?.kind === 'folder' ? 0 : 1
      const fb = nb?.kind === 'folder' ? 0 : 1

      return fa !== fb ? fa - fb : (na?.name ?? a).localeCompare(nb?.name ?? b)
    })

  const pos = new Map<string, Pos>()
  const placed = new Set<string>()
  const indent = 300
  let y = 0

  const walk = (id: string, depth: number): void => {
    if (placed.has(id)) {
      return
    }

    placed.add(id)
    pos.set(id, { x: depth * indent, y })
    y += estHeight(byId.get(id)) + 36

    for (const c of sortKids(children.get(id) ?? [])) {
      walk(c, depth + 1)
    }
  }

  for (const n of nodes) {
    if (!hasParent.has(n.id)) {
      walk(n.id, 0)
    }
  }

  for (const n of nodes) {
    if (!placed.has(n.id)) {
      walk(n.id, 0)
    }
  }

  return pos
}

export default function GraphView({
  graph,
  onNodeClick,
  onNodeDoubleClick,
  onAddElement,
  onRename,
  onMoveFile,
  onDelete,
  focusPath,
  navKey
}: {
  graph: Graph
  onNodeClick?: (node: Node) => void
  onNodeDoubleClick?: (node: Node) => void
  onAddElement?: (name: string, file: string, kind: 'class' | 'function' | 'folder', targetDir?: string) => void
  onRename?: (node: Node, className: string, fileBase: string) => void
  onMoveFile?: (node: Node, targetDir: string) => void
  onDelete?: (node: Node, path: string) => void
  // ścieżka pliku, na który widok ma się przesunąć (np. świeżo dodany element)
  focusPath?: string
  // licznik nawigacji — zmiana = fit + reset rozwinięć (a nie cichy refresh)
  navKey?: number
}) {
  const { t } = useTranslation()
  // Rozwinięte foldery. Domyślnie tylko korzenie otwarte — reszta zwinięta.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Menu kontekstowe (prawy klik): na elemencie → „Zmień nazwę", na płótnie → „Dodaj element".
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node | null } | null>(null)
  // Dialog „Dodaj element".
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addFile, setAddFile] = useState('')
  const [addKind, setAddKind] = useState<'class' | 'function' | 'folder'>('class')
  // paleta szybkiego dodawania (dwuklik na płótnie)
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null)
  // pozycja (flow) gdzie pojawi się nowy element + węzły optymistyczne (od razu)
  const addFlowPos = useRef<{ x: number; y: number } | null>(null)
  const [localNodes, setLocalNodes] = useState<{ id: string; name: string; kind: string; x: number; y: number }[]>([])
  // ręczne przesunięcia węzłów (drag) — nadpisują pozycję z układu
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({})
  // Dialog „Zmień nazwę".
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [renameClass, setRenameClass] = useState('')
  const [renameFile, setRenameFile] = useState('')
  // Przepinanie kreski: po kliknięciu krawędzi „contains" linia czepia się myszki,
  // a klik na folderze przenosi plik do tego folderu.
  const [relink, setRelink] = useState<{ fileNode: Node } | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Wyszukiwarka (Ctrl+F): pole w lewym dolnym rogu.
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const findRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // ostatnia ścieżka, na którą przesunęliśmy widok (by nie powtarzać).
  const focusedPath = useRef('')

  // Konwencja i rozszerzenie pobierane z filera (przez gateway) dla danego katalogu.
  const [convention, setConvention] = useState<FileConvention>('dash')
  const [extension, setExtension] = useState('ts')

  const loadConventions = (dir: string) => {
    if (!dir) {
      return
    }

    window.api
      .fsConventions(dir)
      .then((c) => {
        setConvention(c.convention === 'camel' ? 'camel' : 'dash')
        setExtension(c.extension || 'ts')
      })
      .catch(() => undefined)
  }

  // katalog docelowy dla „Dodaj element" (gdy z menu folderu) — by powstał w nim.
  const [addDir, setAddDir] = useState<string | undefined>(undefined)

  // Mapa dziecko→rodzic (z krawędzi „contains") — do rozwijania przodków przy szukaniu.
  const parentOf = useMemo(() => {
    const m = new Map<string, string>()

    for (const d of graph.dependencies()) {
      if (d.kind === 'contains') {
        m.set(d.to, d.from)
      }
    }

    return m
  }, [graph])

  const byId = useMemo(() => new Map(graph.nodes().map((n) => [n.id, n])), [graph])

  // Mapa folder→katalog (na podstawie absolutnej ścieżki dzieci-plików folderu).
  const folderDir = useMemo(() => {
    const m = new Map<string, string>()

    for (const n of graph.nodes()) {
      if (!n.absFile) {
        continue
      }

      const parent = parentOf.get(n.id)

      if (parent && !m.has(parent)) {
        m.set(parent, n.absFile.replace(/[\\/][^\\/]+$/, ''))
      }
    }

    return m
  }, [graph, parentOf])

  // Katalog ROOTA bieżącego widoku (gdzie trafiają elementy dodane „w pustce").
  const rootNode = useMemo(() => {
    const nodes = graph.nodes()

    return nodes.find((n) => n.id === 'folder:.') || nodes.find((n) => n.kind === 'folder' && !parentOf.has(n.id))
  }, [graph, parentOf])

  const rootDir = rootNode?.file ?? ''
  const rootFolderId = rootNode?.id ?? ''

  // Usuń węzły optymistyczne, które re-skan już przyniósł jako prawdziwe (po nazwie).
  useEffect(() => {
    setLocalNodes((prev) => prev.filter((ln) => !graph.nodes().some((n) => n.name === ln.name)))
  }, [graph])

  // Zmiana sceny (inny projekt/app) — wyczyść węzły optymistyczne i przesunięcia.
  useEffect(() => {
    setLocalNodes([])
    setPosOverride({})
  }, [rootDir])

  // Reset rozwinięć TYLKO przy zmianie sceny (inny projekt/app) — przy zwykłym
  // odświeżeniu tego samego widoku zachowujemy otwarte foldery.
  const expandedScene = useRef(-1)

  useEffect(() => {
    const k = navKey ?? 0

    if (expandedScene.current === k) {
      return // brak nawigacji = odświeżenie → nie zwijaj rozwiniętych folderów
    }

    expandedScene.current = k

    const hasParent = new Set<string>()

    for (const d of graph.dependencies()) {
      if (d.kind === 'contains') {
        hasParent.add(d.to)
      }
    }

    const roots = graph
      .nodes()
      .filter((n) => !hasParent.has(n.id))
      .map((n) => n.id)

    setExpanded(new Set(roots))
  }, [graph, navKey])

  const { rfNodes, rfEdges } = useMemo(() => {
    const all = graph.nodes()
    const byId = new Map(all.map((n) => [n.id, n]))
    const children = new Map<string, string[]>()
    const hasParent = new Set<string>()

    for (const d of graph.dependencies()) {
      if (d.kind !== 'contains') {
        continue
      }

      if (!children.has(d.from)) {
        children.set(d.from, [])
      }

      children.get(d.from)!.push(d.to)
      hasParent.add(d.to)
    }

    // Widoczne: korzenie + potomkowie pod rozwiniętymi folderami.
    const visible = new Set<string>()

    const reveal = (id: string): void => {
      if (visible.has(id)) {
        return
      }

      visible.add(id)
      const n = byId.get(id)

      if (n && n.kind === 'folder' && expanded.has(id)) {
        for (const c of children.get(id) ?? []) {
          reveal(c)
        }
      }
    }

    for (const n of all) {
      if (!hasParent.has(n.id)) {
        reveal(n.id)
      }
    }

    const visNodes = all.filter((n) => visible.has(n.id))
    const containsLinks = graph
      .dependencies()
      .filter((d) => d.kind === 'contains' && visible.has(d.from) && visible.has(d.to))
      .map((d) => ({ from: d.from, to: d.to, kind: d.kind }))

    const pos = treeLayout(visNodes, containsLinks)

    const seenN = new Set<string>()
    const nodes: RFNode[] = visNodes
      .filter((n) => (seenN.has(n.id) ? false : seenN.add(n.id)))
      .map((n) => ({ id: n.id, type: 'entity', position: pos.get(n.id) ?? { x: 0, y: 0 }, data: n }))

    const seenE = new Set<string>()
    const edges: RFEdge[] = graph
      .dependencies()
      .filter((d) => visible.has(d.from) && visible.has(d.to))
      .filter((d) => (seenE.has(d.id) ? false : seenE.add(d.id)))
      .map((d) => {
        const isTree = d.kind === 'contains'

        return {
          id: d.id,
          source: d.from,
          target: d.to,
          label: isTree ? undefined : d.kind,
          animated: d.isInjection(),
          data: { kind: d.kind },
          // krawędzie drzewa (folder→plik) są klikalne (przepięcie do innego folderu)
          interactionWidth: isTree ? 20 : 0,
          style: isTree ? { stroke: '#30363d', cursor: 'pointer' } : undefined,
          markerEnd: isTree ? undefined : { type: MarkerType.ArrowClosed }
        }
      })

    return { rfNodes: nodes, rfEdges: edges }
  }, [graph, expanded])

  // Doklej węzły optymistyczne (świeżo dodane, jeszcze przed re-skanem).
  const mergedNodes = useMemo(
    () => [
      ...rfNodes.map((n) => (posOverride[n.id] ? { ...n, position: posOverride[n.id] } : n)),
      ...localNodes.map((ln) => ({
        id: ln.id,
        type: 'temp',
        position: posOverride[ln.id] ?? { x: ln.x, y: ln.y },
        data: { name: ln.name, kind: ln.kind }
      }))
    ],
    [rfNodes, localNodes, posOverride]
  )

  const mergedEdges = useMemo(
    () =>
      rootFolderId
        ? [
            ...rfEdges,
            ...localNodes.map((ln) => ({
              id: 'e:' + ln.id,
              source: rootFolderId,
              target: ln.id,
              style: { stroke: '#30363d', strokeDasharray: '4 4' }
            }))
          ]
        : rfEdges,
    [rfEdges, localNodes, rootFolderId]
  )

  // Po zmianie widoku (drill w serwis / powrót) wyśrodkuj na root, żeby nie
  // trzeba było szukać nodów.
  const flow = useRef<ReactFlowInstance | null>(null)
  const focusOnExpand = useRef<string[] | null>(null)

  // Fit TYLKO przy zmianie sceny (inny projekt/app), nie przy samym odświeżeniu
  // tego samego widoku — wtedy widok zostaje na miejscu.
  const fittedFor = useRef(-1)

  useEffect(() => {
    const k = navKey ?? 0

    if (fittedFor.current === k) {
      return // brak nawigacji = tylko odświeżenie → nie ruszaj widoku
    }

    fittedFor.current = k
    const t = window.setTimeout(async () => {
      const inst = flow.current

      if (!inst) {
        return
      }

      // restore saved viewport for this scene (Postgres via designer), else fit
      const vp = rootDir ? await window.api.getViewport(rootDir) : null

      if (vp) {
        inst.setViewport(vp, { duration: 350 })
      } else {
        inst.fitView({ padding: 0.25, duration: 350 })
      }
    }, 60)

    return () => window.clearTimeout(t)
  }, [graph, navKey])

  // flashNode mignie węzłem raz (po przesunięciu na niego widoku, np. z wyszukiwarki).
  const flashNode = (id: string) => {
    const el = wrapRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)

    if (el) {
      el.classList.remove('rf-flash')
      void (el as HTMLElement).offsetWidth // reflow → restart animacji
      el.classList.add('rf-flash')
    }
  }

  // Po rozwinięciu folderu PRZESUŃ widok do pierwszego dziecka (bez zoom-out).
  useEffect(() => {
    if (!focusOnExpand.current) {
      return
    }

    const ids = focusOnExpand.current
    focusOnExpand.current = null

    const t = window.setTimeout(() => {
      const inst = flow.current

      if (!inst) {
        return
      }

      // ids[0] = folder; reszta = dzieci. Wybierz WIZUALNIE najwyższe (min y),
      // bo kolejność zależności ≠ kolejność w drzewku (stąd „przesuwało pod spód").
      let target: { id: string; y: number; x: number } | undefined

      for (const id of ids.slice(1)) {
        const n = inst.getNode(id)

        if (n && (!target || n.position.y < target.y)) {
          target = { id, y: n.position.y, x: n.position.x }
        }
      }

      if (target) {
        const zoom = inst.getViewport().zoom
        inst.setCenter(target.x + 140, target.y + 30, { zoom, duration: 350 })
        flashNode(target.id)
      }
    }, 60)

    return () => window.clearTimeout(t)
  }, [rfNodes])

  // Po pojawieniu się w grafie pliku z focusPath (np. świeżo dodanego) — rozwiń
  // przodków i przesuń na niego widok.
  useEffect(() => {
    if (!focusPath || focusedPath.current === focusPath) {
      return
    }

    const match = graph.nodes().find((n) => n.absFile === focusPath)

    if (!match) {
      return
    }

    focusedPath.current = focusPath
    const ancestors: string[] = []
    let cur = parentOf.get(match.id)

    while (cur) {
      ancestors.push(cur)
      cur = parentOf.get(cur)
    }

    focusOnExpand.current = [match.id, match.id]
    setExpanded((prev) => new Set([...prev, ...ancestors]))
  }, [graph, focusPath, parentOf])

  // Klik w folder = rozwiń/zwiń; inne węzły → propaguj wyżej.
  const handleClick = (node: Node) => {
    setPalette(null) // klik w node zamyka paletę/menu dodawania
    setMenu(null)

    // Tryb przepinania: klik na folderze = przenieś tam plik; klik gdzie indziej anuluje.
    if (relink) {
      if (node.kind === 'folder') {
        const dir = node.file || folderDir.get(node.id)

        if (dir) {
          onMoveFile?.(relink.fileNode, dir)
        }
      }

      setRelink(null)

      return
    }

    if (node.kind === 'folder') {
      const willExpand = !expanded.has(node.id)

      if (willExpand) {
        const kids = graph
          .dependencies()
          .filter((d) => d.kind === 'contains' && d.from === node.id)
          .map((d) => d.to)

        // po rozwinięciu przesuń widok na pierwsze dziecko
        focusOnExpand.current = [node.id, ...kids]
      }

      setExpanded((prev) => {
        const next = new Set(prev)

        if (next.has(node.id)) {
          next.delete(node.id)
        } else {
          next.add(node.id)
        }

        return next
      })

      return
    }

    onNodeClick?.(node)
  }

  // searchAndPan: znajdź element z pasującą nazwą, rozwiń przodków i przesuń widok.
  const searchAndPan = (text: string) => {
    const q = text.trim().toLowerCase()

    if (!q) {
      return
    }

    const match = graph.nodes().find((n) => n.kind !== 'folder' && n.name.toLowerCase().includes(q))

    if (!match) {
      return
    }

    const ancestors: string[] = []
    let cur = parentOf.get(match.id)

    while (cur) {
      ancestors.push(cur)
      cur = parentOf.get(cur)
    }

    // ids[1] = węzeł docelowy → efekt po przeliczeniu układu przesunie do niego.
    focusOnExpand.current = [match.id, match.id]
    setExpanded((prev) => new Set([...prev, ...ancestors]))
  }

  // Ctrl/Cmd+F → otwórz wyszukiwarkę (gdy nie ma otwartego edytora/dialogu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (document.querySelector('.MuiDialog-root')) {
          return
        }

        e.preventDefault()
        setFindOpen(true)
        setTimeout(() => findRef.current?.focus(), 0)
      }

      if (e.key === 'Escape') {
        setFindOpen(false)
        setMenu(null)
        setRelink(null)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // katalog dowolnego pliku w projekcie (fallback dla wykrycia konwencji).
  const anyProjectDir = (): string => {
    const withFile = graph.nodes().find((n) => n.absFile)

    return withFile ? withFile.absFile.replace(/[\\/][^\\/]+$/, '') : ''
  }

  // Otwarcie dialogu „Dodaj element".
  const openAdd = (dir?: string, kind: 'class' | 'function' | 'folder' = 'class') => {
    setMenu(null)
    setPalette(null)
    setAddName('')
    setAddFile('')
    setAddKind(kind)
    setAddDir(dir)
    loadConventions(dir || anyProjectDir())
    setAddOpen(true)
  }

  // Usuń element — plik (absFile) lub folder (katalog z mapy folderDir).
  const removeNode = (node: Node) => {
    setMenu(null)
    const path = node.kind === 'folder' ? node.file || folderDir.get(node.id) : node.absFile

    if (path) {
      onDelete?.(node, path)
    }
  }

  // Otwarcie dialogu „Zmień nazwę" — prefill nazwą klasy i nazwą pliku.
  const openRename = (node: Node) => {
    setMenu(null)
    setRenameNode(node)
    setRenameClass(node.name)
    setRenameFile(baseName(node.file || node.absFile))
    loadConventions(node.absFile ? node.absFile.replace(/[\\/][^\\/]+$/, '') : anyProjectDir())
  }

  const confirmAdd = () => {
    const name = addName.trim()

    if (name) {
      const base = addFile.trim() || classToFile(name, convention)

      if (addKind === 'folder') {
        onAddElement?.(name, base, 'folder', addDir)
      } else {
        onAddElement?.(name, base + '.' + extension, addKind, addDir)
      }

      // węzeł optymistyczny — pojawia się OD RAZU w miejscu kliknięcia
      const pos = addFlowPos.current ?? { x: 0, y: 0 }
      setLocalNodes((prev) => [...prev, { id: 'local:' + name + ':' + pos.x, name, kind: addKind, x: pos.x, y: pos.y }])
    }

    setAddOpen(false)
  }

  const confirmRename = () => {
    if (renameNode && renameClass.trim()) {
      onRename?.(renameNode, renameClass.trim(), renameFile.trim() || classToFile(renameClass.trim(), convention))
    }

    setRenameNode(null)
  }

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onClick={() => menu && setMenu(null)}
      onDoubleClick={(e) => {
        // dwuklik w puste płótno → paleta dodawania (zapamiętaj pozycję flow)
        if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
          const rect = wrapRef.current?.getBoundingClientRect()
          const vp = flow.current?.getViewport()

          if (rect && vp) {
            addFlowPos.current = {
              x: (e.clientX - rect.left - vp.x) / vp.zoom,
              y: (e.clientY - rect.top - vp.y) / vp.zoom
            }
          }

          setPalette({ x: e.clientX, y: e.clientY })
        }
      }}
      onMouseMove={(e) => relink && setMouse({ x: e.clientX, y: e.clientY })}
    >
    <ReactFlow
      nodes={mergedNodes}
      edges={mergedEdges}
      nodeTypes={nodeTypes}
      fitView
      nodesDraggable
      onNodesChange={(changes) => {
        setPosOverride((prev) => {
          let next = prev

          for (const c of changes) {
            if (c.type === 'position' && c.position) {
              if (next === prev) {
                next = { ...prev }
              }

              next[c.id] = c.position
            }
          }

          return next
        })
      }}
      nodesConnectable={false}
      minZoom={0.05}
      zoomOnScroll
      panOnScroll={false}
      proOptions={{ hideAttribution: true }}
      onInit={(inst) => (flow.current = inst)}
      onPaneClick={() => {
        setMenu(null)
        setPalette(null) // pojedynczy klik chowa paletę / anuluje
        setRelink(null)
      }}
      onMoveEnd={(_e, vp) => {
        // persist viewport for this scene (Postgres via designer)
        if (rootDir) {
          window.api.saveViewport(rootDir, vp)
        }
      }}
      zoomOnDoubleClick={false}
      edgeUpdaterRadius={14}
      onEdgeClick={(e, edge) => {
        if ((edge.data as { kind?: string })?.kind !== 'contains') {
          return
        }

        // Odczepiamy koniec od RODZICA (folderu); koniec przy DZIECKU (pliku, target)
        // zostaje — tam kotwiczymy linię, a wolny koniec idzie za myszką.
        const file = byId.get(edge.target)

        if (!file?.absFile) {
          return
        }

        const rfn = flow.current?.getNode(edge.target)
        const vp = flow.current?.getViewport()
        const rect = wrapRef.current?.getBoundingClientRect()

        if (rfn && vp && rect) {
          setAnchor({
            x: rfn.position.x * vp.zoom + vp.x + rect.left,
            y: (rfn.position.y + 28) * vp.zoom + vp.y + rect.top
          })
        } else {
          setAnchor({ x: e.clientX, y: e.clientY })
        }

        setRelink({ fileNode: file })
        setMouse({ x: e.clientX, y: e.clientY })
      }}
      onEdgeUpdate={(oldEdge, conn) => {
        // przeciągnięcie końca linii „contains" na inny folder → przenieś plik
        const a = conn.source ? byId.get(conn.source) : undefined
        const b = conn.target ? byId.get(conn.target) : undefined
        const file = a?.absFile ? a : b?.absFile ? b : undefined
        const folder = a?.kind === 'folder' ? a : b?.kind === 'folder' ? b : undefined

        if (file && folder) {
          const dir = folder.file || folderDir.get(folder.id)

          if (dir) {
            onMoveFile?.(file, dir)
          }
        }

        void oldEdge
      }}
      onNodeClick={(_e, n) => handleClick(n.data as Node)}
      onNodeDoubleClick={(_e, n) => onNodeDoubleClick?.(n.data as Node)}
      onNodeContextMenu={(e, n) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, node: n.data as Node })
      }}
      onPaneContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, node: null })
      }}
    >
      <Background color="#21262d" gap={20} />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(0,0,0,0.55)"
        maskStrokeColor="#ffffff"
        maskStrokeWidth={2}
        nodeColor={(n) => kindColor[(n.data as Node)?.kind] ?? '#8b949e'}
        style={{ backgroundColor: '#0d1117' }}
      />
      <Controls />
    </ReactFlow>

    {relink && (
      <>
        <svg style={{ position: 'fixed', inset: 0, zIndex: 25, pointerEvents: 'none' }}>
          <line
            x1={anchor.x}
            y1={anchor.y}
            x2={mouse.x}
            y2={mouse.y}
            stroke="#f2cc60"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        </svg>
        <div
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 26,
            background: '#161b22',
            border: '1px solid #f2cc60',
            color: '#f2cc60',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 13,
            pointerEvents: 'none'
          }}
        >
          {t('graph.relinkHint', { name: relink.fileNode.name })}
        </div>
      </>
    )}

    {palette && (
      <ContextMenu
        x={palette.x}
        y={palette.y}
        onClose={() => setPalette(null)}
        items={[
          { label: `🟥  ${t('graph.class')}`, onClick: () => openAdd(rootDir, 'class') },
          { label: `λ  ${t('graph.function')}`, onClick: () => openAdd(rootDir, 'function') },
          { label: `📁  ${t('graph.folder')}`, onClick: () => openAdd(rootDir, 'folder') }
        ]}
      />
    )}

    {menu && (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu(null)}
        items={
          !menu.node
            ? [{ label: t('graph.addElement'), onClick: () => openAdd(rootDir) }]
            : menu.node.kind === 'folder'
              ? [
                  { label: t('graph.addElement'), onClick: () => openAdd(menu.node!.file || folderDir.get(menu.node!.id)) },
                  { label: t('graph.rename'), onClick: () => openRename(menu.node!) },
                  { label: t('graph.deleteElement'), onClick: () => removeNode(menu.node!) }
                ]
              : [
                  // „Edytuj" jako pierwsza opcja — tylko gdy węzeł ma plik (edytowalny).
                  ...(menu.node.absFile
                    ? [{ label: t('graph.edit'), onClick: () => onNodeClick?.(menu.node!) }]
                    : []),
                  { label: t('graph.rename'), onClick: () => openRename(menu.node!) },
                  { label: t('graph.deleteElement'), onClick: () => removeNode(menu.node!) }
                ]
        }
      />
    )}

    {findOpen && (
      <input
        ref={findRef}
        placeholder={t('graph.searchElement')}
        value={findText}
        onChange={(e) => {
          setFindText(e.target.value)

          // search only once at least 3 characters are typed
          if (e.target.value.trim().length >= 3) {
            searchAndPan(e.target.value)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && findText.trim().length >= 3) {
            searchAndPan(findText)
          }

          if (e.key === 'Escape') {
            setFindOpen(false)
          }
        }}
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 20,
          width: 240,
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #d0d7de',
          background: '#fff',
          color: '#111',
          fontSize: 13,
          fontFamily: 'monospace',
          outline: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.5)'
        }}
      />
    )}

    <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('graph.addElement')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          select
          label={t('graph.type')}
          size="small"
          value={addKind}
          onChange={(e) => setAddKind(e.target.value as 'class' | 'function' | 'folder')}
        >
          <MenuItem value="class">{t('graph.class')}</MenuItem>
          <MenuItem value="function">{t('graph.function')}</MenuItem>
          <MenuItem value="folder">{t('graph.folder')}</MenuItem>
        </TextField>
        <TextField
          autoFocus
          label={addKind === 'folder' ? t('graph.folderName') : addKind === 'function' ? t('graph.functionName') : t('graph.className')}
          size="small"
          value={addName}
          onChange={(e) => {
            setAddName(e.target.value)
            setAddFile(classToFile(e.target.value, convention))
          }}
          onKeyDown={(e) => e.key === 'Enter' && confirmAdd()}
        />
        <TextField
          label={addKind === 'folder' ? t('graph.dirName') : t('graph.fileName')}
          size="small"
          value={addFile}
          onChange={(e) => setAddFile(e.target.value)}
          helperText={
            addKind === 'folder'
              ? convention === 'dash'
                ? 'dash-case'
                : 'camelCase'
              : `.${extension} • ${convention === 'dash' ? 'dash-case' : 'camelCase'}`
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={confirmAdd}>
          {t('graph.add')}
        </Button>
      </DialogActions>
    </Dialog>

    <Dialog open={!!renameNode} onClose={() => setRenameNode(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('graph.rename')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          autoFocus
          label={t('graph.className')}
          size="small"
          value={renameClass}
          onChange={(e) => {
            setRenameClass(e.target.value)
            setRenameFile(classToFile(e.target.value, convention))
          }}
          onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
        />
        <TextField
          label={t('graph.fileName')}
          size="small"
          value={renameFile}
          onChange={(e) => setRenameFile(e.target.value)}
          helperText={`.${extension} • ${convention === 'dash' ? 'dash-case' : 'camelCase'}`}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setRenameNode(null)}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={confirmRename}>
          {t('graph.change')}
        </Button>
      </DialogActions>
    </Dialog>
    </div>
  )
}
