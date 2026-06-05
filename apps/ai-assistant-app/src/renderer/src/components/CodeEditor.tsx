import { useEffect, useRef, useState } from 'react'
import { Dialog, IconButton, Button, CircularProgress } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import styled from 'styled-components'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { colors } from '../styles/tokens'

export type EditorTarget = { path: string; gotoFn?: string }

// Czarne tło + o punkt większa czcionka.
const editorTheme = EditorView.theme({
  '&': { fontSize: '15px', backgroundColor: '#000' },
  '.cm-gutters': { backgroundColor: '#000', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-activeLineGutter': { backgroundColor: '#000' }
})

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
  font-size: 13px;
  color: ${colors.muted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EditorWrap = styled.div`
  flex: 1;
  overflow: auto;
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

const PromptInput = styled.input`
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  color: #e6edf3;
  font-size: 14px;
  outline: none;

  &:focus {
    border-color: ${colors.controller};
  }
`

// CodeEditor: edytor pliku z podświetlaniem (CodeMirror) + na dole prompt AI,
// który może zmienić zawartość edytora.
export default function CodeEditor({ target, onClose }: { target: EditorTarget | null; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<ReactCodeMirrorRef>(null)

  const dirty = content !== original

  useEffect(() => {
    if (!target) {
      return
    }

    setLoading(true)

    window.api
      .readFile(target.path)
      .then((c) => {
        setContent(c)
        setOriginal(c)
        setLoading(false)
        // event: wejście do pliku
        window.api.publishEvent({ type: 'open', title: 'Otwarto plik', file: target.path })
      })
      .catch(() => {
        setContent('// nie udało się wczytać pliku')
        setLoading(false)
      })
  }, [target?.path])

  // Ctrl/Cmd+S → zapis.
  useEffect(() => {
    if (!target) {
      return
    }

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [target?.path, content])

  // Przewinięcie do funkcji + podświetlenie jej linii. Z opóźnieniem, bo zaraz
  // po wczytaniu treści CodeMirror może jeszcze nie być rozłożony.
  useEffect(() => {
    if (!target?.gotoFn) {
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
      // zaznaczenie całej linii = podświetlone tło; scroll z y:'start' ustawia
      // deklarację funkcji na pierwszej linii widoku (o ile to możliwe).
      view.dispatch({
        selection: { anchor: line.from, head: line.to },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 6 })
      })
      view.focus()
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [content, target?.gotoFn])

  const save = async () => {
    if (!target) {
      return
    }

    await window.api.saveFile(target.path, content)
    setOriginal(content)
    // event: zapis pliku
    window.api.publishEvent({ type: 'save', title: 'Zapisano plik', file: target.path })
  }

  const saveAndClose = async () => {
    await save()
    onClose()
  }

  // Zamknięcie z potwierdzeniem, gdy są niezapisane zmiany.
  const handleClose = () => {
    if (dirty && !window.confirm('Masz niezapisane zmiany. Porzucić je?')) {
      return
    }

    onClose()
  }

  // animateDiff animuje TYLKO zmienioną część (wspólny prefiks/sufiks zostają),
  // przewijając do miejsca zmiany.
  const animateDiff = (oldText: string, newText: string) => {
    let p = 0

    while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) {
      p++
    }

    let s = 0

    while (
      s < oldText.length - p &&
      s < newText.length - p &&
      oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]
    ) {
      s++
    }

    const prefix = newText.slice(0, p)
    const suffix = newText.slice(newText.length - s)
    const middle = newText.slice(p, newText.length - s)

    let i = 0
    const step = Math.max(1, Math.ceil(middle.length / 120))

    const tick = () => {
      i = Math.min(middle.length, i + step)
      setContent(prefix + middle.slice(0, i) + suffix)

      const view = ref.current?.view

      if (view) {
        const at = Math.min(view.state.doc.length, prefix.length + i)
        view.dispatch({ selection: { anchor: at }, scrollIntoView: true })
      }

      if (i < middle.length) {
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

  return (
    <Dialog
      open={!!target}
      onClose={handleClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { bgcolor: '#0d1117', height: '85vh', display: 'flex', flexDirection: 'column' } }}
    >
      <Header>
        <Title>
          {target?.path}
          {dirty ? ' •' : ''}
        </Title>
        <Button size="small" startIcon={<SaveIcon />} onClick={save} disabled={!dirty}>
          Zapisz
        </Button>
        <Button size="small" variant="contained" onClick={saveAndClose}>
          Zapisz i zamknij
        </Button>
        <IconButton size="small" onClick={handleClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Header>

      <EditorWrap>
        {loading ? (
          <Loading>Wczytywanie…</Loading>
        ) : (
          <CodeMirror
            ref={ref}
            value={content}
            height="100%"
            theme={oneDark}
            extensions={[javascript({ jsx: true, typescript: true }), EditorView.lineWrapping, editorTheme]}
            onChange={setContent}
          />
        )}
      </EditorWrap>

      <PromptBar>
        <PromptInput
          placeholder="W czym mogę pomóc?"
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
        <Button variant="contained" size="small" onClick={runAi} disabled={busy} sx={{ minWidth: 80 }}>
          {busy ? <CircularProgress size={16} color="inherit" /> : 'Wyślij'}
        </Button>
      </PromptBar>
    </Dialog>
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
