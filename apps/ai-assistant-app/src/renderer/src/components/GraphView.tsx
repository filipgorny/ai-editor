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
import { appBus } from '../events'
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, MenuItem } from '@mui/material'
import { AppNode, Graph, Node } from '../model'
import { kindColor } from '../styles/tokens'
import NodeCard from './NodeCard'
import TempCard from './TempCard'
import NodeContextMenu from './NodeContextMenu'

const nodeTypes = { entity: NodeCard, temp: TempCard }

type Pos = { x: number; y: number }
type Link = { from: string; to: string; kind: string }
type FileConvention = 'dash' | 'camel'

// Pseudo-project key under which per-node AI descriptions are persisted (reusing the
// existing scripts store — same pattern as browser macros). The script name is the
// node id, the content is the free-text description that helps the AI generate code.
const DESC_PROJECT = '__descriptions__'

// loadDescription reads a node's persisted AI description (empty string when none).
async function loadDescription(nodeId: string): Promise<string> {
  const list = await window.api.listScripts(DESC_PROJECT).catch(() => [] as Script[])
  const hit = list.find((s) => s.name === nodeId)

  return hit?.content ?? ''
}

// saveDescription upserts a node's AI description in the scripts store.
async function saveDescription(nodeId: string, text: string): Promise<void> {
  const list = await window.api.listScripts(DESC_PROJECT).catch(() => [] as Script[])
  const existing = list.find((s) => s.name === nodeId)

  await window.api
    .saveScript({ id: existing?.id, name: nodeId, content: text, project: DESC_PROJECT })
    .catch(() => undefined)
}

