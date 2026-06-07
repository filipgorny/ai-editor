import { ViewPlugin, EditorView, type ViewUpdate } from '@codemirror/view'

// columnRuler draws a vertical guide at a given column (e.g. 80) that always spans
// the full visible editor area — down to the very bottom of the window — even for
// short files. It's an absolutely positioned line inside the scroller; on scroll it
// re-anchors to the viewport so it never ends with the code.
export function columnRuler(col: number) {
  return ViewPlugin.fromClass(
    class {
      view: EditorView
      line: HTMLDivElement
      onScroll: () => void

      constructor(view: EditorView) {
        this.view = view
        this.line = document.createElement('div')
        this.line.style.cssText =
          'position:absolute;left:0;top:0;width:1px;background:rgba(128,128,128,0.35);pointer-events:none;z-index:0;'
        view.scrollDOM.style.position = 'relative'
        // insert behind the content so text and ghost bubbles render on top of the line
        view.scrollDOM.insertBefore(this.line, view.scrollDOM.firstChild)
        this.onScroll = () => this.position()
        view.scrollDOM.addEventListener('scroll', this.onScroll)
        this.position()
      }

      update(_u: ViewUpdate): void {
        this.position()
      }

      position(): void {
        const view = this.view
        const charW = view.defaultCharacterWidth
        const gutter = (view.scrollDOM.querySelector('.cm-gutters') as HTMLElement | null)?.offsetWidth ?? 0

        // left in content coords (scrolls horizontally with the text)
        this.line.style.left = `${gutter + 4 + col * charW}px`
        // re-anchor vertically to the viewport so it always reaches the bottom
        this.line.style.top = `${view.scrollDOM.scrollTop}px`
        this.line.style.height = `${view.scrollDOM.clientHeight}px`
      }

      destroy(): void {
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
        this.line.remove()
      }
    }
  )
}
