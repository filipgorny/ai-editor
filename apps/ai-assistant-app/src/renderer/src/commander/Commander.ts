// Commander — a single, app-wide command dispatcher. Where the event bus (appBus) is
// for *reacting* to what happened, the Commander is for *driving* the app: a flat list
// of named commands ("write:text", "cursor:up", "open:src/foo.ts") that user scripts —
// or the app itself — can run to type text, move the cursor, open files, and more.
//
// Syntax: a command string is `name:arg` — everything up to the FIRST colon is the
// command name, everything after it is the raw argument (colons and spaces preserved,
// so `write:foo: bar` writes the literal `foo: bar`). Commands with no argument are
// just their name (`save`, `close`). See COMMANDS.md for the full catalog.
//
// Exposed globally as window.commander — the hook point for scripts, alongside appBus.

import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { appBus } from '../events'

// EditorHandle — the slice of the active editor window the Commander drives. The active
// CodeEditor registers one of these via bindEditor(); methods read live state so the
// handle never goes stale.
export type EditorHandle = {
  path: string
  getView: () => EditorView | null
  save: () => void | Promise<void>
  runPrompt: (prompt: string) => void | Promise<void>
  find: (text: string) => void
  gotoFn: (fn: string) => void
  setFullscreen: (on: boolean | 'toggle') => void
}

// CommanderHost — app-level actions wired once by App.tsx (open/close editors, switch
// tabs, pick a project, run the agent). Kept optional so the Commander degrades to a
// no-op rather than throwing when something isn't wired yet.
export type CommanderHost = {
  openFile: (path: string, fn?: string) => void
  closeEditor: (path: string) => void
  selectEditor: (path: string) => void
  minimizeEditor: (path: string) => void
  listEditors: () => string[]
  activePath: () => string
  pickProject: () => void
  refresh: () => void
  runAgent: (prompt: string) => void | Promise<void>
  resolvePath: (p: string) => string
}

export type CommandResult = { ok: boolean; error?: string }

// CommandSpec — one registered command. `params` documents the expected argument (for
// help / COMMANDS.md); `run` does the work and may throw — run() turns that into an error.
export type CommandSpec = {
  name: string
  group: string
  params: string
  summary: string
  run: (arg: string) => void | Promise<void>
}

class Commander {
  private commands = new Map<string, CommandSpec>()
  private active: EditorHandle | null = null
  private host: Partial<CommanderHost> = {}

  constructor() {
    this.registerBuiltins()
  }

  // — wiring (called by components) —

  bindEditor(handle: EditorHandle): void {
    this.active = handle
  }

  unbindEditor(handle: EditorHandle): void {
    if (this.active === handle) {
      this.active = null
    }
  }

  setHost(host: Partial<CommanderHost>): void {
    this.host = host
  }

  // — public API (called by scripts) —

  // register adds (or overrides) a command — the extension point for user scripts.
  register(spec: CommandSpec): void {
    this.commands.set(spec.name, spec)
  }

  has(name: string): boolean {
    return this.commands.has(name)
  }

  list(): CommandSpec[] {
    return [...this.commands.values()]
  }

  // run parses one command string and dispatches it. Unknown commands and thrown errors
  // are reported on appBus ('command:error') and returned as { ok:false }.
  async run(input: string): Promise<CommandResult> {
    const trimmed = input.trim()

    if (!trimmed) {
      return { ok: false, error: 'empty command' }
    }

    const colon = trimmed.indexOf(':')
    const name = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim()
    // arg keeps everything after the first colon verbatim (whitespace matters for write).
    const arg = colon === -1 ? '' : trimmed.slice(colon + 1)
    const cmd = this.commands.get(name)

    if (!cmd) {
      const message = `unknown command: ${name}`
      appBus.emit('command:error', { name, arg, message })

      return { ok: false, error: message }
    }

    try {
      await cmd.run(arg)
      appBus.emit('command:run', { name, arg })

      return { ok: true }
    } catch (e) {
      const message = String((e as Error)?.message || e)
      appBus.emit('command:error', { name, arg, message })
      console.error(`[commander] "${name}" failed`, e)

      return { ok: false, error: message }
    }
  }

  // runScript runs several commands in order, one per line (blank lines and #-comments
  // skipped). Stops at the first failure and returns it.
  async runScript(text: string): Promise<CommandResult> {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

    for (const line of lines) {
      const res = await this.run(line)

      if (!res.ok) {
        return res
      }
    }

    return { ok: true }
  }

  // — internals —

  // view returns the active editor's CodeMirror view or throws — editor commands call it.
  private view(): EditorView {
    const v = this.active?.getView() ?? null

    if (!v) {
      throw new Error('no active editor')
    }

    return v
  }

  private editor(): EditorHandle {
    if (!this.active) {
      throw new Error('no active editor')
    }

    return this.active
  }

