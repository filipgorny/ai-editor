import { StateField, StateEffect, type EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, WidgetType, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

export type Remark = { line: number; text: string; color?: string; prefix?: string }
export type Dismiss = (key: string) => void

// Border/tail color for AI review comment bubbles (a calm blue, distinct from the yellow/
// red lint bubbles) and the speech-bubble prefix glyph used to mark them.
export const reviewBubbleColor = '#58a6ff'
export const reviewBubblePrefix = '\u{1F4AC}' // 💬

export const remarkKey = (r: Remark): string => r.line + ':' + r.text

// filterToChangedLines — keep only the remarks whose line is in the changed-line set
// (added ∪ modified). Review mode shows AI comment bubbles ONLY next to changed code, so
// the AI-review remarks are run through this before being handed to the editor. A line is
// considered "near" a change if it is within `slop` lines of a changed one — the LLM often
// anchors a comment one line off from the exact diff hunk.
export function filterToChangedLines(
  remarks: Remark[],
  changed: { added: number[]; modified: number[] },
  slop = 1
): Remark[] {
  const lines = new Set<number>([...changed.added, ...changed.modified])

  if (lines.size === 0) {
    return []
  }

  return remarks.filter((r) => {
    for (let d = -slop; d <= slop; d++) {
      if (lines.has(r.line + d)) {
        return true
      }
    }

    return false
  })
}

// Uwagi wstrzykujemy efektem (nie przez rekonfigurację rozszerzeń) — dzięki temu
// edytor się nie przebudowuje i dymki nie znikają same.
export const setGhostRemarks = StateEffect.define<{ remarks: Remark[]; onDismiss: Dismiss }>()

class GhostWidget extends WidgetType {
  constructor(
    readonly r: Remark,
    readonly onDismiss: Dismiss,
    // wcięcie (w kolumnach) linii, do której uwaga jest doczepiona — blok zaczyna się
    // pod początkiem KODU, nie pod marginesem.
    readonly indent: number
  ) {
    super()
  }

  eq(other: GhostWidget): boolean {
    return (
      other.r.line === this.r.line &&
      other.r.text === this.r.text &&
      other.r.prefix === this.r.prefix &&
      other.indent === this.indent
    )
  }

  toDOM(): HTMLElement {
    // Blok POD linią kodu (nie inline obok niej): bez ramki, tło lekko przyciemnione,
    // tekst dziedziczy kolor edytora (jasny na ciemnych motywach, ciemny na jasnych),
    // szerokość ograniczona do widocznej części edytora → tekst ZAWIJA się, bez scrolla.
    const wrap = document.createElement('div')
    wrap.className = 'cm-ghost-bubble'
    wrap.title = 'Kliknij, aby zamknąć'
    // Wcięcie i limit szerokości liczone w PRAWDZIWEJ szerokości znaku edytora (--cm-ghost-ch),
    // żeby blok zaczynał się dokładnie pod kolumną kodu niezależnie od fontu uwagi.
    wrap.style.marginLeft = `calc(var(--cm-ghost-ch, 1ch) * ${this.indent})`
    wrap.style.maxWidth = `calc(var(--cm-ghost-width, 100%) - var(--cm-ghost-ch, 1ch) * ${this.indent} - 14px)`

    const icon = document.createElement('span')
    icon.className = 'cm-ghost-icon'
    icon.textContent = this.r.prefix ?? '💬'

    const txt = document.createElement('span')
    txt.className = 'cm-ghost-text'
    txt.textContent = this.r.text

    const x = document.createElement('span')
    x.className = 'cm-ghost-x'
    x.textContent = '✕'

    wrap.append(x, icon, txt)

    // Cały blok jest klikalny — klik gdziekolwiek zamyka uwagę.
    wrap.onmousedown = (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.onDismiss(remarkKey(this.r))
    }

    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

// indentCols liczy wcięcie linii w kolumnach (spacje = 1, tab rozwijany wg tabSize).
function indentCols(text: string, tabSize: number): number {
  let cols = 0

  for (const ch of text) {
    if (ch === ' ') {
      cols += 1
    } else if (ch === '\t') {
      cols += tabSize - (cols % tabSize)
    } else {
      break
    }
  }

  return cols
}

function build(remarks: Remark[], onDismiss: Dismiss, state: EditorState) {
  const doc = state.doc
  const ranges = []

  for (const r of remarks) {
    if (r.line >= 1 && r.line <= doc.lines) {
      const line = doc.line(r.line)
      const widget = new GhostWidget(r, onDismiss, indentCols(line.text, state.tabSize))
      // block widget → renderuje się jako osobny wiersz POD linią kodu (side: 1).
      ranges.push(Decoration.widget({ widget, side: 1, block: true }).range(line.to))
    }
  }

  return Decoration.set(ranges, true)
}

// ghostWidthPlugin trzyma w zmiennej CSS `--cm-ghost-width` szerokość WIDOCZNEJ części kodu
// (scroller minus gutter), żeby bloki uwag zawijały się w obrębie okna — bez poziomego
// scrolla. Aktualizuje się przy każdej zmianie geometrii (resize, zwijanie paneli itp.).
export const ghostWidthPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.measure(view)
    }

    update(u: ViewUpdate): void {
      if (u.geometryChanged) {
        this.measure(u.view)
      }
    }

    measure(view: EditorView): void {
      const gutters = view.dom.querySelector('.cm-gutters') as HTMLElement | null
      const w = view.scrollDOM.clientWidth - (gutters?.offsetWidth ?? 0)

      view.dom.style.setProperty('--cm-ghost-width', Math.max(0, w) + 'px')
      view.dom.style.setProperty('--cm-ghost-ch', view.defaultCharacterWidth + 'px')
    }
  }
)

// ghostField — pojedyncze, stabilne pole. Stan uwag aktualizuje setGhostRemarks.
export const ghostField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)

    for (const e of tr.effects) {
      if (e.is(setGhostRemarks)) {
        deco = build(e.value.remarks, e.value.onDismiss, tr.state)
      }
    }

    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})
