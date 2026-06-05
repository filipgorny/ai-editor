import { forwardRef, useMemo } from 'react'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { Prec, type Extension } from '@codemirror/state'
import { vim as vimExt } from '@replit/codemirror-vim'
import { themeExt } from './themes'
import { columnRuler } from './ruler'

// Shared font/height theme: Hack 18px, full height so the active theme background fills down
// even for short files (the theme paints the bg on .cm-editor).
const baseTheme = Prec.highest(
  EditorView.theme({
    '&': { fontSize: '18px', fontFamily: 'Hack, monospace', height: '100%', minHeight: '100%' },
    '.cm-editor': { height: '100%', minHeight: '100%' },
    '.cm-scroller': { fontFamily: 'Hack, monospace', minHeight: '100%' },
    '.cm-content': { fontFamily: 'Hack, monospace', minHeight: '100%' },
    '.cm-gutters': { border: 'none', fontFamily: 'Hack, monospace', minHeight: '100%' }
  })
)

const NONE: Extension[] = []

export type CodeMirrorEditorProps = {
  value: string
  onChange?: (value: string) => void
  theme?: string
  vim?: boolean
  ruler?: number | null
  height?: string
  placeholder?: string
  // prepend runs before vim (keymaps); extra runs after the language (handlers/fields).
  prepend?: Extension[]
  extra?: Extension[]
  // Full override — when given, it's used verbatim and the defaults above are ignored. The
  // floating file editor passes its own (copilot, lint ghosts, goto-def, …); the scripts
  // editor omits it to get the shared default.
  extensions?: Extension[]
}

// CodeMirrorEditor — the one code-editing surface shared by the floating file editor and the
// scripts editor: CodeMirror with the app theme, JS/TS highlighting, optional Vim and a ruler.
const CodeMirrorEditor = forwardRef<ReactCodeMirrorRef, CodeMirrorEditorProps>(function CodeMirrorEditor(
  {
    value,
    onChange,
    theme = 'Czarny (domyślny)',
    vim = false,
    ruler = 80,
    height = '100%',
    placeholder,
    prepend = NONE,
    extra = NONE,
    extensions: override
  },
  ref
) {
  const built = useMemo(
    () => [
      ...prepend,
      ...(vim ? [Prec.highest(vimExt())] : []),
      javascript({ jsx: true, typescript: true }),
      ...extra,
      ...(ruler ? [columnRuler(ruler)] : []),
      themeExt(theme),
      baseTheme
    ],
    [vim, theme, ruler, prepend, extra]
  )

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height={height}
      theme="none"
      extensions={override ?? built}
      onChange={onChange}
      placeholder={placeholder}
    />
  )
})

export default CodeMirrorEditor