  // setCursor collapses the selection to a single caret at pos and scrolls to it.
  private setCursor(view: EditorView, pos: number): void {
    const clamped = Math.max(0, Math.min(view.state.doc.length, pos))

    view.dispatch({
      selection: EditorSelection.cursor(clamped),
      effects: EditorView.scrollIntoView(clamped, { y: 'center' })
    })
    view.focus()
  }

  // resolveMove maps a direction keyword to the target offset from the current caret.
  // Shared by `cursor` (collapses) and `extend` (keeps the anchor → grows the selection).
  private resolveMove(view: EditorView, dir: string): number {
    const r = view.state.selection.main
    const doc = view.state.doc

    switch (dir) {
      case 'left':
        return view.moveByChar(r, false).head

      case 'right':
        return view.moveByChar(r, true).head

      case 'wordLeft':
        return view.moveByGroup(r, false).head

      case 'wordRight':
        return view.moveByGroup(r, true).head

      case 'up':
        return view.moveVertically(r, false).head

      case 'down':
        return view.moveVertically(r, true).head

      case 'lineStart':
      case 'home':
        return doc.lineAt(r.head).from

      case 'lineEnd':
      case 'end':
        return doc.lineAt(r.head).to

      case 'docStart':
      case 'top':
        return 0

      case 'docEnd':
      case 'bottom':
        return doc.length

      default:
        throw new Error(`nieznany kierunek "${dir}"`)
    }
  }

  // selectedLineRange returns the 1-based first/last line numbers spanned by the main
  // selection — the basis for line-wise commands (comment, indent, move, …).
  private selectedLineRange(view: EditorView): { first: number; last: number } {
    const r = view.state.selection.main

    return { first: view.state.doc.lineAt(r.from).number, last: view.state.doc.lineAt(r.to).number }
  }

  // transformCase upper/lower-cases the selection, or the word under the caret if empty.
  private transformCase(upper: boolean): void {
    const view = this.view()
    const main = view.state.selection.main
    const span = main.empty ? view.state.wordAt(main.head) : main

    if (!span) {
      return
    }

    const text = view.state.doc.sliceString(span.from, span.to)

    view.dispatch({
      changes: { from: span.from, to: span.to, insert: upper ? text.toUpperCase() : text.toLowerCase() },
      selection: EditorSelection.range(span.from, span.to)
    })
    view.focus()
  }

