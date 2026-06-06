// CodeMirror review-mode extensions: paints the BACKGROUND of changed lines (added
// greenish, modified yellowish) AND colors the LINE NUMBER in the gutter to match —
// added lines get a green number, modified lines a yellow number. The set of lines is
// pushed in with the `setReviewLines` effect (one effect drives both the line backgrounds
// and the gutter markers, so they never drift apart).
import { StateEffect, StateField, RangeSetBuilder, RangeSet } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, GutterMarker, lineNumberMarkers } from '@codemirror/view'

// Colors shared by background tint and gutter number, exported so a view can reuse them
// (e.g. a legend "green = added / yellow = modified").
export const reviewAddedColor = '#3fb950'
export const reviewModifiedColor = '#d29922'

export const setReviewLines = StateEffect.define<{ added: number[]; modified: number[] }>()

const addedLine = Decoration.line({ class: 'cm-review-added' })
const modifiedLine = Decoration.line({ class: 'cm-review-modified' })

// reviewLineField — line-background decorations for added/modified lines.
const reviewLineField = StateField.define<DecorationSet>({
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

      // RangeSetBuilder wants ascending positions — merge + sort the line numbers.
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

// A gutter marker that contributes ONLY a CSS class (no DOM) so the existing line-number
// element keeps rendering — the class just recolors that number.
class ReviewNumberMarker extends GutterMarker {
  // elementClass is the public hook the lineNumberMarkers facet reads to add the class to
  // the line-number element. GutterMarker already declares it, so we just assign in the ctor.
  constructor(cls: string) {
    super()
    this.elementClass = cls
  }

  eq(other: ReviewNumberMarker): boolean {
    return other.elementClass === this.elementClass
  }
}

const addedMarker = new ReviewNumberMarker('cm-review-num-added')
const modifiedMarker = new ReviewNumberMarker('cm-review-num-modified')

// reviewGutterField — a RangeSet of line-number markers, fed by the SAME setReviewLines
// effect, surfaced to CodeMirror through the lineNumberMarkers facet so only the line
// number is recolored (not other gutters).
const reviewGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes)

    for (const e of tr.effects) {
      if (!e.is(setReviewLines)) {
        continue
      }

      const added = new Set(e.value.added)
      const modified = new Set(e.value.modified)
      const total = tr.state.doc.lines
      const builder = new RangeSetBuilder<GutterMarker>()

      const lines = [...new Set([...e.value.added, ...e.value.modified])]
        .filter((n) => n >= 1 && n <= total)
        .sort((a, b) => a - b)

      for (const ln of lines) {
        const line = tr.state.doc.line(ln)
        builder.add(line.from, line.from, added.has(ln) ? addedMarker : modified.has(ln) ? modifiedMarker : addedMarker)
      }

      set = builder.finish()
    }

    return set
  },
  provide: (f) => lineNumberMarkers.from(f)
})

export const reviewTheme = EditorView.baseTheme({
  '.cm-review-added': { backgroundColor: 'rgba(63, 185, 80, 0.18)' },
  '.cm-review-modified': { backgroundColor: 'rgba(210, 153, 34, 0.18)' },
  // Line-number gutter recolor: added green, modified yellow (bold so it reads at a glance).
  '.cm-lineNumbers .cm-review-num-added': { color: reviewAddedColor, fontWeight: 700 },
  '.cm-lineNumbers .cm-review-num-modified': { color: reviewModifiedColor, fontWeight: 700 }
})

// reviewField — the review BODY extension (a bundle, not a single StateField): line
// backgrounds + colored line numbers. Exported under the same name CodeEditor already
// imports/lists in its extensions array, so colored gutter numbers light up with NO change
// to CodeEditor (CodeMirror flattens nested-array extensions). `setReviewLines` drives both.
export const reviewField = [reviewLineField, reviewGutterField]

// reviewExtensions — full drop-in bundle including the theme, for any host that wires
// review decorations from scratch.
export const reviewExtensions = [reviewField, reviewTheme]
