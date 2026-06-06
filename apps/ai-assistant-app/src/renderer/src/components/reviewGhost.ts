import { StateField, StateEffect } from '@codemirror/state'
import { Decoration, type DecorationSet, WidgetType, EditorView } from '@codemirror/view'

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
    readonly onDismiss: Dismiss
  ) {
    super()
  }

  eq(other: GhostWidget): boolean {
    return other.r.line === this.r.line && other.r.text === this.r.text && other.r.color === this.r.color
  }

  toDOM(): HTMLElement {
    const color = this.r.color ?? '#6e7681'
    const wrap = document.createElement('span')
    wrap.className = 'cm-ghost-bubble'
    wrap.style.color = color // border + ogonek = kolor wg ważności
    wrap.title = 'Kliknij, aby zamknąć'

    const pre = document.createElement('span')
    pre.textContent = (this.r.prefix ?? '‹') + ' '

    const txt = document.createElement('span')
    txt.textContent = this.r.text
    txt.style.color = '#fff' // tekst biały

    const x = document.createElement('span')
    x.className = 'cm-ghost-x'
    x.textContent = '  ✕'

    wrap.append(pre, txt, x)

    // Cały dymek jest klikalny — klik gdziekolwiek zamyka uwagę.
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

function build(remarks: Remark[], onDismiss: Dismiss, doc: { lines: number; line: (n: number) => { to: number } }) {
  const ranges = []

  for (const r of remarks) {
    if (r.line >= 1 && r.line <= doc.lines) {
      const widget = new GhostWidget(r, onDismiss)
      ranges.push(Decoration.widget({ widget, side: 1 }).range(doc.line(r.line).to))
    }
  }

  return Decoration.set(ranges, true)
}

// ghostField — pojedyncze, stabilne pole. Stan uwag aktualizuje setGhostRemarks.
export const ghostField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)

    for (const e of tr.effects) {
      if (e.is(setGhostRemarks)) {
        deco = build(e.value.remarks, e.value.onDismiss, tr.state.doc)
      }
    }

    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})