  private registerBuiltins(): void {
    const def = (spec: CommandSpec): void => this.register(spec)

    // ——————————————————————————— Text editing ———————————————————————————

    def({
      name: 'write',
      group: 'Edycja',
      params: 'text',
      summary: 'Wstawia tekst w miejscu kursora (zastępując zaznaczenie).',
      run: (arg) => {
        const view = this.view()

        view.dispatch(view.state.replaceSelection(arg))
        view.focus()
      }
    })

    def({
      name: 'newline',
      group: 'Edycja',
      params: '—',
      summary: 'Wstawia nową linię w miejscu kursora.',
      run: () => {
        const view = this.view()

        view.dispatch(view.state.replaceSelection('\n'))
        view.focus()
      }
    })

    def({
      name: 'tab',
      group: 'Edycja',
      params: '—',
      summary: 'Wstawia wcięcie (dwie spacje) w miejscu kursora.',
      run: () => {
        const view = this.view()

        view.dispatch(view.state.replaceSelection('  '))
        view.focus()
      }
    })

    def({
      name: 'backspace',
      group: 'Edycja',
      params: '—',
      summary: 'Usuwa znak przed kursorem (lub zaznaczenie).',
      run: () => {
        const view = this.view()
        const r = view.state.selection.main

        if (!r.empty) {
          view.dispatch(view.state.replaceSelection(''))
        } else if (r.from > 0) {
          view.dispatch({ changes: { from: r.from - 1, to: r.from }, selection: EditorSelection.cursor(r.from - 1) })
        }

        view.focus()
      }
    })

    def({
      name: 'delete',
      group: 'Edycja',
      params: '[line]',
      summary: 'Bez argumentu: usuwa znak po kursorze/zaznaczenie. `delete:line`: usuwa bieżącą linię.',
      run: (arg) => {
        const view = this.view()
        const r = view.state.selection.main

        if (arg.trim() === 'line') {
          const line = view.state.doc.lineAt(r.head)
          const to = Math.min(view.state.doc.length, line.to + 1)

          view.dispatch({ changes: { from: line.from, to }, selection: EditorSelection.cursor(line.from) })
          view.focus()

          return
        }

        if (!r.empty) {
          view.dispatch(view.state.replaceSelection(''))
        } else if (r.to < view.state.doc.length) {
          view.dispatch({ changes: { from: r.to, to: r.to + 1 } })
        }

        view.focus()
      }
    })

    def({
      name: 'clear',
      group: 'Edycja',
      params: '—',
      summary: 'Czyści całą zawartość edytora.',
      run: () => {
        const view = this.view()

        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
        view.focus()
      }
    })

    def({
      name: 'replace',
      group: 'Edycja',
      params: 'old::new',
      summary: 'Zastępuje wszystkie wystąpienia `old` przez `new` w całym pliku.',
      run: (arg) => {
        const sep = arg.indexOf('::')

        if (sep === -1) {
          throw new Error('replace wymaga formatu old::new')
        }

        const view = this.view()
        const from = arg.slice(0, sep)
        const to = arg.slice(sep + 2)

        if (!from) {
          throw new Error('replace: puste `old`')
        }

        const next = view.state.doc.toString().split(from).join(to)

        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
        view.focus()
      }
    })

    def({
      name: 'duplicate',
      group: 'Edycja',
      params: '—',
      summary: 'Duplikuje zaznaczenie, a bez zaznaczenia — bieżącą linię.',
      run: () => {
        const view = this.view()
        const r = view.state.selection.main
        const doc = view.state.doc

        if (!r.empty) {
          const text = doc.sliceString(r.from, r.to)

          view.dispatch({ changes: { from: r.to, insert: text }, selection: EditorSelection.range(r.to, r.to + text.length) })
        } else {
          const line = doc.lineAt(r.head)

          view.dispatch({ changes: { from: line.to, insert: '\n' + line.text }, selection: EditorSelection.cursor(r.head + line.text.length + 1) })
        }

        view.focus()
      }
    })

    def({
      name: 'move',
      group: 'Edycja',
      params: 'up|down',
      summary: 'Przenosi bieżącą linię o jedną w górę/dół (zamienia z sąsiednią).',
      run: (arg) => {
        const view = this.view()
        const doc = view.state.doc
        const r = view.state.selection.main
        const line = doc.lineAt(r.head)
        const dir = arg.trim()

        if (dir === 'up') {
          if (line.number <= 1) {
            return
          }

          const prev = doc.line(line.number - 1)

          view.dispatch({
            changes: { from: prev.from, to: line.to, insert: line.text + '\n' + prev.text },
            selection: EditorSelection.cursor(prev.from + (r.head - line.from))
          })
        } else if (dir === 'down') {
          if (line.number >= doc.lines) {
            return
          }

          const next = doc.line(line.number + 1)

          view.dispatch({
            changes: { from: line.from, to: next.to, insert: next.text + '\n' + line.text },
            selection: EditorSelection.cursor(line.from + next.text.length + 1 + (r.head - line.from))
          })
        } else {
          throw new Error('move: użyj up|down')
        }

        view.focus()
      }
    })

    def({
      name: 'join',
      group: 'Edycja',
      params: '—',
      summary: 'Dołącza następną linię do bieżącej (jedną spacją).',
      run: () => {
        const view = this.view()
        const doc = view.state.doc
        const line = doc.lineAt(view.state.selection.main.head)

        if (line.number >= doc.lines) {
          return
        }

        const next = doc.line(line.number + 1)
        const lead = next.text.length - next.text.trimStart().length
        const insert = next.text.trim() ? ' ' : ''

        view.dispatch({ changes: { from: line.to, to: next.from + lead, insert }, selection: EditorSelection.cursor(line.to) })
        view.focus()
      }
    })

    def({
      name: 'comment',
      group: 'Edycja',
      params: '—',
      summary: 'Przełącza komentarz liniowy `//` na linii (lub liniach zaznaczenia).',
      run: () => {
        const view = this.view()
        const doc = view.state.doc
        const { first, last } = this.selectedLineRange(view)
        let allCommented = true

        for (let n = first; n <= last; n++) {
          const text = doc.line(n).text

          if (text.trim() && !text.trimStart().startsWith('//')) {
            allCommented = false
            break
          }
        }

        const changes: { from: number; to?: number; insert?: string }[] = []

        for (let n = first; n <= last; n++) {
          const line = doc.line(n)

          if (!line.text.trim()) {
            continue
          }

          if (allCommented) {
            const idx = line.text.indexOf('//')
            const rm = line.text[idx + 2] === ' ' ? 3 : 2
            changes.push({ from: line.from + idx, to: line.from + idx + rm })
          } else {
            const ws = line.text.length - line.text.trimStart().length
            changes.push({ from: line.from + ws, insert: '// ' })
          }
        }

        if (changes.length) {
          view.dispatch({ changes })
        }

        view.focus()
      }
    })

    def({
      name: 'indent',
      group: 'Edycja',
      params: '—',
      summary: 'Dodaje wcięcie (dwie spacje) na początku linii (lub linii zaznaczenia).',
      run: () => {
        const view = this.view()
        const doc = view.state.doc
        const { first, last } = this.selectedLineRange(view)
        const changes: { from: number; insert: string }[] = []

        for (let n = first; n <= last; n++) {
          changes.push({ from: doc.line(n).from, insert: '  ' })
        }

        view.dispatch({ changes })
        view.focus()
      }
    })

    def({
      name: 'outdent',
      group: 'Edycja',
      params: '—',
      summary: 'Usuwa wcięcie (do dwóch spacji / tab) z początku linii (lub linii zaznaczenia).',
      run: () => {
        const view = this.view()
        const doc = view.state.doc
        const { first, last } = this.selectedLineRange(view)
        const changes: { from: number; to: number }[] = []

        for (let n = first; n <= last; n++) {
          const line = doc.line(n)
          const m = /^(\t| {1,2})/.exec(line.text)

          if (m) {
            changes.push({ from: line.from, to: line.from + m[0].length })
          }
        }

        if (changes.length) {
          view.dispatch({ changes })
        }

        view.focus()
      }
    })

    def({
      name: 'upper',
      group: 'Edycja',
      params: '—',
      summary: 'Zamienia zaznaczenie (lub słowo pod kursorem) na WIELKIE litery.',
      run: () => this.transformCase(true)
    })

    def({
      name: 'lower',
      group: 'Edycja',
      params: '—',
      summary: 'Zamienia zaznaczenie (lub słowo pod kursorem) na małe litery.',
      run: () => this.transformCase(false)
    })

    def({
      name: 'trim',
      group: 'Edycja',
      params: '—',
      summary: 'Usuwa białe znaki z końca każdej linii w pliku.',
      run: () => {
        const view = this.view()
        const doc = view.state.doc
        const changes: { from: number; to: number }[] = []

        for (let n = 1; n <= doc.lines; n++) {
          const line = doc.line(n)
          const trimmed = line.text.replace(/\s+$/, '')

          if (trimmed.length !== line.text.length) {
            changes.push({ from: line.from + trimmed.length, to: line.to })
          }
        }

        if (changes.length) {
          view.dispatch({ changes })
        }

        view.focus()
      }
    })

    def({
      name: 'insertBelow',
      group: 'Edycja',
      params: 'text',
      summary: 'Wstawia nową linię z tekstem pod bieżącą linią.',
      run: (arg) => {
        const view = this.view()
        const line = view.state.doc.lineAt(view.state.selection.main.head)

        view.dispatch({ changes: { from: line.to, insert: '\n' + arg }, selection: EditorSelection.cursor(line.to + 1 + arg.length) })
        view.focus()
      }
    })

    def({
      name: 'insertAbove',
      group: 'Edycja',
      params: 'text',
      summary: 'Wstawia nową linię z tekstem nad bieżącą linią.',
      run: (arg) => {
        const view = this.view()
        const line = view.state.doc.lineAt(view.state.selection.main.head)

        view.dispatch({ changes: { from: line.from, insert: arg + '\n' }, selection: EditorSelection.cursor(line.from + arg.length) })
        view.focus()
      }
    })

    def({
      name: 'append',
      group: 'Edycja',
      params: 'text',
      summary: 'Dopisuje tekst na końcu bieżącej linii.',
      run: (arg) => {
        const view = this.view()
        const line = view.state.doc.lineAt(view.state.selection.main.head)

        view.dispatch({ changes: { from: line.to, insert: arg }, selection: EditorSelection.cursor(line.to + arg.length) })
        view.focus()
      }
    })

    def({
      name: 'prepend',
      group: 'Edycja',
      params: 'text',
      summary: 'Wstawia tekst na początku bieżącej linii.',
      run: (arg) => {
        const view = this.view()
        const line = view.state.doc.lineAt(view.state.selection.main.head)

        view.dispatch({ changes: { from: line.from, insert: arg } })
        view.focus()
      }
    })

    def({
      name: 'wrap',
      group: 'Edycja',
      params: 'before::after',
      summary: 'Otacza zaznaczenie tekstem (np. `wrap:(::)`). Bez `::` ten sam tekst z obu stron.',
      run: (arg) => {
        const view = this.view()
        const r = view.state.selection.main
        const sep = arg.indexOf('::')
        const before = sep === -1 ? arg : arg.slice(0, sep)
        const after = sep === -1 ? arg : arg.slice(sep + 2)
        const text = view.state.doc.sliceString(r.from, r.to)

        view.dispatch({
          changes: { from: r.from, to: r.to, insert: before + text + after },
          selection: EditorSelection.range(r.from + before.length, r.from + before.length + text.length)
        })
        view.focus()
      }
    })

    // ——————————————————————————— Clipboard ———————————————————————————

    def({
      name: 'copy',
      group: 'Schowek',
      params: '—',
      summary: 'Kopiuje zaznaczenie (lub bieżącą linię) do schowka.',
      run: async () => {
        const view = this.view()
        const r = view.state.selection.main
        const text = r.empty ? view.state.doc.lineAt(r.head).text : view.state.doc.sliceString(r.from, r.to)

        await navigator.clipboard.writeText(text)
      }
    })

    def({
      name: 'cut',
      group: 'Schowek',
      params: '—',
      summary: 'Wycina zaznaczenie (lub bieżącą linię) do schowka.',
      run: async () => {
        const view = this.view()
        const r = view.state.selection.main

        if (r.empty) {
          const line = view.state.doc.lineAt(r.head)

          await navigator.clipboard.writeText(line.text)
          view.dispatch({ changes: { from: line.from, to: Math.min(view.state.doc.length, line.to + 1) }, selection: EditorSelection.cursor(line.from) })
        } else {
          await navigator.clipboard.writeText(view.state.doc.sliceString(r.from, r.to))
          view.dispatch(view.state.replaceSelection(''))
        }

        view.focus()
      }
    })

    def({
      name: 'paste',
      group: 'Schowek',
      params: '—',
      summary: 'Wkleja zawartość schowka w miejscu kursora.',
      run: async () => {
        const view = this.view()
        const text = await navigator.clipboard.readText()

        if (text) {
          view.dispatch(view.state.replaceSelection(text))
        }

        view.focus()
      }
    })

    // ——————————————————————————— Cursor movement ———————————————————————————

    def({
      name: 'cursor',
      group: 'Kursor',
      params: 'up|down|left|right|wordLeft|wordRight|lineStart|lineEnd|docStart|docEnd',
      summary: 'Przesuwa kursor w podanym kierunku.',
      run: (arg) => {
        const view = this.view()

        this.setCursor(view, this.resolveMove(view, arg.trim()))
      }
    })

    def({
      name: 'extend',
      group: 'Kursor',
      params: 'up|down|left|right|wordLeft|wordRight|lineStart|lineEnd|docStart|docEnd',
      summary: 'Rozszerza zaznaczenie w podanym kierunku (kotwica zostaje).',
      run: (arg) => {
        const view = this.view()
        const r = view.state.selection.main
        const head = this.resolveMove(view, arg.trim())

        view.dispatch({ selection: EditorSelection.range(r.anchor, head), scrollIntoView: true })
        view.focus()
      }
    })

    def({
      name: 'page',
      group: 'Kursor',
      params: 'up|down',
      summary: 'Przesuwa kursor o stronę (wysokość widoku) w górę/dół.',
      run: (arg) => {
        const view = this.view()
        const dir = arg.trim()

        if (dir !== 'up' && dir !== 'down') {
          throw new Error('page: użyj up|down')
        }

        const rows = Math.max(1, Math.floor(view.dom.clientHeight / (view.defaultLineHeight || 18)) - 1)
        let r = view.state.selection.main

        for (let i = 0; i < rows; i++) {
          r = view.moveVertically(r, dir === 'down')
        }

        this.setCursor(view, r.head)
      }
    })

    def({
      name: 'scroll',
      group: 'Kursor',
      params: 'top|bottom|center',
      summary: 'Przewija widok do góry/dołu pliku lub centruje kursor (bez ruchu kursora).',
      run: (arg) => {
        const view = this.view()
        const where = arg.trim()
        const pos = where === 'top' ? 0 : where === 'bottom' ? view.state.doc.length : view.state.selection.main.head

        if (where !== 'top' && where !== 'bottom' && where !== 'center' && where !== 'cursor') {
          throw new Error('scroll: użyj top|bottom|center')
        }

        const y = where === 'top' ? 'start' : where === 'bottom' ? 'end' : 'center'

        view.dispatch({ effects: EditorView.scrollIntoView(pos, { y }) })
      }
    })

    def({
      name: 'goto',
      group: 'Kursor',
      params: 'line[:col]',
      summary: 'Ustawia kursor w danej linii (1-based), opcjonalnie kolumnie.',
      run: (arg) => {
        const view = this.view()
        const doc = view.state.doc
        const [lnStr, colStr] = arg.split(':')
        const ln = Math.max(1, Math.min(doc.lines, parseInt(lnStr, 10) || 1))
        const line = doc.line(ln)
        const col = colStr ? Math.max(0, Math.min(line.length, (parseInt(colStr, 10) || 1) - 1)) : 0

        this.setCursor(view, line.from + col)
      }
    })

    // ——————————————————————————— Selection ———————————————————————————

    def({
      name: 'select',
      group: 'Zaznaczenie',
      params: 'all|line|word|none',
      summary: 'Zaznacza całość / bieżącą linię / słowo pod kursorem, albo czyści zaznaczenie.',
      run: (arg) => {
        const view = this.view()
        const r = view.state.selection.main
        const doc = view.state.doc
        let range: { anchor: number; head: number }

        switch (arg.trim()) {
          case 'all':
            range = { anchor: 0, head: doc.length }
            break

          case 'line': {
            const line = doc.lineAt(r.head)
            range = { anchor: line.from, head: line.to }
            break
          }

          case 'word': {
            const w = view.state.wordAt(r.head)

            if (!w) {
              return
            }

            range = { anchor: w.from, head: w.to }
            break
          }

          case 'none':
            range = { anchor: r.head, head: r.head }
            break

          default:
            throw new Error(`select: nieznany tryb "${arg}"`)
        }

        view.dispatch({ selection: EditorSelection.range(range.anchor, range.head), scrollIntoView: true })
        view.focus()
      }
    })

    // ——————————————————————————— Search / navigation in file ———————————————————————————

    def({
      name: 'find',
      group: 'Nawigacja',
      params: 'text',
      summary: 'Otwiera wyszukiwarkę i przewija do pierwszego wystąpienia tekstu.',
      run: (arg) => this.editor().find(arg)
    })

    def({
      name: 'goto-fn',
      group: 'Nawigacja',
      params: 'name',
      summary: 'Przewija do deklaracji funkcji/metody o podanej nazwie.',
      run: (arg) => this.editor().gotoFn(arg.trim())
    })

    // ——————————————————————————— Editor windows ———————————————————————————

    def({
      name: 'open',
      group: 'Pliki',
      params: 'path[#fn]',
      summary: 'Otwiera plik w edytorze (ścieżka względna do projektu lub bezwzględna); `#fn` przewija do funkcji.',
      run: (arg) => {
        const [p, fn] = arg.split('#')
        const path = (this.host.resolvePath?.(p.trim()) ?? p.trim())

        if (!path) {
          throw new Error('open: brak ścieżki')
        }

        this.host.openFile?.(path, fn?.trim() || undefined)
      }
    })

    def({
      name: 'save',
      group: 'Pliki',
      params: '—',
      summary: 'Zapisuje aktywny edytor na dysk.',
      run: () => this.editor().save()
    })

    def({
      name: 'close',
      group: 'Pliki',
      params: '[path]',
      summary: 'Zamyka aktywny edytor (lub wskazany ścieżką).',
      run: (arg) => {
        const path = this.matchEditor(arg.trim()) || this.host.activePath?.() || this.active?.path

        if (path) {
          this.host.closeEditor?.(path)
        }
      }
    })

    def({
      name: 'focus',
      group: 'Pliki',
      params: 'path',
      summary: 'Uaktywnia (przełącza na) otwarty edytor pasujący do ścieżki.',
      run: (arg) => {
        const path = this.matchEditor(arg.trim())

        if (!path) {
          throw new Error(`focus: brak otwartego edytora dla "${arg}"`)
        }

        this.host.selectEditor?.(path)
      }
    })

    def({
      name: 'minimize',
      group: 'Pliki',
      params: '—',
      summary: 'Minimalizuje aktywny edytor.',
      run: () => {
        const path = this.host.activePath?.() || this.active?.path

        if (path) {
          this.host.minimizeEditor?.(path)
        }
      }
    })

    def({
      name: 'fullscreen',
      group: 'Pliki',
      params: 'on|off|toggle',
      summary: 'Przełącza tryb pełnoekranowy aktywnego edytora.',
      run: (arg) => {
        const mode = arg.trim()

        this.editor().setFullscreen(mode === 'on' ? true : mode === 'off' ? false : 'toggle')
      }
    })

    def({
      name: 'tabs',
      group: 'Pliki',
      params: 'next|prev',
      summary: 'Przełącza na następny / poprzedni otwarty edytor.',
      run: (arg) => {
        const dir = arg.trim()

        if (dir !== 'next' && dir !== 'prev') {
          throw new Error('tabs: użyj next|prev')
        }

        const editors = this.host.listEditors?.() ?? []

        if (!editors.length) {
          return
        }

        const cur = this.host.activePath?.() || ''
        const i = Math.max(0, editors.indexOf(cur))
        const next = dir === 'next' ? (i + 1) % editors.length : (i - 1 + editors.length) % editors.length

        this.host.selectEditor?.(editors[next])
      }
    })

    def({
      name: 'closeAll',
      group: 'Pliki',
      params: '—',
      summary: 'Zamyka wszystkie otwarte edytory.',
      run: () => {
        const editors = this.host.listEditors?.() ?? []

        for (const p of editors) {
          this.host.closeEditor?.(p)
        }
      }
    })

    // ——————————————————————————— AI ———————————————————————————

    def({
      name: 'ai',
      group: 'AI',
      params: 'prompt',
      summary: 'Uruchamia prompt AI w aktywnym edytorze (zmienia jego zawartość).',
      run: (arg) => this.editor().runPrompt(arg)
    })

    def({
      name: 'agent',
      group: 'AI',
      params: 'prompt',
      summary: 'Wysyła zapytanie do głównego agenta AI (operacje na plikach projektu).',
      run: (arg) => this.host.runAgent?.(arg)
    })

    // ——————————————————————————— Project ———————————————————————————

    def({
      name: 'pickProject',
      group: 'Projekt',
      params: '—',
      summary: 'Otwiera okno wyboru folderu projektu i skanuje go.',
      run: () => this.host.pickProject?.()
    })

    def({
      name: 'refresh',
      group: 'Projekt',
      params: '—',
      summary: 'Ponownie skanuje bieżący projekt i odświeża graf oraz drzewo plików.',
      run: () => this.host.refresh?.()
    })

    // ——————————————————————————— Backend (gateway → serwisy) ———————————————————————————
    // Fire-and-forget commands that call window.api (the gateway surface). For calls that
    // return data, scripts should use the Lua `api` table instead (see SCRIPTING.md).

    def({
      name: 'scan',
      group: 'Backend',
      params: 'path',
      summary: 'Uruchamia skan projektu pod podaną ścieżką (gateway → scanner).',
      run: (arg) => {
        const path = this.host.resolvePath?.(arg.trim()) ?? arg.trim()

        if (!path) {
          throw new Error('scan: brak ścieżki')
        }

        window.api.startScan(path)
      }
    })

    def({
      name: 'scan-app',
      group: 'Backend',
      params: 'appId',
      summary: 'Głęboki skan jednej aplikacji po jej app_id.',
      run: (arg) => {
        const id = parseInt(arg.trim(), 10)

        if (!Number.isFinite(id)) {
          throw new Error('scan-app: zły appId')
        }

        window.api.startScanApp(id)
      }
    })

    def({
      name: 'new-file',
      group: 'Backend',
      params: 'dir::file::name',
      summary: 'Tworzy plik (filer): `new-file:<katalog>::<plik>::<nazwa>`.',
      run: async (arg) => {
        const [dir, file, name] = arg.split('::')

        if (!dir || !file) {
          throw new Error('new-file: użyj dir::file::name')
        }

        const path = await window.api.createFile(this.host.resolvePath?.(dir.trim()) ?? dir.trim(), file.trim(), (name ?? '').trim())

        this.host.openFile?.(path)
      }
    })

    def({
      name: 'new-folder',
      group: 'Backend',
      params: 'dir::name',
      summary: 'Tworzy katalog (filer): `new-folder:<katalog>::<nazwa>`.',
      run: async (arg) => {
        const [dir, name] = arg.split('::')

        if (!dir || !name) {
          throw new Error('new-folder: użyj dir::name')
        }

        await window.api.createFolder(this.host.resolvePath?.(dir.trim()) ?? dir.trim(), name.trim())
      }
    })

    def({
      name: 'delete-file',
      group: 'Backend',
      params: 'path',
      summary: 'Usuwa plik/katalog na dysku (filer).',
      run: async (arg) => {
        const path = this.host.resolvePath?.(arg.trim()) ?? arg.trim()

        if (!path) {
          throw new Error('delete-file: brak ścieżki')
        }

        await window.api.deleteFile(path)
      }
    })

    def({
      name: 'move-file',
      group: 'Backend',
      params: 'path::targetDir',
      summary: 'Przenosi plik do innego katalogu (filer): `move-file:<plik>::<katalog>`.',
      run: async (arg) => {
        const [path, target] = arg.split('::')

        if (!path || !target) {
          throw new Error('move-file: użyj path::targetDir')
        }

        await window.api.moveFile(this.host.resolvePath?.(path.trim()) ?? path.trim(), this.host.resolvePath?.(target.trim()) ?? target.trim())
      }
    })

    def({
      name: 'ai-provider',
      group: 'Backend',
      params: 'name',
      summary: 'Przełącza dostawcę LLM w serwisie ai (np. ollama|openai).',
      run: (arg) => {
        window.api.aiSetProvider(arg.trim())
      }
    })

    def({
      name: 'publish-event',
      group: 'Backend',
      params: 'type::title',
      summary: 'Publikuje zdarzenie w serwisie events (Redis): `publish-event:<typ>::<tytuł>`.',
      run: (arg) => {
        const [type, title] = arg.split('::')

        if (!type) {
          throw new Error('publish-event: brak typu')
        }

        window.api.publishEvent({ type: type.trim(), title: (title ?? '').trim() })
      }
    })

    def({
      name: 'script',
      group: 'Backend',
      params: 'id',
      summary: 'Wczytuje skrypt z bazy (serwis scripting) po id i uruchamia jego treść jako Lua.',
      run: async (arg) => {
        const id = parseInt(arg.trim(), 10)

        if (!Number.isFinite(id)) {
          throw new Error('script: złe id')
        }

        const sc = await window.api.getScript(id)
        const { runLuaSource } = await import('../lua/runtime')

        await runLuaSource(sc.content)
      }
    })

    // ——————————————————————————— Lua (see SCRIPTING.md) ———————————————————————————
    // Lazy import keeps the Lua/WASM runtime out of the bundle until a script is run.

    def({
      name: 'lua',
      group: 'Lua',
      params: 'path',
      summary: 'Wczytuje i uruchamia skrypt .lua (ścieżka względna do projektu lub bezwzględna).',
      run: async (arg) => {
        const path = this.host.resolvePath?.(arg.trim()) ?? arg.trim()

        if (!path) {
          throw new Error('lua: brak ścieżki')
        }

        const { runLuaFile } = await import('../lua/runtime')

        await runLuaFile(path)
      }
    })

    def({
      name: 'lua-eval',
      group: 'Lua',
      params: 'code',
      summary: 'Uruchamia podany kod Lua w miejscu (np. `lua-eval:cmd("write","hi")`).',
      run: async (arg) => {
        const { runLuaSource } = await import('../lua/runtime')

        await runLuaSource(arg)
      }
    })

    def({
      name: 'lua-reset',
      group: 'Lua',
      params: '—',
      summary: 'Resetuje runtime Lua: odpina wszystkie nasłuchy skryptów i czyści stan.',
      run: async () => {
        const { disposeLua } = await import('../lua/runtime')

        await disposeLua()
      }
    })

    // ——————————————————————————— Utilities ———————————————————————————

    def({
      name: 'log',
      group: 'Narzędzia',
      params: 'message',
      summary: 'Wypisuje wiadomość w konsoli (pomocne w skryptach).',
      run: (arg) => console.info('[commander]', arg)
    })

    def({
      name: 'wait',
      group: 'Narzędzia',
      params: 'ms',
      summary: 'Czeka podaną liczbę milisekund (do skryptów/animacji).',
      run: (arg) => {
        const ms = Math.max(0, parseInt(arg.trim(), 10) || 0)

        return new Promise((resolve) => setTimeout(resolve, ms))
      }
    })

    def({
      name: 'repeat',
      group: 'Narzędzia',
      params: 'n:command',
      summary: 'Uruchamia komendę n razy, np. `repeat:5:cursor:down`.',
      run: async (arg) => {
        const c = arg.indexOf(':')

        if (c === -1) {
          throw new Error('repeat: użyj n:komenda')
        }

        const n = parseInt(arg.slice(0, c), 10)
        const cmd = arg.slice(c + 1)

        if (!Number.isFinite(n) || n < 1) {
          throw new Error('repeat: zła liczba powtórzeń')
        }

        for (let i = 0; i < n; i++) {
          const res = await this.run(cmd)

          if (!res.ok) {
            throw new Error(res.error)
          }
        }
      }
    })

    def({
      name: 'emit',
      group: 'Narzędzia',
      params: 'event[::json]',
      summary: 'Wysyła zdarzenie na appBus, np. `emit:my:event::{"x":1}` (most do EVENTS.md).',
      run: (arg) => {
        const sep = arg.indexOf('::')
        const name = (sep === -1 ? arg : arg.slice(0, sep)).trim()
        const json = sep === -1 ? '' : arg.slice(sep + 2)
        let payload: unknown = {}

        if (json.trim()) {
          try {
            payload = JSON.parse(json)
          } catch {
            throw new Error('emit: nieprawidłowy JSON')
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        appBus.emit(name as any, payload as any)
      }
    })

    def({
      name: 'help',
      group: 'Narzędzia',
      params: '—',
      summary: 'Wypisuje listę wszystkich komend w konsoli.',
      run: () => console.table(this.list().map((c) => ({ command: c.name, params: c.params, summary: c.summary })))
    })

    def({
      name: 'noop',
      group: 'Narzędzia',
      params: '—',
      summary: 'Nic nie robi (placeholder w skryptach).',
      run: () => undefined
    })
  }

  // matchEditor finds an open editor whose path equals or ends with the given fragment
  // (so scripts can use a relative path or just a filename).
  private matchEditor(fragment: string): string | undefined {
    if (!fragment) {
      return undefined
    }

    const editors = this.host.listEditors?.() ?? []
    const resolved = this.host.resolvePath?.(fragment) ?? fragment

    return editors.find((p) => p === resolved || p === fragment || p.endsWith(fragment))
  }
}

export const commander = new Commander()

// Global access — the hook point for user scripts, alongside window.appBus.
declare global {
  interface Window {
    commander: Commander
  }
}

if (typeof window !== 'undefined') {
  window.commander = commander
}
