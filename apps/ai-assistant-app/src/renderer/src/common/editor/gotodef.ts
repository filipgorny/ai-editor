import { StateField, StateEffect, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { Vim } from '@replit/codemirror-vim'

// Go-to-definition. The actual code analysis is done by the SCANNER service (tree-sitter,
// LSP later): it returns the navigable spans of the file and where each resolves to. This
// module only renders them — underline the hovered link, and on click / Vim `gd` open the
// target file at the definition line. The editor stays a thin client.

// RawLink mirrors the scanner result: 0-based line/col span + resolved target file/line.
export type RawLink = {
  fromLine: number
  fromCol: number
  toLine: number
  toCol: number
  targetPath: string
  targetLine: number
}

export type GotoOpen = (targetPath: string, targetLine: number) => void
export type GotoFetch = (content: string) => Promise<RawLink[]>
export type GotoCtx = { fetch: GotoFetch; open: GotoOpen }
type CtxRef = { current: GotoCtx | null }

// A link mapped to document offsets (kept valid across edits until the next fetch).
type Resolved = { from: number; to: number; targetPath: string; targetLine: number }

// ctxField carries the host's fetch/open callbacks (read by the fetcher and the Vim action).
const ctxField = StateField.define<CtxRef | null>({ create: () => null, update: (v) => v })

const setLinks = StateEffect.define<Resolved[]>()

const linksField = StateField.define<Resolved[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setLinks)) {
        return e.value
      }
    }

    if (tr.docChanged) {
      return v
        .map((l) => ({ ...l, from: tr.changes.mapPos(l.from), to: tr.changes.mapPos(l.to) }))
        .filter((l) => l.from < l.to)
    }

    return v
  }
})

const setHover = StateEffect.define<{ from: number; to: number } | null>()

const hoverField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setHover)) {
        return e.value
      }
    }

    if (tr.docChanged && v) {
      return null
    }

    return v
  },
  provide: (f) =>
    EditorView.decorations.compute([f], (state) => {
      const v = state.field(f)

      if (!v || v.from >= v.to) {
        return Decoration.none as DecorationSet
      }

      return Decoration.set([Decoration.mark({ class: 'cm-gotodef-link' }).range(v.from, v.to)])
    })
})

const linkTheme = EditorView.theme({
  '.cm-gotodef-link': {
    textDecoration: 'underline',
    textDecorationColor: '#58a6ff',
    textUnderlineOffset: '3px',
    cursor: 'pointer'
  }
})

// toOffsets converts scanner line/col spans into document offsets for the current doc.
function toOffsets(view: EditorView, raw: RawLink[]): Resolved[] {
  const doc = view.state.doc
  const out: Resolved[] = []

  for (const l of raw) {
    if (l.fromLine >= doc.lines || l.toLine >= doc.lines || !l.targetPath) {
      continue
    }

    const fl = doc.line(l.fromLine + 1)
    const tl = doc.line(l.toLine + 1)
    const from = Math.min(fl.from + l.fromCol, fl.to)
    const to = Math.min(tl.from + l.toCol, tl.to)

    if (from < to) {
      out.push({ from, to, targetPath: l.targetPath, targetLine: l.targetLine })
    }
  }

  return out
}

// fetcher asks the scanner for links on mount and (debounced) after every edit.
const fetcher = ViewPlugin.fromClass(
  class {
    timer = 0
    seq = 0

    constructor(readonly view: EditorView) {
      this.schedule(0)
    }

    update(u: ViewUpdate): void {
      if (u.docChanged) {
        this.schedule(300)
      }
    }

    schedule(delay: number): void {
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.run(), delay)
    }

    run(): void {
      const ctx = this.view.state.field(ctxField, false)?.current

      if (!ctx) {
        return
      }

      const mine = ++this.seq
      const content = this.view.state.doc.toString()

      ctx
        .fetch(content)
        .then((raw) => {
          // ignore if superseded or the buffer changed while analyzing (offsets would drift)
          if (mine !== this.seq || this.view.state.doc.toString() !== content) {
            return
          }

          this.view.dispatch({ effects: setLinks.of(toOffsets(this.view, raw)) })
        })
        .catch(() => undefined)
    }

    destroy(): void {
      window.clearTimeout(this.timer)
    }
  }
)

function linkAt(view: EditorView, pos: number): Resolved | null {
  for (const l of view.state.field(linksField, false) ?? []) {
    if (pos >= l.from && pos <= l.to) {
      return l
    }
  }

  return null
}

function gotoAt(view: EditorView, pos: number): boolean {
  const hit = linkAt(view, pos)

  if (!hit) {
    return false
  }

  view.state.field(ctxField, false)?.current?.open(hit.targetPath, hit.targetLine)

  return true
}

const handlers = EditorView.domEventHandlers({
  mousemove(e, view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    const hit = pos == null ? null : linkAt(view, pos)
    const cur = view.state.field(hoverField, false) ?? null

    if (hit) {
      if (!cur || cur.from !== hit.from || cur.to !== hit.to) {
        view.dispatch({ effects: setHover.of({ from: hit.from, to: hit.to }) })
      }
    } else if (cur) {
      view.dispatch({ effects: setHover.of(null) })
    }

    return false
  },
  mouseleave(_e, view) {
    if (view.state.field(hoverField, false)) {
      view.dispatch({ effects: setHover.of(null) })
    }

    return false
  },
  mousedown(e, view) {
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) {
      return false
    }

    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })

    if (pos != null && gotoAt(view, pos)) {
      e.preventDefault()
      // Stop the click bubbling to the source window's onActivate — otherwise it would
      // re-activate the source after openFile activated the target, leaving the newly
      // opened file behind the source window.
      e.stopPropagation()

      return true
    }

    return false
  }
})

// Register the Vim `gd` command once, globally. It reads the focused view's ctxField/linksField,
// so a single mapping serves every editor.
let vimRegistered = false

function registerVimGotoDef(): void {
  if (vimRegistered) {
    return
  }

  vimRegistered = true
  Vim.defineAction(
    'goToDefinition',
    ((cm: { cm6?: EditorView }) => {
      const view = cm?.cm6

      if (view) {
        gotoAt(view, view.state.selection.main.head)
      }
    }) as Parameters<typeof Vim.defineAction>[1]
  )
  Vim.mapCommand('gd', 'action', 'goToDefinition', {}, { context: 'normal' })
}

// gotoDefExtension wires the feature into one editor. `ctxRef.current` provides fetch (→ scanner)
// and open (→ host opens the target file at the definition line).
export function gotoDefExtension(ctxRef: CtxRef): Extension {
  registerVimGotoDef()

  return [ctxField.init(() => ctxRef), linksField, hoverField, fetcher, handlers, linkTheme]
}
