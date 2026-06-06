import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
// @ts-ignore — @codemirror/language is declared in package.json but not yet installed in this
// tree (pending `pnpm install`); ignore so the rest of the app still type-checks. It resolves
// at build time once installed, and is already a transitive dep of @codemirror/lang-javascript.
import { syntaxTree } from '@codemirror/language'

// perSymbolColor — gives every function / class / method its OWN stable color. The color is
// derived by hashing the identifier text to a hue, so the same name always paints the same
// color across files and across edits (no random flicker). Toggleable: the host only adds the
// extension when the "each function/class a color" option is enabled — see perSymbolColor().
//
// Implementation: we walk the JS/TS syntax tree (already parsed by @codemirror/lang-javascript)
// inside the visible ranges and decorate the *name* identifier of:
//   - function declarations / function expressions
//   - class declarations / class expressions
//   - object methods and class methods (MethodDeclaration)
//   - const/let/var bound to an arrow function or a function expression (treated like a fn name)
// We only touch the name token, not the body, so it composes with syntax highlighting themes.

// Syntax-tree node names (from @lezer/javascript) whose `VariableDefinition` / `PropertyDefinition`
// child is the symbol name we want to colorize.
const FUNCTION_LIKE = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
  'MethodDeclaration'
])

// hueFor hashes a name to a stable hue in [0,360). djb2 keeps it cheap and well-spread.
function hueFor(name: string): number {
  let h = 5381

  for (let i = 0; i < name.length; i++) {
    h = (h * 33) ^ name.charCodeAt(i)
  }

  return Math.abs(h) % 360
}

// Decoration cache keyed by hue so we don't allocate a new mark per occurrence.
const markCache = new Map<number, Decoration>()

function markFor(name: string): Decoration {
  const hue = hueFor(name)
  let mark = markCache.get(hue)

  if (!mark) {
    // High saturation + lightness so the color reads on dark AND light themes.
    mark = Decoration.mark({ attributes: { style: `color:hsl(${hue},70%,65%)` } })
    markCache.set(hue, mark)
  }

  return mark
}

// nameRangeOf returns the [from,to) of the identifier that names a function/class-like node, or
// null if the node is anonymous. The name is the first VariableDefinition / PropertyDefinition /
// PropertyName child of the declaration node.
function nameRangeOf(view: EditorView, nodeFrom: number, nodeTo: number): { from: number; to: number } | null {
  const tree = syntaxTree(view.state)
  const cur = tree.cursorAt(nodeFrom, 1)

  // Descend into the declaration's children looking for the name token.
  if (!cur.firstChild()) {
    return null
  }

  do {
    if (cur.from < nodeFrom || cur.to > nodeTo) {
      continue
    }

    if (cur.name === 'VariableDefinition' || cur.name === 'PropertyDefinition' || cur.name === 'PropertyName') {
      return { from: cur.from, to: cur.to }
    }
  } while (cur.nextSibling())

  return null
}

// isFunctionInitializer reports whether a value node is a function/arrow expression, so that a
// `const foo = () => {}` gets its name colored like a real function definition.
function isFunctionInitializer(name: string): boolean {
  return name === 'ArrowFunction' || name === 'FunctionExpression' || name === 'ClassExpression'
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)

  // Collect ranges first so we can sort before feeding RangeSetBuilder (it requires order).
  const hits: { from: number; to: number; name: string }[] = []

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (FUNCTION_LIKE.has(node.name)) {
          const range = nameRangeOf(view, node.from, node.to)

          if (range) {
            hits.push({ ...range, name: view.state.sliceDoc(range.from, range.to) })
          }

          return
        }

        // const/let/var name = <arrow|function|class expression> — color the variable name too.
        if (node.name === 'VariableDeclaration') {
          const cur = node.node.cursor()

          if (!cur.firstChild()) {
            return
          }

          let defFrom = -1
          let defTo = -1

          do {
            if (cur.name === 'VariableDefinition') {
              defFrom = cur.from
              defTo = cur.to
            } else if (defFrom >= 0 && isFunctionInitializer(cur.name)) {
              hits.push({ from: defFrom, to: defTo, name: view.state.sliceDoc(defFrom, defTo) })
              defFrom = -1
            }
          } while (cur.nextSibling())
        }
      }
    })
  }

  hits.sort((a, b) => a.from - b.from || a.to - b.to)

  let last = -1

  for (const h of hits) {
    // Guard against overlaps/duplicates (RangeSetBuilder demands strictly increasing starts).
    if (h.from < last || h.from >= h.to) {
      continue
    }

    builder.add(h.from, h.to, markFor(h.name))
    last = h.from
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

// perSymbolColor returns the CodeMirror extension that colors each function/class/method name by
// a stable hash of its identifier. Add it to the extensions array only when the option is on.
export function perSymbolColor(): Extension {
  return plugin
}
