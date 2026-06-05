import { StateField, StateEffect } from '@codemirror/state'
import { Decoration, type DecorationSet, WidgetType, EditorView } from '@codemirror/view'

export type Remark = { line: number; text: string; color?: string; prefix?: string }
export type Dismiss = (key: string) => void

export const remarkKey = (r: Remark): string => r.line + ':' + r.text

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
