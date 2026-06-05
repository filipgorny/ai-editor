import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, Button, CircularProgress, FormControlLabel, Switch, Snackbar, Alert } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import MinimizeIcon from '@mui/icons-material/Minimize'
import styled from 'styled-components'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { themeExt } from './themes'
import { vim, getCM } from '@replit/codemirror-vim'
import { Prec } from '@codemirror/state'
import { ghostField, setGhostRemarks, remarkKey, type Remark } from './reviewGhost'
import { copilotField, copilotKeymap, setCopilot } from './copilot'
import { columnRuler } from './ruler'
import { relativeToRoot } from '../utils/path'
import { colors } from '../styles/tokens'

export type EditorTarget = { path: string; gotoFn?: string }

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
    '.cm-gutters': { border: 'none', fontFamily: 'Hack, monospace', minHeight: '100%' }
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
  theme = 'Czarny (domyślny)',
  root = ''
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
  theme?: string
  root?: string
}) {
  const { t } = useTranslation()
  // pozycja pływającego okna (przeciągane za pasek tytułu); kolejne z przesunięciem
  const [pos, setPos] = useState({ x: 90 + index * 34, y: 60 + index * 34 })
  // rozmiar okna (zmieniany Alt + środkowy przycisk myszy)
  const [size, setSize] = useState({ w: Math.round(window.innerWidth * 0.72), h: Math.round(window.innerHeight * 0.8) })

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onActivate?.()
    const start = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y, w: size.w, h: size.h }

    const move = (ev: MouseEvent) => {
      // Snap NA ŻYWO tylko przy samej KRAWĘDZI EKRANU (wąska strefa, by nie skakać).
      const TREE = 380
      const SNAP = 14
      const usable = window.innerWidth - TREE
      const halfW = Math.round(usable / 2)
      const fullH = window.innerHeight

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

      // poza strefą snap — zwykłe przesuwanie, przywróć pierwotny rozmiar
      setSize({ w: start.w, h: start.h })
      setPos({ x: start.px + ev.clientX - start.mx, y: start.py + ev.clientY - start.my })
    }

    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
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
  const [fullscreen, setFullscreen] = useState(false)
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

  // vim() musi być pierwszy (najwyższy priorytet klawiszy). oneDark daje kolory
  // składni, editorTheme (Prec.highest) wymusza czarne tło + Hack, ghostField
  // renderuje uwagi (aktualizowane efektem). Bez lineWrapping — dymki idą w prawo.
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
          gotoDef(spec)

          return true
        }
      }),
      ghostField,
      columnRuler(80),
      themeExt(theme),
      editorTheme
    ],
    [vimMode, gotoDef, theme]
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
        setContent(c)
        setOriginal(c)
        setLoading(false)
        // event: wejście do pliku
        window.api.publishEvent({ type: 'open', title: t('events.open'), file: target.path })
      })
      .catch(() => {
        setContent(t('editor.loadError'))
        setLoading(false)
      })
  }, [target?.path])

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
        .aiReview(content, target.path)
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

          // obetnij to, co już jest napisane w bieżącej linii (model lubi powtarzać)
          const text = stripOverlap(prefix, raw)

          if (vv && vv.state.selection.main.head === p && text && text.trim()) {
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

  const runAi = async () => {
    if (!target || !prompt.trim() || busy) {
      return
    }

    const before = content
    setBusy(true)

    try {
      const next = await window.api.aiEdit(before, prompt, target.path)

      setPrompt('')

      if (next && next !== before) {
        animateDiff(before, next)
      }
    } finally {
      setBusy(false)
    }
  }

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
          ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0, zIndex: active ? 1300 : 1200 }
          : { left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: active ? 1300 : 1200 }
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
          sx={
            dirty
              ? { bgcolor: '#da3633', color: '#fff', '&:hover': { bgcolor: '#b62324' } }
              : { color: '#8b949e' }
          }
        >
          {t('editor.save')}
        </Button>
        <IconButton size="small" onClick={() => onMinimize?.()} title={t('editor.minimize')}>
          <MinimizeIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => setFullscreen((v) => !v)}>
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
          <CodeMirror
            ref={ref}
            value={content}
            height="100%"
            theme="none"
            extensions={extensions}
            onChange={setContent}
          />
        )}
      </EditorWrap>

      <PromptBar>
        <PromptInput
          rows={2}
          placeholder={t('agent.placeholderEditor')}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              runAi()
            }
          }}
        />
        <Button variant="contained" size="small" onClick={runAi} disabled={busy} sx={{ minWidth: 96 }}>
          {busy ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            (model.includes(':') ? model.slice(model.indexOf(':') + 1) : model) || t('agent.send')
          )}
        </Button>
      </PromptBar>

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
