// Shared view contract. A new view is a SINGLE self-contained component file that
// imports ONLY: this contract, window.api (global), and appBus (../events/bus).
// View components must NOT import App.tsx, the registry, or sibling views.

import type { ComponentType } from 'react'
import type { Graph, Node } from '../model'
import type { EditorTarget } from '../components/CodeEditor'
import type { appBus } from '../events/bus'

// ViewKey — stable identity of a view; also the ALT+<n> ordinal and the bus payload value.
// Order is load-bearing: it maps directly to ALT+0..7 and Shift+Tab cycle order.
export type ViewKey =
  | 'editor' // 0  Code editor (floating windows over wallpaper)
  | 'diagram' // 1  Code diagram (existing GraphView)
  | 'deployment' // 2  Deployment diagram (shapes + arrows)
  | 'messages' // 3  LLM messages log
  | 'tasks' // 4  Tasks (+ Jira + auto-branch)
  | 'review' // 5  Review mode
  | 'terminal' // 6  Terminal (PTY)
  | 'browser' // 7  Web browser

// ViewContext — the ONLY object a view component receives. Everything a view needs
// from App-level state and actions flows through here. Read fields are live values;
// callbacks are stable (useCallback-wrapped in App). bus + api are module singletons
// re-exported here so a view file never imports App.
export interface ViewContext {
  // — Identity / lifecycle —
  viewKey: ViewKey
  active: boolean // true when this view is the visible one
  folder: string // absolute project root ('' when none open)

  // — Read: project / graph —
  graph: Graph | null // current domain graph (null until first scan)
  selectedNode: Node | null // last graph selection (AI context)
  navKey: number // bump = scene change; views may reset internal state

  // — Read: editor layer (owned by App, shared so editor view can render windows) —
  editors: EditorTarget[]
  activeEditorPath: string
  minimized: Set<string>

  // — Read: visual settings —
  wallpaper: string // CSS url() ('' = none)
  editorTheme: string
  vimOn: boolean
  copilotOn: boolean
  rainbow: boolean
  accent: string
  focusPath: string // pan/reveal target for graph/editor views

  // — Read: review —
  review: boolean
  reviewFiles: { path: string; absPath: string; status: string }[]

  // — Actions: editors —
  openFile: (absFile: string, fn?: string, animate?: boolean, gotoLine?: number) => void
  closeEditor: (path: string) => void
  selectEditor: (path: string) => void
  minimizeEditor: (path: string) => void

  // — Actions: graph mutations (only meaningful for diagram view) —
  expandApp: (appId: number) => void
  addElement: (name: string, file: string, kind: string, targetDir?: string) => void
  renameElement: (node: Node, className: string, fileBase: string) => void
  moveFile: (node: Node, targetDir: string) => void
  deleteElement: (node: Node, path: string) => void
  setSelectedNode: (n: Node | null) => void

  // — Singletons re-exposed so the view file imports only this contract —
  bus: typeof appBus
  api: Window['api']
}

// ViewDefinition — one registry entry. `icon` is a MUI icon component (e.g. CodeIcon),
// kept as a component (not a string) so the rail renders it directly. `titleKey` is an
// i18n key resolved by the rail with t(); never a literal string.
export interface ViewDefinition {
  key: ViewKey
  titleKey: string // i18n key, e.g. 'views.editor'
  Icon: ComponentType<{ fontSize?: 'small' | 'inherit' | 'large' }>
  Component: ComponentType<{ ctx: ViewContext }>
  // keepMounted: if true the view's Component stays mounted (display:none) when inactive
  // so it preserves state (terminal/browser/editor windows). Default false = unmount.
  keepMounted?: boolean
  // showsFileTree: if true the shell renders the left file-tree panel (FileBrowser) for
  // this view. Only the editor and code-diagram views work on files, so only they opt in;
  // every other view hides the tree. Default false = no tree.
  showsFileTree?: boolean
  // hostsEditors: if true this view hosts a set of open editor windows + their tab strip.
  // Each such view keeps its OWN independent list of open files (editor vs diagram are two
  // separate workspaces). Default false = no editor windows/tabs for this view.
  hostsEditors?: boolean
}
