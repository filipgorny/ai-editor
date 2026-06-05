import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

// Rainbow brackets — koloruje ( ) [ ] { } wg głębokości zagnieżdżenia. Otwierający i jego
// zamykający dzielą kolor (ta sama głębokość), więc łatwiej dopasować parę wzrokiem.
// Kolory są jasne (czytelne na ciemnym tle). Pure-scan (bez syntaxTree) z lekkim
// pomijaniem stringów i komentarzy — wystarczające dla JS/TS.

const COLORS = [
  '#9cdcfe', // jasnoniebieski
  '#c792ea', // jasnofiolet
  '#7ee787', // jasnozielony
  '#ffd580', // bursztyn
  '#f48fb1', // róż
  '#80deea', // cyjan
  '#ffab70', // pomarańcz
  '#b388ff', // lawenda
  '#a5d6a7', // mięta
  '#ff8a80', // łosoś
  '#ffe082', // żółty
  '#80cbc4' // morski
]

const marks = COLORS.map((c) => Decoration.mark({ attributes: { style: `color:${c}` } }))

const OPEN = '([{'
const CLOSE = ')]}'

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const ranges = view.visibleRanges

  if (!ranges.length) {
    return builder.finish()
  }

  // Skanujemy od początku dokumentu (poprawna głębokość w viewportcie), ale dekoracje
  // dodajemy tylko dla pozycji widocznych — koszt ograniczony do końca ostatniego zakresu.
  const scanEnd = ranges[ranges.length - 1].to
  const text = view.state.sliceDoc(0, scanEnd)

  let depth = 0
  let str: string | null = null // aktywny ogranicznik stringa (' " `)
  let inLine = false
  let inBlock = false
  let rIdx = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : ''

    if (inLine) {
      if (ch === '\n') {
        inLine = false
      }

      continue
    }

    if (inBlock) {
      if (prev === '*' && ch === '/') {
        inBlock = false
      }

      continue
    }

    if (str) {
      if (ch === str && prev !== '\\') {
        str = null
      }

      continue
    }

    if (ch === '/' && text[i + 1] === '/') {
      inLine = true

      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      inBlock = true

      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      str = ch

      continue
    }

    const isOpen = OPEN.includes(ch)
    const isClose = !isOpen && CLOSE.includes(ch)

    if (!isOpen && !isClose) {
      continue
    }

    // Otwierający koloruje na bieżącej głębokości i ją zwiększa; zamykający najpierw
    // zmniejsza, więc trafia w ten sam kolor co jego para.
    const colorDepth = isOpen ? depth : Math.max(0, depth - 1)

    // czy ta pozycja jest w widocznym zakresie (pozycje rosną → rIdx tylko do przodu)
    while (rIdx < ranges.length && i >= ranges[rIdx].to) {
      rIdx++
    }

    if (rIdx < ranges.length && i >= ranges[rIdx].from) {
      builder.add(i, i + 1, marks[colorDepth % marks.length])
    }

    depth = isOpen ? depth + 1 : Math.max(0, depth - 1)
  }

  return builder.finish()
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

// rainbowBrackets zwraca rozszerzenie CodeMirror do dodania w tablicy extensions.
export function rainbowBrackets(): Extension {
  return plugin
}
