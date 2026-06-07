import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { appBus } from '@/events'
import { commander, type EditorHandle } from '@/commander/Commander'
import { IconButton, Button, CircularProgress, FormControlLabel, Switch, Snackbar, Alert } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import MinimizeIcon from '@mui/icons-material/Minimize'
import styled from 'styled-components'
import { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import CodeMirrorEditor from '@/common/editor/CodeMirrorEditor'
import Window, { type WindowGeom } from '@/ui/Window'
import { javascript } from '@codemirror/lang-javascript'
import { resolveEditorTheme } from '@/common/editor/themes'
import { vim, getCM, Vim } from '@replit/codemirror-vim'
import { Prec } from '@codemirror/state'
import { ghostField, ghostWidthPlugin, setGhostRemarks, remarkKey, type Remark } from '@/common/editor/reviewGhost'
import { copilotField, copilotKeymap, setCopilot } from '@/common/editor/copilot'
import { columnRuler } from '@/common/editor/ruler'
import { gotoDefExtension, type GotoCtx } from '@/common/editor/gotodef'
import { rainbowBrackets } from '@/common/editor/rainbowBrackets'
import { perSymbolColor } from '@/common/editor/perSymbolColor'
import { reviewField, reviewTheme, setReviewLines } from '@/common/editor/reviewDecoration'
import { relativeToRoot } from '@/utils/path'
import { colors } from '@/styles/tokens'
import { toast } from '@/toast'

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
  eachFnColor = false,
  theme = 'Czarny (domyślny)',
  root = '',
  closing = false,
  review = false,
  initialSnap = false,
  onSnapChange,
  initialGeom,
  onGeometry,
  onCursor
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
  // each function/class name gets its own stable color (perSymbolColor extension)
  eachFnColor?: boolean
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
  // initialGeom — zapamiętana geometria okna (pozycja/rozmiar/snap/fullscreen) ORAZ
  // pozycja kursora/scrolla, do odtworzenia po ponownym otwarciu projektu.
  initialGeom?: {
    x?: number
    y?: number
    w?: number
    h?: number
    snapped?: boolean
    fullscreen?: boolean
    cursor?: number
    scroll?: number
  }
  // onGeometry — zgłasza ustaloną geometrię okna (po przeciągnięciu/zmianie rozmiaru/
  // snapie/fullscreenie), by host mógł ją zapisać per projekt.
  onGeometry?: (path: string, geom: { x: number; y: number; w: number; h: number; snapped: boolean; fullscreen: boolean }) => void
  // onCursor — zgłasza pozycję kursora (offset) i scroll edytora (zapis per plik).
  onCursor?: (path: string, cursor: number, scroll: number) => void
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
  // Snap-on-open is a GLOBAL mode: a window opens snapped ONLY when the workspace already
  // has a top-snap active (initialSnap — another window is snapped to the top, or review
  // mode). A file's OWN remembered snap no longer forces it: reopening a once-snapped file
  // while nothing is snapped lands it as a flowing, centered window.
  const openSnapped = !!initialSnap

  // Initial window layout: when opening snapped, fill the scene. Otherwise restore the saved
  // FLOATING geometry if present — but never a remembered snap-fill rect (initialGeom.snapped),
  // which would reopen the window covering the scene instead of floating in the center; there
  // we fall back to the centered default.
  const [layout] = useState(() =>
    !openSnapped &&
    !initialGeom?.snapped &&
    initialGeom &&
    initialGeom.x != null &&
    initialGeom.y != null &&
    initialGeom.w != null &&
    initialGeom.h != null
      ? { pos: { x: initialGeom.x, y: initialGeom.y }, size: { w: initialGeom.w, h: initialGeom.h } }
      : initialEditorLayout(openSnapped, index)
  )
  const [size, setSize] = useState(layout.size)
  const [pos, setPos] = useState(layout.pos)
  // Whether this window currently fills the graph area ("top" snap). Reported up so the
  // host can open the next file snapped too.
  const snapRef = useRef(openSnapped)
  // Reaktywny odpowiednik snapRef (do renderu: zesnapowane okno nie ma cienia).
  const [snapped, setSnapped] = useState(openSnapped)

  // The shared <Window> owns the drag/resize/snap engine; these mirror its controlled
  // geometry into local state and reflect the snap flag up to the host (so a file opened
  // while another window is snapped opens snapped too).
  const onWinChange = (g: WindowGeom): void => {
    setPos({ x: g.x, y: g.y })
    setSize({ w: g.w, h: g.h })
  }

  const onWinSnapped = (s: boolean): void => {
    if (s === snapRef.current) {
      return
    }

    snapRef.current = s
    setSnapped(s)
    onSnapChange?.(s)
  }

  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [fullscreen, setFullscreen] = useState(!!initialGeom?.fullscreen)

  // Gdy okno jest zesnapowane do góry (wypełnia obszar sceny), podążaj za zmianą rozmiaru /
  // maksymalizacją okna głównego — przelicz pozycję i rozmiar do aktualnej sceny.
  useEffect(() => {
    const onResize = (): void => {
      if (!snapRef.current || fullscreen || minimized) {
        return
      }

      window.requestAnimationFrame(() => {
        const stage = sceneRect()

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

  // Zgłoś pozycję kursora + scroll do hosta (zapis per plik). reportCursor jest stabilny
  // (czyta refy), więc updateListener w extensions nie wymusza rekonfiguracji edytora.
  const onCursorRef = useRef(onCursor)
  onCursorRef.current = onCursor
  const cursorTimer = useRef<number | undefined>(undefined)
  const reportCursor = useRef<(view: EditorView) => void>(() => undefined)

  reportCursor.current = (view: EditorView): void => {
    const path = target?.path

    if (!path || !onCursorRef.current) {
      return
    }

    window.clearTimeout(cursorTimer.current)
    cursorTimer.current = window.setTimeout(() => {
      onCursorRef.current?.(path, view.state.selection.main.head, view.scrollDOM?.scrollTop ?? 0)
    }, 400)
  }

  useEffect(() => () => window.clearTimeout(cursorTimer.current), [])
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

  // Ctrl/Cmd+click on an import string → open the referenced file in the editor.
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

  // The theme extension is seeded by the file's name and its package/folder. For the "🎲 random"
  // modes the seed deterministically PICKS a preset (so a file keeps a stable colour across
  // reopens); for the "🧬 autogen" modes it SYNTHESIZES a whole scheme from that seed; a fixed
  // theme passes through unchanged. fileKey = base name without extension (the class/function
  // file); pkgKey = the parent folder/package name.
  const pathSegments = (target?.path ?? '').split(/[\\/]/)
  const fileKey = (pathSegments.pop() ?? '').replace(/\.[^.]+$/, '')
  const pkgKey = pathSegments.pop() ?? ''
  const themeExtension = useMemo(
    () => resolveEditorTheme(theme, fileKey, pkgKey),
    [theme, fileKey, pkgKey]
  )

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
        },
        // Vim: podwójny klik stawia kursor w TYM miejscu kodu i wchodzi w insert mode (a nie
        // nawiguje jak link), żeby od razu pisać.
        dblclick(e, view) {
          if (!vimMode) {
            return false
          }

          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })

          if (pos == null) {
            return false
          }

          e.preventDefault()
          view.dispatch({ selection: { anchor: pos } })
          view.focus()

          const cm = getCM(view)

          if (cm) {
            Vim.handleKey(cm, 'i', 'mapping')
          }

          return true
        }
      }),
      gotoDefExtension(gotoCtxRef),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged || u.geometryChanged) {
          reportCursor.current(u.view)
        }
      }),
      ...(rainbow ? [rainbowBrackets()] : []),
      ...(eachFnColor ? [perSymbolColor()] : []),
      ghostField,
      ghostWidthPlugin,
      reviewField,
      reviewTheme,
      columnRuler(80),
      themeExtension,
      editorTheme
    ],
    [vimMode, rainbow, eachFnColor, themeExtension, target?.path]
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

  // F5 / 'editor:reload': re-read this file from disk (discarding unsaved buffer changes) so
  // the editor reflects what's on disk now. Empty path = reload every open editor.
  useEffect(() => {
    if (!target) {
      return
    }

    return appBus.on('editor:reload', ({ path }) => {
      if (path && path !== target.path) {
        return
      }

      setLoading(true)

      window.api
        .readFile(target.path)
        .then((c) => {
          setOriginal(c)
          setContent(c)
          setLoading(false)
        })
        .catch(() => setLoading(false))
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

  // Odtwórz zapamiętaną pozycję kursora + scroll po wczytaniu pliku — TYLKO gdy nie ma
  // jawnej nawigacji do funkcji/linii (te mają pierwszeństwo). Raz na otwarcie pliku.
  const cursorRestored = useRef(false)

  useEffect(() => {
    if (loading || cursorRestored.current) {
      return
    }

    if (target?.gotoLine != null || target?.gotoFn || initialGeom?.cursor == null) {
      cursorRestored.current = true

      return
    }

    const view = ref.current?.view

    if (!view) {
      return
    }

    const anchor = Math.min(Math.max(initialGeom.cursor, 0), view.state.doc.length)
    view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })

    if (initialGeom.scroll != null) {
      const top = initialGeom.scroll
      window.requestAnimationFrame(() => {
        const sc = ref.current?.view?.scrollDOM

        if (sc) {
          sc.scrollTop = top
        }
      })
    }

    cursorRestored.current = true
  }, [loading, content, target?.path])

  // Gdy to okno staje się aktywne (przełączenie oknem — ALT+strzałki lub przyciski myszy
  // wstecz/dalej), ustaw fokus na edytorze. Okna pozostają zamontowane, więc CodeMirror
  // zachowuje swój kursor — fokus przywraca go dokładnie tam, gdzie był przy ostatnim
  // opuszczeniu tego okna. Pomijamy, gdy otwarte jest pole wyszukiwania (fokus należy do niego).
  useEffect(() => {
    if (!active || loading || minimized || findOpen) {
      return
    }

    const id = window.setTimeout(() => ref.current?.view?.focus(), 0)

    return () => window.clearTimeout(id)
  }, [active, loading, minimized, findOpen])

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
              prefix: m.severity === 2 ? '⛔' : '⚠️' // ikona zależna od typu: błąd / ostrzeżenie
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
        .then((rs) => setReviewRemarks(rs.map((r) => ({ line: r.line, text: r.text, color: '#6e7681', prefix: '💬' }))))
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
    <Window
      className="editor-window"
      x={pos.x}
      y={pos.y}
      w={size.w}
      h={size.h}
      snapped={snapped}
      coordinate="fixed"
      active={active}
      disabled={fullscreen}
      minWidth={360}
      minHeight={240}
      zIndex={active ? 1300 : 1200}
      getScene={sceneRect}
      onActivate={() => onActivate?.()}
      onChange={onWinChange}
      onSnappedChange={onWinSnapped}
      style={{
        background: '#000',
        transition: `opacity ${EDITOR_FADE_MS}ms ease`,
        opacity: closing || !shown ? 0 : 1,
        ...(fullscreen ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0, boxShadow: 'none' } : null)
      }}
      header={
        <Header style={{ cursor: fullscreen ? 'default' : 'move' }}>
          <Title style={{ cursor: fullscreen ? 'default' : 'move' }}>
            {relativeToRoot(target?.path ?? '', root)}
            {dirty ? ' •' : ''}
          </Title>
          {/* Controls stop mousedown here so clicking them never starts a window drag. */}
          <div onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
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
          </div>
        </Header>
      }
    >
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
    </Window>

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

// sceneRect resolves the bounding box of the view scene — the area right of the file
// tree, below the top bar/tabs and above the agent bar — that editor windows snap into.
//
// In the multi-view shell the scene is the ViewHost slot (id 'editor-scene'); the old
// graph layout exposed it as id 'graph-stage'. We try both ids (newest first) so the
// snap keeps working across the architecture change, then fall back to the editor view's
// backdrop. Returns null when none is mounted (e.g. another view is active).
function sceneRect(): DOMRect | null {
  const el =
    document.getElementById('editor-scene') ??
    document.getElementById('graph-stage') ??
    document.querySelector<HTMLElement>('[data-editor-scene]')

  if (!el) {
    return null
  }

  const rect = el.getBoundingClientRect()

  // A maximized (top-snapped) window must NEVER cover the file tree. When the tree is visible
  // and overlaps the scene's left edge, start the scene at the tree's right edge instead, so a
  // window filling the scene stops at the tree.
  const tree = document.querySelector('.js-file-tree')

  if (tree) {
    const tr = tree.getBoundingClientRect()

    if (tr.width > 0 && tr.right > rect.left && tr.right < rect.right) {
      return new DOMRect(tr.right, rect.top, rect.right - tr.right, rect.height)
    }
  }

  return rect
}

// initialEditorLayout computes a new editor window's starting position/size. With
// `snap`, it opens filling the scene area (matching the top-snap), so a file opened
// while another editor is snapped to the top lands snapped too; otherwise it opens
// centered at ~half width, fanned out by index.
function initialEditorLayout(
  snap: boolean,
  index: number
): { pos: { x: number; y: number }; size: { w: number; h: number } } {
  if (snap) {
    const stage = sceneRect()

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
