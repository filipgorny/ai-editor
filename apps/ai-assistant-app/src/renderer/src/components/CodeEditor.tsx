import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { appBus } from '../events'
import { commander, type EditorHandle } from '../commander/Commander'
import { IconButton, Button, CircularProgress, FormControlLabel, Switch, Snackbar, Alert } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import MinimizeIcon from '@mui/icons-material/Minimize'
import styled from 'styled-components'
import { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import CodeMirrorEditor from './CodeMirrorEditor'
import { javascript } from '@codemirror/lang-javascript'
import { themeExt, isRandomTheme, randomThemeName } from './themes'
import { vim, getCM } from '@replit/codemirror-vim'
import { Prec } from '@codemirror/state'
import { ghostField, setGhostRemarks, remarkKey, type Remark } from './reviewGhost'
import { copilotField, copilotKeymap, setCopilot } from './copilot'
import { columnRuler } from './ruler'
import { gotoDefExtension, type GotoCtx } from './gotodef'
import { rainbowBrackets } from './rainbowBrackets'
import { reviewField, reviewTheme, setReviewLines } from './reviewDecoration'
import { relativeToRoot } from '../utils/path'
import { colors } from '../styles/tokens'
import { toast } from '../toast'

export type EditorTarget = { path: string; gotoFn?: string; gotoLine?: number; animate?: boolean }

// Czas animacji pojawiania/znikania okna edytora (opacity 0↔1), w ms.
export const EDITOR_FADE_MS = 600

// specifierAt zwraca treść stringa w cudzysłowach pod kolumną (np. ścieżka importu).
function specifierAt(lineText: string, col: number): string | null {
  const re = /['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null

  while ((m = re.exec(lineText))) {
    const start = m.index
    const end = m.index + m[0].length

    if (col >= start && col <= end) {
      return m[1]
    }
  }

  return null
}

// Hack font 18px + full height so the theme background fills down to the bottom
// even for short files (the active theme paints the bg on .cm-editor).
const editorTheme = Prec.highest(
  EditorView.theme({
    '&': { fontSize: '18px', fontFamily: 'Hack, monospace', height: '100%', minHeight: '100%' },
    '.cm-editor': { height: '100%', minHeight: '100%' },
    '.cm-scroller': { fontFamily: 'Hack, monospace', minHeight: '100%' },
    '.cm-content': { fontFamily: 'Hack, monospace', minHeight: '100%' },
    '.cm-gutters': { border: 'none', fontFamily: 'Hack, monospace', minHeight: '100%' },
    // Stała szerokość paska z numerami linii — nie skacze między plikami ani przy
    // przewijaniu (rezerwuje miejsce na 4 cyfry; rośnie dopiero powyżej 9999 linii).
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '4ch',
      boxSizing: 'border-box',
      padding: '0 8px',
      textAlign: 'right'
    }
  })
)

// Pływające, przeciągalne okno edytora (zamiast modalnego dialogu) — wiele naraz.
// Rozmiar zmienia się Alt + środkowy przycisk myszy (sterowany stanem).
const Win = styled.div`
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 360px;
  min-height: 240px;
  background: #000;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.65);
  transition: opacity ${EDITOR_FADE_MS}ms ease;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${colors.border};
`

const Title = styled.div`
  flex: 1;
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EditorWrap = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #000;
`

// Pole wyszukiwania (Ctrl+F) — białe, w prawym górnym rogu edytora.
const FindBox = styled.input`
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 5;
  width: 240px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #d0d7de;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-family: monospace;
  outline: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
`

const Loading = styled.div`
  padding: 24px;
  color: ${colors.muted};
`

const PromptBar = styled.div`
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid ${colors.border};
`

const PromptInput = styled.textarea`
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  color: #e6edf3;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.4;
  resize: vertical;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

// CodeEditor: edytor pliku z podświetlaniem (CodeMirror) + na dole prompt AI,
// który może zmienić zawartość edytora.
export default function CodeEditor({
  target,
  onClose,
  onOpen,
  index = 0,
  active = true,
  onActivate,
  minimized = false,
  onMinimize,
  copilot = true,
  onCopilotChange,
  vim: vimMode = true,
  onVimChange,
  rainbow = true,
  theme = 'Czarny (domyślny)',
  root = '',
  closing = false,
  review = false,
  initialSnap = false,
  onSnapChange,
  initialGeom,
  onGeometry
}: {
  target: EditorTarget | null
  onClose: () => void
  onOpen?: (t: EditorTarget) => void
  index?: number
  active?: boolean
  onActivate?: () => void
  minimized?: boolean
  onMinimize?: () => void
  copilot?: boolean
  onCopilotChange?: (on: boolean) => void
  vim?: boolean
  onVimChange?: (on: boolean) => void
  rainbow?: boolean
  theme?: string
  root?: string
  closing?: boolean
  // tryb review — maluje tła zmienionych linii (dodane zielone, zmienione żółte)
  review?: boolean
  // initialSnap — otwórz okno od razu zesnapowane do obszaru grafu (gdy inny edytor
  // jest zesnapowany do góry, nowo otwarty plik też ląduje zesnapowany).
  initialSnap?: boolean
  // onSnapChange — zgłasza, czy to okno jest zesnapowane do góry (obszar grafu), by host
  // mógł otwierać kolejne pliki również zesnapowane.
  onSnapChange?: (snapped: boolean) => void
  // initialGeom — zapamiętana geometria okna (pozycja/rozmiar/snap/fullscreen) do
  // odtworzenia po ponownym otwarciu projektu. Pierwszeństwo nad initialSnap/indexem.
  initialGeom?: { x: number; y: number; w: number; h: number; snapped?: boolean; fullscreen?: boolean }
  // onGeometry — zgłasza ustaloną geometrię okna (po przeciągnięciu/zmianie rozmiaru/
  // snapie/fullscreenie), by host mógł ją zapisać per projekt.
  onGeometry?: (path: string, geom: { x: number; y: number; w: number; h: number; snapped: boolean; fullscreen: boolean }) => void
}) {
  const { t, i18n } = useTranslation()
  // Fade in on mount (opacity 0→1); `closing` fades back out (1→0) before removal.
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(true))

    return () => window.cancelAnimationFrame(id)
  }, [])

  // If opened snapped (because another window is snapped to the top), register this
  // window's snap with the host so the state survives closing the original.
  useEffect(() => {
    if (initialSnap) {
      onSnapChange?.(true)
    }
  }, [])
  // Initial window layout: restored geometry (reopened project) if present, else centered
  // (~half width) / filling the graph area when opened snapped (see initialSnap).
  const [layout] = useState(() =>
    initialGeom
      ? { pos: { x: initialGeom.x, y: initialGeom.y }, size: { w: initialGeom.w, h: initialGeom.h } }
      : initialEditorLayout(!!initialSnap, index)
  )
  const [size, setSize] = useState(layout.size)
  const [pos, setPos] = useState(layout.pos)
  // Whether this window currently fills the graph area ("top" snap). Reported up so the
  // host can open the next file snapped too.
  const snapRef = useRef(!!initialSnap || !!initialGeom?.snapped)
  // Reaktywny odpowiednik snapRef (do renderu: zesnapowane okno nie ma cienia).
  const [snapped, setSnapped] = useState(!!initialSnap || !!initialGeom?.snapped)
  // Rozmiar sprzed snapu do góry — po wyjęciu okna ze snapu wraca do niego (nie zostaje
  // w rozmiarze sceny). null → użyj domyślnego układu pływającego.
  const preSnapRef = useRef<{ w: number; h: number } | null>(null)

  // clearSnap drops the top-snap state (e.g. on a manual resize) and notifies the host.
  const clearSnap = (): void => {
    if (snapRef.current) {
      snapRef.current = false
      setSnapped(false)
      onSnapChange?.(false)
    }
  }

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onActivate?.()
    const start = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y, w: size.w, h: size.h }
    // Snap target: the graph area (right of the file tree, below the toolbar/tabs, above the
    // agent bar). Captured at drag start; used for the "drag up to fill the graph" snap.
    const stage = document.getElementById('graph-stage')?.getBoundingClientRect()
    // Czy przeciąganie kończy się snapem do góry (wypełnia obszar grafu) — zgłaszane
    // w górę przy puszczeniu, by nowo otwierane pliki mogły się dopasować.
    let snapped = snapRef.current
    // Czy okno było zesnapowane już na starcie przeciągania — wtedy wyjęcie go ze snapu
    // przywraca rozmiar sprzed snapu (a nie zostaje w rozmiarze sceny).
    const wasSnapped = snapRef.current

    const move = (ev: MouseEvent) => {
      // Snap NA ŻYWO tylko przy samej KRAWĘDZI EKRANU (wąska strefa, by nie skakać).
      const TREE = 380
      const SNAP = 14
      const usable = window.innerWidth - TREE
      const halfW = Math.round(usable / 2)
      const fullH = window.innerHeight

      // Drag UP over the toolbar → fill the whole graph area (not the tree/toolbar/agent bar).
      if (stage && ev.clientY <= stage.top + 6) {
        // wchodząc w snap z rozmiaru pływającego — zapamiętaj go, by móc wrócić
        if (!wasSnapped) {
          preSnapRef.current = { w: start.w, h: start.h }
        }

        snapped = true
        setPos({ x: Math.round(stage.left), y: Math.round(stage.top) })
        setSize({ w: Math.round(stage.width), h: Math.round(stage.height) })

        return
      }

      snapped = false

      if (ev.clientX <= SNAP) {
        setPos({ x: TREE, y: 0 }) // lewa połowa zaczyna się przy drzewie plików
        setSize({ w: halfW, h: fullH })

        return
      }

      if (ev.clientX >= window.innerWidth - SNAP) {
        setPos({ x: TREE + halfW, y: 0 })
        setSize({ w: halfW, h: fullH })

        return
      }

      // Wyjęcie zesnapowanego okna ze snapu → wróć do rozmiaru sprzed snapu, pod kursorem.
      if (wasSnapped) {
        const rs = preSnapRef.current ?? initialEditorLayout(false, index).size

        setSize(rs)
        setPos({ x: Math.round(ev.clientX - rs.w / 2), y: Math.round(ev.clientY - 12) })

        return
      }

      // poza strefą snap — zwykłe przesuwanie, zachowaj rozmiar
      setSize({ w: start.w, h: start.h })
      setPos({ x: start.px + ev.clientX - start.mx, y: start.py + ev.clientY - start.my })
    }

    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)

      if (snapped !== snapRef.current) {
        snapRef.current = snapped
        setSnapped(snapped)
        onSnapChange?.(snapped)
      }
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Zmiana rozmiaru za uchwyty na krawędziach/narożnikach okna.
  const startEdge =
    (edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }) => (e: ReactMouseEvent) => {
      if (fullscreen) {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      onActivate?.()
      clearSnap() // ręczna zmiana rozmiaru wyprowadza okno ze snapu do góry
      const s = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h, x: pos.x, y: pos.y }

      const move = (ev: MouseEvent) => {
        const dx = ev.clientX - s.mx
        const dy = ev.clientY - s.my
        let w = s.w
        let h = s.h
        let x = s.x
        let y = s.y

        if (edges.right) {
          w = Math.max(360, s.w + dx)
        }

        if (edges.bottom) {
          h = Math.max(240, s.h + dy)
        }

        if (edges.left) {
          w = Math.max(360, s.w - dx)
          x = s.x + (s.w - w)
        }

        if (edges.top) {
          h = Math.max(240, s.h - dy)
          y = s.y + (s.h - h)
        }

        setSize({ w, h })
        setPos({ x, y })
      }

      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }

      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }

  // Alt + środkowy przycisk gdziekolwiek w oknie → zmiana rozmiaru.
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onActivate?.()
    clearSnap() // ręczna zmiana rozmiaru wyprowadza okno ze snapu do góry
    const start = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h }

    const move = (ev: MouseEvent) => {
      setSize({
        w: Math.max(360, start.w + ev.clientX - start.mx),
        h: Math.max(240, start.h + ev.clientY - start.my)
      })
    }

    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [fullscreen, setFullscreen] = useState(!!initialGeom?.fullscreen)

  // Gdy okno jest zesnapowane do góry (wypełnia obszar grafu), podążaj za zmianą rozmiaru /
  // maksymalizacją okna głównego — przelicz pozycję i rozmiar do aktualnego #graph-stage.
  useEffect(() => {
    const onResize = (): void => {
      if (!snapRef.current || fullscreen || minimized) {
        return
      }

      window.requestAnimationFrame(() => {
        const stage = document.getElementById('graph-stage')?.getBoundingClientRect()

        if (!stage) {
          return
        }

        setPos({ x: Math.round(stage.left), y: Math.round(stage.top) })
        setSize({ w: Math.round(stage.width), h: Math.round(stage.height) })
      })
    }

    window.addEventListener('resize', onResize)

    return () => window.removeEventListener('resize', onResize)
  }, [fullscreen, minimized])

  // Zgłoś ustaloną geometrię okna do hosta (zapis per projekt). Odroczone, by nie
  // spamować podczas ciągłego przeciągania/zmiany rozmiaru — zapisujemy stan końcowy.
  const onGeomRef = useRef(onGeometry)
  onGeomRef.current = onGeometry

  useEffect(() => {
    if (!target) {
      return
    }

    const id = window.setTimeout(() => {
      onGeomRef.current?.(target.path, { x: pos.x, y: pos.y, w: size.w, h: size.h, snapped, fullscreen })
    }, 250)

    return () => window.clearTimeout(id)
  }, [pos.x, pos.y, size.w, size.h, snapped, fullscreen, target?.path])
  const [model, setModel] = useState('')
  const [saved, setSaved] = useState(false)
  // uwagi ghost: ESLint (żółte/czerwone) + recenzja AI (szare).
  const [lintRemarks, setLintRemarks] = useState<Remark[]>([])
  const [reviewRemarks, setReviewRemarks] = useState<Remark[]>([])
  // zamknięte dymki (po kliknięciu) — klucz linia:tekst; nie wracają.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // wyszukiwarka w treści (Ctrl+F): pole w prawym górnym rogu.
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const findRef = useRef<HTMLInputElement>(null)
  const ref = useRef<ReactCodeMirrorRef>(null)
  // sygnatura (plik#funkcja), do której już przewinęliśmy — by nie przewijać przy edycji.
  const scrolledFor = useRef('')
  // Aktualne callbacki dla Commandera (świeże co render); handle deleguje tutaj.
  const apiRef = useRef<EditorHandle>({
    path: '',
    getView: () => null,
    save: () => {},
    runPrompt: () => {},
    find: () => {},
    gotoFn: () => {},
    setFullscreen: () => {}
  })

  // Nazwa aktualnie używanego modelu AI (na przycisku wysyłki).
  useEffect(() => {
    window.api.aiModel().then(setModel).catch(() => undefined)
  }, [])

  const dirty = content !== original
  const remarks = useMemo(() => [...lintRemarks, ...reviewRemarks], [lintRemarks, reviewRemarks])
  const visibleRemarks = useMemo(
    () => remarks.filter((r) => !dismissed.has(remarkKey(r))),
    [remarks, dismissed]
  )

  const onDismiss = useCallback((k: string) => setDismissed((p) => new Set(p).add(k)), [])

  // Ctrl/Cmd+klik na stringu importu → otwórz wskazany plik w edytorze.
  const gotoDef = useCallback(
    async (spec: string) => {
      if (!target) {
        return
      }

      const abs = await window.api.resolveImport(target.path, spec)

      if (abs) {
        onOpen?.({ path: abs })
      }
    },
    [target?.path, onOpen]
  )

  // Keep gotoDef behind a ref so the extensions array stays STABLE across re-renders.
  // Otherwise extensions change every App render (onOpen is a new fn), CodeMirror
  // reconfigures and steals focus — raising the OS window "for no reason".
  const gotoDefRef = useRef(gotoDef)
  gotoDefRef.current = gotoDef

  // Go-to-definition context (stable ref, read by hover-click and the Vim `gd`): fetch links
  // from the scanner for this file, and open a resolved target at its definition line.
  const gotoCtxRef = useRef<GotoCtx | null>(null)
  gotoCtxRef.current = {
    fetch: (content) => (target ? window.api.defLinks(target.path, content) : Promise.resolve([])),
    open: (path, line) => onOpen?.({ path, gotoLine: line })
  }

  // W trybie „różne" (ciemne/jasne) każde okno losuje własny motyw RAZ (stabilny przez całe
  // życie okna); zwykły motyw przechodzi bez zmian. Nowo otwarty plik = nowe okno = nowy los.
  const resolvedTheme = useMemo(() => (isRandomTheme(theme) ? randomThemeName(theme) : theme), [theme])

  const extensions = useMemo(
    () => [
      copilotKeymap, // Tab akceptuje podpowiedź Copilota (przed vim)
      copilotField,
      ...(vimMode ? [Prec.highest(vim())] : []),
      javascript({ jsx: true, typescript: true }),
      EditorView.domEventHandlers({
        mousedown(e, view) {
          if (!e.ctrlKey && !e.metaKey) {
            return false
          }

          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })

          if (pos == null) {
            return false
          }

          const line = view.state.doc.lineAt(pos)
          const spec = specifierAt(line.text, pos - line.from)

          if (!spec) {
            return false
          }

          e.preventDefault()
          // Stop the click bubbling to the source window's onActivate, so the file we open
          // becomes (and stays) the active window instead of landing behind this one.
          e.stopPropagation()
          gotoDefRef.current(spec)

          return true
        }
      }),
      gotoDefExtension(gotoCtxRef),
      ...(rainbow ? [rainbowBrackets()] : []),
      ghostField,
      reviewField,
      reviewTheme,
      columnRuler(80),
      themeExt(resolvedTheme),
      editorTheme
    ],
    [vimMode, rainbow, resolvedTheme, target?.path]
  )

  // Wstrzyknięcie uwag do edytora efektem (bez rekonfiguracji → dymki nie znikają).
  useEffect(() => {
    const view = ref.current?.view

    if (!view) {
      return
    }

    view.dispatch({ effects: setGhostRemarks.of({ remarks: visibleRemarks, onDismiss }) })
  }, [visibleRemarks, loading, onDismiss])

  useEffect(() => {
    if (!target) {
      return
    }

    setLoading(true)
    // nowy plik → świeże uwagi i odznaczenia
    setLintRemarks([])
    setReviewRemarks([])
    setDismissed(new Set())

    window.api
      .readFile(target.path)
      .then((c) => {
        setOriginal(c)
        setLoading(false)

        // Agent-opened files type their content in live (empty → final).
        if (target.animate) {
          setContent('')
          requestAnimationFrame(() => animateDiff('', c))
        } else {
          setContent(c)
        }

        // event: wejście do pliku
        window.api.publishEvent({ type: 'open', title: t('events.open'), file: target.path })
      })
      .catch(() => {
        setContent(t('editor.loadError'))
        setLoading(false)
        appBus.emit('editor:load-error', { path: target.path })
      })
  }, [target?.path])

  // Tryb review: pobierz diff pliku (gałąź vs baza) i pomaluj tła linii — dodane
  // zielonkawo, zmienione żółtawo. Wyłączenie review czyści podświetlenie.
  useEffect(() => {
    const view = ref.current?.view

    if (!view || !target) {
      return
    }

    if (!review || loading) {
      view.dispatch({ effects: setReviewLines.of({ added: [], modified: [] }) })

      return
    }

    let cancelled = false

    window.api
      .gitFileDiff(root, target.path)
      .then((d) => {
        if (cancelled) {
          return
        }

        const v = ref.current?.view

        if (v) {
          v.dispatch({ effects: setReviewLines.of({ added: d?.addedLines ?? [], modified: d?.modifiedLines ?? [] }) })
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [review, root, target?.path, loading])

  // Ctrl/Cmd+S → zapis.
  useEffect(() => {
    if (!target) {
      return
    }

    const onKey = (e: KeyboardEvent) => {
      // klawisze obsługuje tylko aktywne okno edytora
      if (!active) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
        setTimeout(() => findRef.current?.focus(), 0)
      }

      if (e.key === 'Escape' && findOpen) {
        setFindOpen(false)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [target?.path, content, findOpen, active])

  // runFind przewija edytor do następnego wystąpienia tekstu (z zawijaniem).
  const runFind = (text: string, from: number) => {
    const view = ref.current?.view

    if (!view || !text) {
      return
    }

    const hay = view.state.doc.toString()
    let idx = hay.indexOf(text, from)

    if (idx < 0) {
      idx = hay.indexOf(text, 0)
    }

    if (idx < 0) {
      return
    }

    view.dispatch({
      selection: { anchor: idx, head: idx + text.length },
      effects: EditorView.scrollIntoView(idx, { y: 'center' })
    })
  }

  // Przewinięcie do funkcji + podświetlenie jej linii. Z opóźnieniem, bo zaraz
  // po wczytaniu treści CodeMirror może jeszcze nie być rozłożony.
  useEffect(() => {
    if (!target?.gotoFn) {
      return
    }

    const sig = target.path + '#' + target.gotoFn

    // Już przewinięte do tej funkcji — nie rób tego ponownie przy edycji.
    if (scrolledFor.current === sig) {
      return
    }

    let cancelled = false

    const timer = window.setTimeout(() => {
      const view = ref.current?.view

      if (cancelled || !view) {
        return
      }

      const idx = findFunctionLine(view.state.doc.toString(), target.gotoFn!)

      if (idx < 0) {
        return
      }

      const line = view.state.doc.line(idx + 1)
      // kursor na deklaracji (bez zaznaczenia — by Vim został w normal mode);
      // tło podświetla .cm-activeLine. scroll y:'start' = deklaracja na górze.
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 6 })
      })
      view.focus()
      scrolledFor.current = sig
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [content, target?.path, target?.gotoFn])

  // Scroll to a 0-based line (go-to-definition target from the scanner).
  useEffect(() => {
    if (target?.gotoLine == null) {
      return
    }

    const sig = target.path + '@' + target.gotoLine

    if (scrolledFor.current === sig) {
      return
    }

    let cancelled = false

    const timer = window.setTimeout(() => {
      const view = ref.current?.view

      if (cancelled || !view) {
        return
      }

      const idx = Math.min(Math.max(target.gotoLine!, 0), view.state.doc.lines - 1)
      const line = view.state.doc.line(idx + 1)

      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 6 })
      })
      view.focus()
      scrolledFor.current = sig
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [content, target?.path, target?.gotoLine])

  // ESLint: od razu po otwarciu i po każdej edycji (lekki debounce).
  useEffect(() => {
    if (!target) {
      return
    }

    const t = window.setTimeout(() => {
      window.api
        .lintFile(content, target.path)
        .then((msgs) =>
          setLintRemarks(
            msgs.map((m) => ({
              line: m.line,
              text: m.text,
              color: m.severity === 2 ? '#f85149' : '#e3b341',
              prefix: '⚠'
            }))
          )
        )
        .catch(() => setLintRemarks([]))
    }, 300)

    return () => window.clearTimeout(t)
  }, [content, target?.path])

  // Recenzja AI: po otwarciu i po edycji (dłuższy debounce — LLM jest wolny).
  useEffect(() => {
    if (!target) {
      return
    }

    const t = window.setTimeout(() => {
      window.api
        .aiReview(content, target.path, i18n.language)
        .then((rs) => setReviewRemarks(rs.map((r) => ({ line: r.line, text: r.text, color: '#6e7681', prefix: '‹' }))))
        .catch(() => undefined)
    }, 1500)

    return () => window.clearTimeout(t)
  }, [content, target?.path])

  // Copilot: po pauzie w pisaniu pobierz podpowiedź i pokaż jako ghost (Tab wstawia).
  useEffect(() => {
    if (!target) {
      return
    }

    const view = ref.current?.view

    if (!copilot) {
      view?.dispatch({ effects: setCopilot.of(null) }) // wyłączony → schowaj podpowiedź

      return
    }

    if (loading) {
      return
    }

    const t = window.setTimeout(() => {
      const v = ref.current?.view

      if (!v) {
        return
      }

      // Copilot działa tylko w insert mode (gdy vim włączony).
      const cm = getCM(v) as { state?: { vim?: { insertMode?: boolean } } } | undefined

      if (vimMode && cm && !cm.state?.vim?.insertMode) {
        return
      }

      const p = v.state.selection.main.head
      const prefix = v.state.doc.sliceString(0, p)
      const suffix = v.state.doc.sliceString(p)

      window.api
        .aiComplete(prefix, suffix, target.path)
        .then((raw) => {
          const vv = ref.current?.view

          if (!vv) {
            return
          }

          // Ignore stale responses: only show the ghost if the cursor AND the text before
          // it are still exactly what we asked about — otherwise a slow, outdated completion
          // would flash on top of the current one (looks like a doubled suggestion).
          if (vv.state.selection.main.head !== p || vv.state.doc.sliceString(0, p) !== prefix) {
            return
          }

          const text = sanitizeCompletion(prefix, suffix, raw)

          if (text && text.trim()) {
            vv.dispatch({ effects: setCopilot.of({ from: p, text }) })
          }
        })
        .catch(() => undefined)
    }, 600)

    return () => window.clearTimeout(t)
  }, [content, copilot, target?.path, loading])

  const save = async () => {
    if (!target) {
      return
    }

    await window.api.saveFile(target.path, content)
    setOriginal(content)
    setSaved(true)
    // event: zapis pliku
    window.api.publishEvent({ type: 'save', title: t('events.save'), file: target.path })
    appBus.emit('editor:save', { path: target.path })
  }

  // Zamknięcie z potwierdzeniem, gdy są niezapisane zmiany.
  const handleClose = () => {
    if (dirty && !window.confirm(t('editor.unsavedConfirm'))) {
      return
    }

    onClose()
  }

  // animateDiff animuje WYŁĄCZNIE wstawione linie (diff liniowy LCS). Linie
  // wspólne — także te poniżej zmiany — zostają na miejscu.
  const animateDiff = (oldText: string, newText: string) => {
    const a = oldText.split('\n')
    const b = newText.split('\n')

    // Za duże pliki: bez animacji (uniknięcie O(n*m)).
    if (a.length * b.length > 4_000_000) {
      setContent(newText)

      return
    }

    const m = a.length
    const n = b.length
    const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }

    // Każda linia nowego tekstu jako fragment, oznaczona insert (nowa) / keep (wspólna).
    const runs: { text: string; insert: boolean }[] = []
    let i = 0
    let j = 0

    while (j < n) {
      if (i < m && a[i] === b[j]) {
        runs.push({ text: b[j], insert: false })
        i++
        j++
      } else if (i < m && dp[i + 1][j] >= dp[i][j + 1]) {
        i++
      } else {
        runs.push({ text: b[j], insert: true })
        j++
      }
    }

    for (let k = 0; k < runs.length - 1; k++) {
      runs[k].text += '\n'
    }

    const totalInsert = runs.reduce((sum, r) => sum + (r.insert ? r.text.length : 0), 0)

    if (totalInsert === 0) {
      setContent(newText)

      return
    }

    const render = (count: number): { text: string; cursor: number } => {
      let remaining = count
      let out = ''
      let cursor = 0

      for (const r of runs) {
        if (!r.insert) {
          out += r.text

          continue
        }

        const take = Math.max(0, Math.min(r.text.length, remaining))
        out += r.text.slice(0, take)

        if (take > 0) {
          cursor = out.length
        }

        remaining -= r.text.length
      }

      return { text: out, cursor }
    }

    let shown = 0
    const step = Math.max(2, Math.ceil(totalInsert / 100))

    const tick = () => {
      shown = Math.min(totalInsert, shown + step)

      const { text, cursor } = render(shown)
      setContent(text)

      const view = ref.current?.view

      if (view) {
        view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, cursor) }, scrollIntoView: true })
      }

      if (shown < totalInsert) {
        window.setTimeout(tick, 16)
      }
    }

    tick()
  }

  const runAi = async (text?: string) => {
    const ask = (text ?? prompt).trim()

    // No busy guard: a hung AI call must never trap the prompt field.
    if (!target || !ask) {
      return
    }

    const before = content
    setBusy(true)

    try {
      const next = await window.api.aiEdit(before, ask, target.path)

      setPrompt('')

      if (next && next !== before) {
        animateDiff(before, next)
        appBus.emit('editor:ai-edit', { path: target.path })
      } else {
        toast.info(t('editor.aiNoChange'))
      }
    } catch (e) {
      toast.error(t('agent.error', { message: String((e as Error)?.message || e) }))
    } finally {
      setBusy(false)
    }
  }

  // gotoFn — Commander hook: scroll to a function/method declaration and place the caret.
  const gotoFn = (fn: string) => {
    const view = ref.current?.view

    if (!view || !fn) {
      return
    }

    const idx = findFunctionLine(view.state.doc.toString(), fn)

    if (idx < 0) {
      return
    }

    const line = view.state.doc.line(idx + 1)

    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 6 }) })
    view.focus()
  }

  // openFind — Commander hook: open the find box and jump to the first match.
  const openFind = (text: string) => {
    setFindOpen(true)
    setFindText(text)
    runFind(text, 0)
  }

  // Expose this editor to the Commander while it is the active window, so commands like
  // write/cursor/save/find operate on it. apiRef holds the latest closures; the handle
  // delegates to it, so it never goes stale without re-binding on every keystroke.
  apiRef.current = {
    path: target?.path ?? '',
    getView: () => ref.current?.view ?? null,
    save,
    runPrompt: (p: string) => runAi(p),
    find: openFind,
    gotoFn,
    setFullscreen: (on) => setFullscreen(on === 'toggle' ? (v) => !v : on)
  }

  useEffect(() => {
    if (!active || !target || minimized) {
      return
    }

    const handle: EditorHandle = {
      path: target.path,
      getView: () => apiRef.current.getView(),
      save: () => apiRef.current.save(),
      runPrompt: (p) => apiRef.current.runPrompt(p),
      find: (txt) => apiRef.current.find(txt),
      gotoFn: (fn) => apiRef.current.gotoFn(fn),
      setFullscreen: (on) => apiRef.current.setFullscreen(on)
    }

    commander.bindEditor(handle)

    return () => commander.unbindEditor(handle)
  }, [active, target?.path, minimized])

  if (!target || minimized) {
    return null
  }

  return (
    <>
    <Win
      onMouseDown={() => onActivate?.()}
      onMouseDownCapture={(e) => {
        if (fullscreen || !e.altKey) {
          return
        }

        if (e.button === 0) {
          startDrag(e) // Alt + lewy = przesuwanie
        } else if (e.button === 1) {
          startResize(e) // Alt + środkowy = zmiana rozmiaru
        }
      }}
      style={
        fullscreen
          ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0, boxShadow: 'none', zIndex: active ? 1300 : 1200, opacity: closing || !shown ? 0 : 1 }
          : {
              left: pos.x,
              top: pos.y,
              width: size.w,
              height: size.h,
              // zesnapowane do obszaru grafu → bez cienia i bez zaokrągleń (wtapia się w tło)
              ...(snapped ? { boxShadow: 'none', borderRadius: 0 } : null),
              zIndex: active ? 1300 : 1200,
              opacity: closing || !shown ? 0 : 1
            }
      }
    >
      <Header
        onMouseDown={(e) => !fullscreen && e.target === e.currentTarget && startDrag(e)}
        style={{ cursor: fullscreen ? 'default' : 'move' }}
      >
        <Title onMouseDown={(e) => !fullscreen && startDrag(e)} style={{ cursor: fullscreen ? 'default' : 'move' }}>
          {relativeToRoot(target?.path ?? '', root)}
          {dirty ? ' •' : ''}
        </Title>
        <FormControlLabel
          control={<Switch size="small" checked={vimMode} onChange={(e) => onVimChange?.(e.target.checked)} />}
          label="Vim keys"
          sx={{ mr: 1, '.MuiFormControlLabel-label': { fontSize: 12, color: '#8b949e' } }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={copilot} onChange={(e) => onCopilotChange?.(e.target.checked)} />}
          label="Copilot"
          sx={{ mr: 1, '.MuiFormControlLabel-label': { fontSize: 12, color: '#8b949e' } }}
        />
        <Button
          size="small"
          startIcon={<SaveIcon />}
          onClick={save}
          variant={dirty ? 'contained' : 'text'}
          sx={{
            // stała szerokość i padding — zmiana wariantu (tło przy dirty) nie zmienia rozmiaru
            minWidth: 96,
            px: 2,
            ...(dirty
              ? { bgcolor: '#da3633', color: '#fff', '&:hover': { bgcolor: '#b62324' } }
              : { color: '#8b949e' })
          }}
        >
          {t('editor.save')}
        </Button>
        <IconButton size="small" onClick={() => onMinimize?.()} title={t('editor.minimize')}>
          <MinimizeIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => {
            appBus.emit('editor:fullscreen', { path: target.path, on: !fullscreen })
            setFullscreen(!fullscreen)
          }}
        >
          {fullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
        </IconButton>
        <IconButton size="small" onClick={handleClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Header>

      <EditorWrap>
        {findOpen && (
          <FindBox
            ref={findRef}
            placeholder={t('editor.searchInFile')}
            value={findText}
            onChange={(e) => {
              setFindText(e.target.value)

              const view = ref.current?.view
              runFind(e.target.value, view ? view.state.selection.main.from : 0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()

                const view = ref.current?.view
                runFind(findText, view ? view.state.selection.main.to : 0)
              }

              if (e.key === 'Escape') {
                setFindOpen(false)
              }
            }}
          />
        )}
        {loading ? (
          <Loading>{t('editor.loading')}</Loading>
        ) : (
          <CodeMirrorEditor ref={ref} value={content} extensions={extensions} onChange={setContent} />
        )}
      </EditorWrap>

      {!fullscreen && (
        <>
          <div onMouseDown={startEdge({ top: true })} style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 6, cursor: 'ns-resize', zIndex: 10 }} />
          <div onMouseDown={startEdge({ bottom: true })} style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 6, cursor: 'ns-resize', zIndex: 10 }} />
          <div onMouseDown={startEdge({ left: true })} style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 6, cursor: 'ew-resize', zIndex: 10 }} />
          <div onMouseDown={startEdge({ right: true })} style={{ position: 'absolute', right: 0, top: 12, bottom: 12, width: 6, cursor: 'ew-resize', zIndex: 10 }} />
          <div onMouseDown={startEdge({ top: true, left: true })} style={{ position: 'absolute', top: 0, left: 0, width: 12, height: 12, cursor: 'nwse-resize', zIndex: 11 }} />
          <div onMouseDown={startEdge({ top: true, right: true })} style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, cursor: 'nesw-resize', zIndex: 11 }} />
          <div onMouseDown={startEdge({ bottom: true, left: true })} style={{ position: 'absolute', bottom: 0, left: 0, width: 12, height: 12, cursor: 'nesw-resize', zIndex: 11 }} />
          <div onMouseDown={startEdge({ bottom: true, right: true })} style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'nwse-resize', zIndex: 11 }} />
        </>
      )}
    </Win>

    <Snackbar
      open={saved}
      autoHideDuration={2000}
      onClose={() => setSaved(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity="success" variant="filled" onClose={() => setSaved(false)}>
        {t('editor.saved')}
      </Alert>
    </Snackbar>
    </>
  )
}

function findFunctionLine(content: string, fn: string): number {
  const lines = content.split('\n')
  const re = new RegExp(`(^|[^\\w.])${escapeRe(fn)}\\s*[(<=:]`)

  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      return i
    }
  }

  return -1
}

// sanitizeCompletion cleans a raw model completion before showing it as ghost text:
// it trims what the model re-typed from the current line, drops a tail that just repeats
// the rest of the line after the cursor, and collapses a wholesale doubled suggestion —
// all of which otherwise show up as a duplicated suggestion.
function sanitizeCompletion(prefix: string, suffix: string, raw: string): string {
  let text = stripOverlap(prefix, raw)

  // The model re-emitted the rest of the current line after the cursor — drop the echo.
  const suffixLine = suffix.split('\n', 1)[0]

  if (suffixLine && text.length > suffixLine.length && text.endsWith(suffixLine)) {
    text = text.slice(0, text.length - suffixLine.length)
  }

  // Some local models emit the completion twice back-to-back — collapse "XX" → "X".
  const half = text.length / 2

  if (Number.isInteger(half) && half >= 4 && /\w/.test(text) && text.slice(0, half) === text.slice(half)) {
    text = text.slice(0, half)
  }

  return text
}

// stripOverlap usuwa z początku podpowiedzi tekst, który już jest w bieżącej linii
// (model często powtarza, np. po „import" zwraca „import …").
function stripOverlap(before: string, sugg: string): string {
  const line = before.slice(before.lastIndexOf('\n') + 1)
  const max = Math.min(line.length, sugg.length)

  for (let k = max; k > 0; k--) {
    if (sugg.startsWith(line.slice(line.length - k))) {
      return sugg.slice(k)
    }
  }

  return sugg
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// initialEditorLayout computes a new editor window's starting position/size. With
// `snap`, it opens filling the graph-stage area (matching the top-snap), so a file
// opened while another editor is snapped to the top lands snapped too; otherwise it
// opens centered at ~half width, fanned out by index.
function initialEditorLayout(
  snap: boolean,
  index: number
): { pos: { x: number; y: number }; size: { w: number; h: number } } {
  if (snap) {
    const stage = document.getElementById('graph-stage')?.getBoundingClientRect()

    if (stage) {
      return {
        pos: { x: Math.round(stage.left), y: Math.round(stage.top) },
        size: { w: Math.round(stage.width), h: Math.round(stage.height) }
      }
    }
  }

  const w = Math.round(window.innerWidth * 0.5)
  const h = Math.round(window.innerHeight * 0.8)

  return {
    pos: {
      x: Math.round((window.innerWidth - w) / 2) + index * 30,
      y: Math.round((window.innerHeight - h) / 2) + index * 30
    },
    size: { w, h }
  }
}
