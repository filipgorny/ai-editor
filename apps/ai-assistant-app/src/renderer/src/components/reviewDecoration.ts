// Rozszerzenie CodeMirror malujące tło linii w trybie review: linie dodane na
// zielonkawo, zmienione na żółtawo. Zestaw linii ustawiamy efektem setReviewLines.
import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

export const setReviewLines = StateEffect.define<{ added: number[]; modified: number[] }>()

const addedLine = Decoration.line({ class: 'cm-review-added' })
const modifiedLine = Decoration.line({ class: 'cm-review-modified' })

export const reviewField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)

    for (const e of tr.effects) {
      if (!e.is(setReviewLines)) {
        continue
      }

      const added = new Set(e.value.added)
      const modified = new Set(e.value.modified)
      const total = tr.state.doc.lines
      const builder = new RangeSetBuilder<Decoration>()

      // RangeSetBuilder wymaga rosnących pozycji — łączymy i sortujemy numery linii.
      const lines = [...new Set([...e.value.added, ...e.value.modified])]
        .filter((n) => n >= 1 && n <= total)
        .sort((a, b) => a - b)

      for (const ln of lines) {
        const line = tr.state.doc.line(ln)
        builder.add(line.from, line.from, added.has(ln) ? addedLine : modified.has(ln) ? modifiedLine : addedLine)
      }

      deco = builder.finish()
    }

    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

export const reviewTheme = EditorView.baseTheme({
  '.cm-review-added': { backgroundColor: 'rgba(63, 185, 80, 0.18)' },
  '.cm-review-modified': { backgroundColor: 'rgba(210, 153, 34, 0.18)' }
})
