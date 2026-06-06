// Ambient JSX typing for Electron's <webview> tag.
//
// Electron exposes a <webview> custom element (enabled via webviewTag:true in the main
// process), but React's JSX has no built-in element for it. This augmentation lets the
// browser view render <webview ...> with the attributes we use without `any` casts. The
// element instance is typed loosely (Electron's WebviewTag) where we hold a ref.

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<WebviewAttributes, HTMLElement>
    }
  }

  // The subset of Electron WebviewTag methods/events the view relies on.
  interface ElectronWebviewTag extends HTMLElement {
    src: string
    getURL(): string
    getTitle(): string
    loadURL(url: string): Promise<void>
    reload(): void
    stop(): void
    goBack(): void
    goForward(): void
    canGoBack(): boolean
    canGoForward(): boolean
    executeJavaScript(code: string): Promise<unknown>
  }
}

// Attributes accepted on the <webview> element. `partition` isolates storage per browser
// session; `allowpopups` lets target=_blank work; `useragent` is occasionally needed.
interface WebviewAttributes extends HTMLAttributes<HTMLElement> {
  src?: string
  partition?: string
  allowpopups?: boolean
  useragent?: string
  preload?: string
  nodeintegration?: boolean
}