// detectImplemented decides whether a class/function file already has REAL code (vs an
// empty auto-created stub). The scanner only reports method NAMES, so we read the file
// and look for a non-trivial body inside the entity's braces — an empty class/function
// (only declarations, `{}`, or `// TODO`) counts as NOT implemented, enabling code gen.
// Exported so NodeCard can show the same implemented/stub badge on the diagram.
export async function detectImplemented(node: Node): Promise<boolean> {
  if (!node.absFile) {
    return false
  }

  const src = await window.api.readFile(node.absFile).catch(() => '')

  if (!src.trim()) {
    return false
  }

  // Strip comments + whitespace so a stub padded with TODOs still reads as empty.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/#[^\n]*/g, '')

  // Bodies of any { ... } block in the file; if every block is empty the entity is a stub.
  const bodies: string[] = stripped.match(/\{([\s\S]*?)\}/g) ?? []
  const hasFilledBody = bodies.some((b) => b.replace(/[{}]/g, '').trim().length > 0)

  if (hasFilledBody) {
    return true
  }

  // No braces at all (e.g. an arrow/expression export) → treat any real statement as code.
  const meaningful = stripped.replace(/\s+/g, '').replace(/[{}();,]/g, '')

  return meaningful.length > 24
}

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
  onExpandApp,
  wallpaper,
  focusPath,
  navKey,
  selectedId,
  onSelect
}: {
  graph: Graph
  onNodeClick?: (node: Node) => void
  onNodeDoubleClick?: (node: Node) => void
  onExpandApp?: (appId: number) => void
  wallpaper?: string
  onAddElement?: (name: string, file: string, kind: 'class' | 'function' | 'folder', targetDir?: string) => void
  onRename?: (node: Node, className: string, fileBase: string) => void
  onMoveFile?: (node: Node, targetDir: string) => void
  onDelete?: (node: Node, path: string) => void
  // ścieżka pliku, na który widok ma się przesunąć (np. świeżo dodany element)
  focusPath?: string
  // licznik nawigacji — zmiana = fit + reset rozwinięć (a nie cichy refresh)
  navKey?: number
  // id ostatnio wybranego węzła (podświetlenie) + callback wyboru
  selectedId?: string
  onSelect?: (node: Node) => void
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
  // pozycja (flow) gdzie pojawi się nowy element + węzły optymistyczne (od razu)
  const addFlowPos = useRef<{ x: number; y: number } | null>(null)
  const addParentId = useRef<string | null>(null) // node the new element hangs under
  const [localNodes, setLocalNodes] = useState<
    { id: string; name: string; kind: string; x: number; y: number; parentId: string; absFile?: string; file?: string }[]
  >([])
  // ręczne przesunięcia węzłów (drag) — nadpisują pozycję z układu
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({})
  // Dialog „Zmień nazwę".
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [renameClass, setRenameClass] = useState('')
  const [renameFile, setRenameFile] = useState('')
  // Code-diagram (item 1) state. Implementation status per node id — drives whether
  // "Generate code" is enabled (true = already has real code) and the card badge.
  const [implStatus, setImplStatus] = useState<Record<string, boolean>>({})
  // Whether a node has a persisted AI description (drives the menu label + card hint).
  const [descStatus, setDescStatus] = useState<Record<string, boolean>>({})
  // „Edytuj metody" dialog — one method name per line.
  const [methodsNode, setMethodsNode] = useState<Node | null>(null)
  const [methodsText, setMethodsText] = useState('')
  // „Opis dla AI" dialog.
  const [descNode, setDescNode] = useState<Node | null>(null)
  const [descText, setDescText] = useState('')
  // Set of node ids whose code is being (re)generated — disables the dialog/menu.
  const [genBusy, setGenBusy] = useState<Set<string>>(new Set())
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
  // Katalog sceny, dla której odtworzono już rozwinięcia (bramkuje zapis, by nie
  // nadpisać świeżo wczytanego stanu domyślnym przy montażu).
  const expandReady = useRef('')

  useEffect(() => {
    const k = navKey ?? 0

    if (expandedScene.current === k) {
      return // brak nawigacji = odświeżenie → nie zwijaj rozwiniętych folderów
    }

    expandedScene.current = k
    expandReady.current = ''

    const hasParent = new Set<string>()

    for (const d of graph.dependencies()) {
      if (d.kind === 'contains') {
        hasParent.add(d.to)
      }
    }

    const validIds = new Set(graph.nodes().map((n) => n.id))
    const roots = graph
      .nodes()
      .filter((n) => !hasParent.has(n.id))
      .map((n) => n.id)

    const dir = rootDir
    let cancelled = false

    const apply = (ids: string[]): void => {
      if (cancelled) {
        return
      }

      setExpanded(new Set(ids.filter((id) => validIds.has(id))))
      expandReady.current = dir
    }

    // Odtwórz zapamiętane rozwinięcia drzewa dla tej sceny (SQLite per katalog projektu/app);
    // brak zapisu → domyślnie otwarte tylko korzenie.
    if (dir && typeof window.api.getState === 'function') {
      window.api
        .getState<string[]>('graph:expanded:' + dir)
        .then((saved) => apply(saved && saved.length ? saved : roots))
        .catch(() => apply(roots))
    } else {
      apply(roots)
    }

    return () => {
      cancelled = true
    }
  }, [graph, navKey])

  // Zapisz rozwinięcia drzewa dla bieżącej sceny (odroczony zapis do SQLite). Bramkowane
  // przez expandReady, by domyślne korzenie nie nadpisały świeżo wczytanego stanu.
  useEffect(() => {
    const dir = rootDir

    if (!dir || expandReady.current !== dir || typeof window.api.setState !== 'function') {
      return
    }

    const id = window.setTimeout(() => {
      window.api.setState('graph:expanded:' + dir, [...expanded])
    }, 500)

    return () => window.clearTimeout(id)
  }, [expanded, rootDir])

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

      // folders AND apps reveal their children when expanded (apps expand inline)
      if (n && (n.kind === 'folder' || n.kind === 'app') && expanded.has(id)) {
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
      ...rfNodes.map((n) => ({
        ...n,
        ...(posOverride[n.id] ? { position: posOverride[n.id] } : {}),
        selected: n.id === selectedId
      })),
      ...localNodes.map((ln) => ({
        id: ln.id,
        type: 'temp',
        position: posOverride[ln.id] ?? { x: ln.x, y: ln.y },
        selected: ln.id === selectedId,
        data: { id: ln.id, name: ln.name, kind: ln.kind, absFile: ln.absFile, file: ln.file }
      }))
    ],
    [rfNodes, localNodes, posOverride, selectedId]
  )

  const mergedEdges = useMemo(
    () => [
      ...rfEdges,
      // connect each optimistic node to its parent folder/app (fallback: root)
      ...localNodes
        .map((ln) => ({ ln, source: ln.parentId || rootFolderId }))
        .filter(({ source }) => !!source)
        .map(({ ln, source }) => ({
          id: 'e:' + ln.id,
          source,
          target: ln.id,
          style: { stroke: '#30363d', strokeDasharray: '4 4' }
        }))
    ],
    [rfEdges, localNodes, rootFolderId]
  )

  // Po zmianie widoku (drill w serwis / powrót) wyśrodkuj na root, żeby nie
  // trzeba było szukać nodów.
  const flow = useRef<ReactFlowInstance | null>(null)
  const focusOnExpand = useRef<string[] | null>(null)
  // app id whose expansion should re-fit (center + zoom out) once its internals load
  const fitAfterExpand = useRef<string | null>(null)

  // Fit TYLKO przy zmianie sceny (inny projekt/app), nie przy samym odświeżeniu
  // tego samego widoku — wtedy widok zostaje na miejscu.
  const fittedFor = useRef(-1)
  // The very first load always centers the whole graph (fitView), ignoring any saved
  // viewport — later navigations restore the saved viewport per scene.
  const didInitialFit = useRef(false)
  // Czy użytkownik sam przesuwał/zoomował widok (realne wheel/pointer, nie programowy fit).
  // Gdy tak — przy odświeżeniu NIE ruszamy kamery; inaczej dopasowujemy ją do całości.
  const userMoved = useRef(false)

  // Reset „user moved" przy zmianie sceny — nowa scena ma być dopasowana do całości.
  useEffect(() => {
    userMoved.current = false
  }, [navKey])

  // Wykryj realny ruch usera (zoom kółkiem / pan myszą po tle) — odróżnia od fitView/setViewport.
  useEffect(() => {
    const el = wrapRef.current

    if (!el) {
      return
    }

    const onWheel = (): void => {
      userMoved.current = true
    }

    const onPointerDown = (e: PointerEvent): void => {
      if ((e.target as HTMLElement).closest('.react-flow__pane')) {
        userMoved.current = true
      }
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  useEffect(() => {
    const k = navKey ?? 0
    const sceneChange = fittedFor.current !== k
    fittedFor.current = k

    const t = window.setTimeout(async () => {
      const inst = flow.current

      if (!inst) {
        return
      }

      // On the first load, center the whole graph regardless of any saved viewport.
      if (!didInitialFit.current) {
        didInitialFit.current = true
        inst.fitView({ padding: 0.2, duration: 350 })

        return
      }

      if (sceneChange) {
        // restore saved viewport for this scene (Postgres via designer), else fit
        const vp = rootDir ? await window.api.getViewport(rootDir) : null

        if (vp) {
          inst.setViewport(vp, { duration: 350 })
        } else {
          inst.fitView({ padding: 0.25, duration: 350 })
        }

        return
      }

      // Samo odświeżenie tej samej sceny (np. dodany węzeł): dopasuj kamerę do całości,
      // by wszystko było widoczne — chyba że user sam przesuwał widok albo trwa
      // focus/expand (te mają własną obsługę kamery).
      if (!userMoved.current && !fitAfterExpand.current && !focusOnExpand.current) {
        inst.fitView({ padding: 0.2, duration: 350 })
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

  // Po rozwinięciu APLIKACJI wycentruj i oddal widok, by zmieścił cały graf —
  // czeka, aż wewnętrzne węzły aplikacji się doładują (skan jest asynchroniczny).
  useEffect(() => {
    const id = fitAfterExpand.current

    if (!id) {
      return
    }

    const inst = flow.current

    if (!inst) {
      return
    }

    // Czekaj, aż dzieci aplikacji pojawią się w grafie (inaczej dopasujemy za wcześnie).
    const hasKids = graph.dependencies().some((d) => d.kind === 'contains' && d.from === id)

    if (!inst.getNode(id) || !hasKids) {
      return
    }

    fitAfterExpand.current = null
    const t = window.setTimeout(() => flow.current?.fitView({ padding: 0.2, duration: 400 }), 80)

    return () => window.clearTimeout(t)
  }, [rfNodes, graph])

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

  // Pojedynczy klik = TYLKO zaznaczenie (lub akcja przepinania). Rozwijanie
  // drzewka i otwieranie pliku w edytorze przeniesione na dwuklik (handleDoubleClick).
  const handleClick = (node: Node) => {
    setMenu(null) // clicking a node closes any open context menu
    onSelect?.(node) // mark as selected (highlight + AI context)

    // Tryb przepinania: klik na folderze = przenieś tam plik; klik gdzie indziej anuluje.
    if (relink) {
      if (node.kind === 'folder') {
        const dir = node.file || folderDir.get(node.id)

        if (dir) {
          onMoveFile?.(relink.fileNode, dir)
        }
      }

      setRelink(null)
    }
  }

  // toggleExpand rozwija/zwija drzewko dzieci folderu lub aplikacji.
  const toggleExpand = (node: Node) => {
    const willExpand = !expanded.has(node.id)
    const kids = graph
      .dependencies()
      .filter((d) => d.kind === 'contains' && d.from === node.id)
      .map((d) => d.to)

    if (willExpand) {
      if (node.kind === 'app') {
        if (kids.length === 0 && node instanceof AppNode) {
          onExpandApp?.(node.appId) // not loaded yet → fetch + merge its internals
        }

        // expanding an app: center + zoom out to fit the whole graph (once internals load)
        fitAfterExpand.current = node.id
      } else {
        // expanding a folder: move the view to the first child
        focusOnExpand.current = [node.id, ...kids]
      }
    }

    appBus.emit('graph:folder-toggle', { id: node.id, expanded: willExpand })
    setExpanded((prev) => {
      const next = new Set(prev)

      if (next.has(node.id)) {
        next.delete(node.id)
      } else {
        next.add(node.id)
      }

      return next
    })
  }

  // Dwuklik = aktywacja: folder/aplikacja rozwija drzewko dzieci, plik otwiera edytor.
  const handleDoubleClick = (node: Node) => {
    setMenu(null)
    onSelect?.(node) // also mark as selected (highlight + AI context)

    // W trybie przepinania dwuklik nie aktywuje (klik już to obsłużył).
    if (relink) {
      return
    }

    // Folders and apps expand/collapse in place. An app loads its internal graph
    // (onExpandApp) the first time it's expanded — the monorepo stays visible.
    if (node.kind === 'folder' || node.kind === 'app') {
      toggleExpand(node)

      return
    }

    appBus.emit('graph:node-click', { id: node.id, kind: node.kind })
    onNodeClick?.(node)
  }

  // searchAndPan: znajdź element z pasującą nazwą, rozwiń przodków i przesuń widok.
  const searchAndPan = (text: string) => {
    const q = text.trim().toLowerCase()

    if (!q) {
      return
    }

    // search across all node kinds — folders, apps, classes, functions…
    const match = graph.nodes().find((n) => n.name.toLowerCase().includes(q))

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
        // toggle: second Ctrl+F closes the search field
        setFindOpen((v) => {
          if (!v) {
            setTimeout(() => findRef.current?.focus(), 0)
          }

          return !v
        })
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

  // Open the "Add element" dialog. For folders/apps the target dir is their own.
  // `parent` is the node the new element will hang under (optimistic placement).
  const openAdd = (dir?: string, kind: 'class' | 'function' | 'folder' = 'class', parent?: Node) => {
    setMenu(null)
    setAddName('')
    setAddFile('')
    setAddKind(kind)
    setAddDir(dir)
    addParentId.current = parent?.id ?? null
    loadConventions(dir || anyProjectDir())
    setAddOpen(true)
  }

  // target directory when adding into a folder/app node
  const addTargetDir = (node: Node): string | undefined => node.file || folderDir.get(node.id)

  // Usuń element — plik (absFile) lub folder (katalog z mapy folderDir).
  const removeNode = (node: Node) => {
    setMenu(null)
    const path = node.kind === 'folder' ? node.file || folderDir.get(node.id) : node.absFile

    if (!path) {
      return
    }

    // Drop the optimistic node immediately (it may have no real-node counterpart).
    setLocalNodes((prev) => prev.filter((ln) => ln.id !== node.id))
    onDelete?.(node, path)
  }

  // Otwarcie dialogu „Zmień nazwę" — prefill nazwą klasy i nazwą pliku.
  const openRename = (node: Node) => {
    setMenu(null)
    setRenameNode(node)
    setRenameClass(node.name)
    setRenameFile(baseName(node.file || node.absFile))
    loadConventions(node.absFile ? node.absFile.replace(/[\\/][^\\/]+$/, '') : anyProjectDir())
  }

  // Resolve implementation + description status when a code node's menu opens, so the
  // menu can enable/disable "Generate code" and label the describe action correctly.
  const resolveNodeMeta = (node: Node) => {
    if (node.kind === 'folder' || node.kind === 'app' || !node.absFile) {
      return
    }

    detectImplemented(node)
      .then((impl) => setImplStatus((prev) => ({ ...prev, [node.id]: impl })))
      .catch(() => undefined)

    loadDescription(node.id)
      .then((text) => setDescStatus((prev) => ({ ...prev, [node.id]: text.trim().length > 0 })))
      .catch(() => undefined)
  }

  // „Edytuj metody" — prefill with the node's current method names (one per line).
  const openMethods = (node: Node) => {
    setMenu(null)
    setMethodsNode(node)
    setMethodsText(node.functions.map((f) => f.name).join('\n'))
  }

  // „Opis dla AI" — load the persisted description so the user can edit it.
  const openDescribe = (node: Node) => {
    setMenu(null)
    setDescNode(node)
    setDescText('')
    loadDescription(node.id)
      .then((text) => setDescText(text))
      .catch(() => undefined)
  }

  const confirmDescribe = () => {
    const node = descNode

    if (!node) {
      return
    }

    const text = descText.trim()

    saveDescription(node.id, text)
      .then(() => setDescStatus((prev) => ({ ...prev, [node.id]: text.length > 0 })))
      .catch(() => undefined)
    setDescNode(null)
  }

  // markGen toggles the per-node "generating" flag.
  const markGen = (id: string, on: boolean) => {
    setGenBusy((prev) => {
      const next = new Set(prev)

      if (on) {
        next.add(id)
      } else {
        next.delete(id)
      }

      return next
    })
  }

  // generateCode wires the node's description (+ desired method list) through window.api
  // AI calls: read the current file, ask the model to fill it in, save it back. The disk
  // watcher (gateway → main → App) then re-scans the graph so the node shows as code.
  const generateCode = async (node: Node, methods?: string[]) => {
    if (!node.absFile || genBusy.has(node.id)) {
      return
    }

    markGen(node.id, true)

    try {
      const [code, description] = await Promise.all([
        window.api.readFile(node.absFile).catch(() => ''),
        loadDescription(node.id)
      ])

      const wanted = (methods ?? node.functions.map((f) => f.name)).filter(Boolean)
      const kindWord = node.kind === 'function' ? 'function' : 'class'
      const parts = [`Implement the ${kindWord} "${node.name}".`]

      if (wanted.length > 0) {
        parts.push(`It must expose these methods: ${wanted.join(', ')}.`)
      }

      if (description.trim()) {
        parts.push(`Purpose / behaviour: ${description.trim()}`)
      }

      parts.push('Return only the full file code, no explanations, no markdown fences.')
      const prompt = parts.join(' ')
      const generated = await window.api.aiEdit(code, prompt, node.absFile).catch(() => '')

      if (generated && generated.trim()) {
        await window.api.saveFile(node.absFile, generated)
        setImplStatus((prev) => ({ ...prev, [node.id]: true }))
        window.api.publishEvent({ type: 'save', title: t('events.save'), file: node.absFile })
        // The on-disk write is picked up by App's project watcher, which re-scans the
        // graph so the node flips from stub to implemented. Nudge any open editor too.
        appBus.emit('editor:save', { path: node.absFile })
      }
    } finally {
      markGen(node.id, false)
    }
  }

  // confirmMethods saves the edited method list by asking the AI to add/keep exactly
  // those methods on the entity (auto-created classes start with empty methods).
  const confirmMethods = async () => {
    const node = methodsNode

    if (!node) {
      return
    }

    const methods = methodsText
      .split('\n')
      .map((m) => m.trim().replace(/\(.*$/, ''))
      .filter(Boolean)

    setMethodsNode(null)
    await generateCode(node, methods)
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

      // optimistic node — appears immediately, hung under the parent folder/app and
      // positioned next to it (so it's visible even before/without a re-scan match)
      const parentId = addParentId.current || rootFolderId
      const parentNode = parentId ? flow.current?.getNode(parentId) : undefined
      const pos =
        addFlowPos.current ??
        (parentNode ? { x: parentNode.position.x + 300, y: parentNode.position.y + 60 } : { x: 0, y: 0 })

      // Resolve the on-disk path so the optimistic node is fully operable (delete /
      // rename / edit) even when a re-scan never turns it into a real node — e.g. a
      // class added to the project root, which the monorepo scan doesn't index.
      const fileName = addKind === 'folder' ? base : base + '.' + extension
      const fullPath = addDir ? addDir.replace(/[\\/]+$/, '') + '/' + fileName : ''

      setLocalNodes((prev) => [
        ...prev,
        {
          id: 'local:' + name + ':' + pos.x,
          name,
          kind: addKind,
          x: pos.x,
          y: pos.y,
          parentId,
          absFile: addKind === 'folder' ? undefined : fullPath || undefined,
          file: addKind === 'folder' ? fullPath || undefined : undefined
        }
      ])
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
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // dark overlay over the wallpaper so nodes stay readable
        backgroundImage: wallpaper
          ? `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url("${wallpaper}")`
          : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
      onClick={() => {
        if (menu) {
          setMenu(null)
        }

        setFindOpen(false) // clicking anywhere closes the search field
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
        appBus.emit('graph:move-start', { path: file.absFile })
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
      onNodeDoubleClick={(_e, n) => {
        const node = n.data as Node
        appBus.emit('graph:node-dblclick', { id: node.id, kind: node.kind })
        handleDoubleClick(node)
        onNodeDoubleClick?.(node)
      }}
      onNodeContextMenu={(e, n) => {
        e.preventDefault()
        const node = n.data as Node
        resolveNodeMeta(node) // resolve implemented/description status for the menu
        setMenu({ x: e.clientX, y: e.clientY, node })
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

    {menu && menu.node && (
      <NodeContextMenu
        x={menu.x}
        y={menu.y}
        node={menu.node}
        implemented={implStatus[menu.node.id]}
        hasDescription={descStatus[menu.node.id]}
        addTargetDir={addTargetDir}
        onAdd={openAdd}
        onRename={openRename}
        onDelete={removeNode}
        onEdit={(n) => onNodeClick?.(n)}
        onEditMethods={openMethods}
        onDescribe={openDescribe}
        onGenerate={(n) => {
          setMenu(null)
          void generateCode(n)
        }}
        onClose={() => setMenu(null)}
      />
    )}

    {findOpen && (
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: 440,
          padding: '8px 14px',
          borderRadius: 10,
          background: '#f2cc60',
          border: '1px solid #d29922',
          boxShadow: '0 6px 18px rgba(0,0,0,0.55)'
        }}
      >
        <span style={{ fontSize: 18, lineHeight: '20px', height: 20, display: 'flex', alignItems: 'center' }}>🔍</span>
        <input
          ref={findRef}
          autoFocus
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
              appBus.emit('graph:search', { query: findText.trim() })
              searchAndPan(findText)
            }

            if (e.key === 'Escape') {
              setFindOpen(false)
            }
          }}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            color: '#000',
            fontWeight: 700,
            fontSize: 16,
            lineHeight: '20px',
            height: 20,
            padding: 0,
            margin: 0,
            fontFamily: 'monospace',
            outline: 'none'
          }}
        />
      </div>
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

    <Dialog open={!!methodsNode} onClose={() => setMethodsNode(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t('graph.editMethods')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          autoFocus
          multiline
          minRows={6}
          label={t('graph.methodList')}
          size="small"
          value={methodsText}
          onChange={(e) => setMethodsText(e.target.value)}
          helperText={t('graph.methodListHint')}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setMethodsNode(null)}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!!methodsNode && genBusy.has(methodsNode.id)}
          onClick={confirmMethods}
        >
          {t('graph.generateCode')}
        </Button>
      </DialogActions>
    </Dialog>

    <Dialog open={!!descNode} onClose={() => setDescNode(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{t('graph.describe')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          autoFocus
          multiline
          minRows={5}
          label={t('graph.descriptionLabel')}
          size="small"
          value={descText}
          onChange={(e) => setDescText(e.target.value)}
          helperText={t('graph.descriptionHint')}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDescNode(null)}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={confirmDescribe}>
          {t('graph.saveDescription')}
        </Button>
      </DialogActions>
    </Dialog>
    </div>
  )
}
