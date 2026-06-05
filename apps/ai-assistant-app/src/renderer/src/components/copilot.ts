import { StateField, StateEffect, Prec } from '@codemirror/state'
import { Decoration, type DecorationSet, WidgetType, EditorView, keymap } from '@codemirror/view'

// Copilot: podpowiedź AI jako szary ghost text po kursorze; Tab ją wstawia.
export const setCopilot = StateEffect.define<{ from: number; text: string } | null>()

class GhostInline extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(o: GhostInline): boolean {
    return o.text === this.text
  }

  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.textContent = this.text
    s.style.color = '#6e7681'
    s.style.opacity = '0.8'
    s.style.whiteSpace = 'pre-wrap'

    return s
  }
}

export const copilotField = StateField.define<{ from: number; text: string } | null>({
  create() {
    return null
  },
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setCopilot)) {
        return e.value
      }
    }

    if (tr.docChanged) {
      return null // każda edycja czyści podpowiedź (chyba że to akceptacja z efektem)
    }

    if (val && tr.selection && tr.state.selection.main.head !== val.from) {
      return null // kursor się przesunął
    }

    return val
  },
  provide: (f) =>
    EditorView.decorations.compute([f], (state) => {
      const v = state.field(f)

      if (!v || !v.text) {
        return Decoration.none as DecorationSet
      }

      return Decoration.set([Decoration.widget({ widget: new GhostInline(v.text), side: 1 }).range(v.from)])
    })
})

export function acceptCopilot(view: EditorView): boolean {
  const v = view.state.field(copilotField, false)

  if (!v || !v.text) {
    return false
  }

  view.dispatch({
    changes: { from: v.from, insert: v.text },
    selection: { anchor: v.from + v.text.length },
    effects: setCopilot.of(null)
  })

  return true
}

export const copilotKeymap = Prec.highest(
  keymap.of([
    { key: 'Tab', run: acceptCopilot },
    {
      key: 'Escape',
      run: (view) => {
        if (view.state.field(copilotField, false)) {
          view.dispatch({ effects: setCopilot.of(null) })

          return true
        }

        return false
      }
    }
  ])
)
