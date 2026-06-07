// View registry — the single, ordered source of truth for the multi-view shell.
//
// The array index === ALT ordinal (ALT+0 = VIEWS[0], …) and also the Shift+Tab cycle
// order. App builds both the left rail and the active-view slot from this one array.
//
//   import { VIEWS } from './views/registry'
//   const def = VIEWS[index] // ALT+index
//
// Adding a view = append ONE entry below (and create its <Name>View.tsx file). No other
// file needs to change for a new view. The integration phase imports the remaining view
// files (deployment/messages/tasks/review/terminal/browser) and appends them here, or
// calls registerView() at module load.
//
// NOTE: registry.ts imports the views, never the other way round (views import only the
// ./types contract) — this keeps the dependency graph acyclic.

import { createElement } from 'react'
import CodeIcon from '@mui/icons-material/Code'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import ForumIcon from '@mui/icons-material/Forum'
import ChecklistIcon from '@mui/icons-material/Checklist'
import RateReviewIcon from '@mui/icons-material/RateReview'
import TerminalIcon from '@mui/icons-material/Terminal'
import type { ViewDefinition, ViewKey, ViewContext } from './types'
import CodeEditorView from '@/views/editor/CodeEditorView'
import GraphView from '@/views/diagram/GraphView'
import { deploymentView } from '@/views/deployment/DeploymentView'
import MessagesView from '@/views/messages/MessagesView'
import TasksView from '@/views/tasks/TasksView'
import TerminalView from '@/views/terminal/TerminalView'
import { browserView } from '@/views/browser/BrowserView'

// — Built-in: 0 editor — floating CodeEditor windows over the wallpaper.
const editorView: ViewDefinition = {
  key: 'editor',
  titleKey: 'views.editor',
  Icon: CodeIcon,
  Component: CodeEditorView,
  keepMounted: true,
  showsFileTree: true,
  hostsEditors: true
}

// DiagramComponent — thin wrapper around the existing GraphView, adapting the shared
// ViewContext to GraphView's props. Kept co-located here (rather than in its own file)
// so the built-in code-diagram view works without introducing a new owned file; the
// integration phase may later promote it to views/DiagramView.tsx.
function DiagramComponent({ ctx }: { ctx: ViewContext }): React.JSX.Element | null {
  if (!ctx.graph) {
    return null
  }

  return createElement(GraphView, {
    graph: ctx.graph,
    selectedId: ctx.selectedNode?.id,
    onSelect: ctx.setSelectedNode,
    onNodeClick: (node) => {
      if (node.absFile) {
        ctx.openFile(node.absFile)
      }
    },
    onExpandApp: (appId) => ctx.expandApp(appId),
    wallpaper: ctx.wallpaper,
    onAddElement: (name, file, kind, targetDir) => ctx.addElement(name, file, kind, targetDir),
    onRename: ctx.renameElement,
    onMoveFile: ctx.moveFile,
    onDelete: ctx.deleteElement,
    focusPath: ctx.focusPath,
    navKey: ctx.navKey
  })
}

// — Built-in: 1 diagram — existing code graph (GraphView). keepMounted so the diagram keeps
// its state (expanded folders/apps, pan/zoom, drill-downs) when you switch to another view
// and back — without it the view unmounts and the graph collapses to its initial state.
const diagramView: ViewDefinition = {
  key: 'diagram',
  titleKey: 'views.diagram',
  Icon: AccountTreeIcon,
  Component: DiagramComponent,
  keepMounted: true,
  hostsEditors: true
}

// — 3 messages — chronological LLM in/out log. keepMounted so scrollback survives view
// switches (it only collects bus messages while mounted).
const messagesView: ViewDefinition = {
  key: 'messages',
  titleKey: 'views.messages',
  Icon: ForumIcon,
  Component: MessagesView,
  keepMounted: true
}

// — 4 tasks — task list + Jira + auto-branch. Reloads from IPC on activate; unmount is fine.
const tasksView: ViewDefinition = {
  key: 'tasks',
  titleKey: 'views.tasks',
  Icon: ChecklistIcon,
  Component: TasksView
}

// — 5 review — review mode reuses the editor scene: empty wallpaper centre + floating
// editor windows + tab strip. The left panel shows the changed-files list (App wires it
// via showsFileTree || review) and opened editors carry review decorations.
const reviewView: ViewDefinition = {
  key: 'review',
  titleKey: 'views.review',
  Icon: RateReviewIcon,
  Component: CodeEditorView,
  keepMounted: true,
  showsFileTree: true,
  hostsEditors: true
}

// — 6 terminal — xterm bound to a main-process PTY. keepMounted so the session survives.
const terminalView: ViewDefinition = {
  key: 'terminal',
  titleKey: 'views.terminal',
  Icon: TerminalIcon,
  Component: TerminalView,
  keepMounted: true
}

// VIEWS — ordered registry. Index === ALT ordinal === Shift+Tab cycle order. The order
// is load-bearing: it maps directly to ALT+0..7. deploymentView (2) and browserView (7)
// are imported ready-built ViewDefinitions (icon/title baked in by their authors).
export const VIEWS: ViewDefinition[] = [
  editorView,
  diagramView,
  deploymentView,
  messagesView,
  tasksView,
  reviewView,
  terminalView,
  browserView
]

// registerView appends (or replaces by key) a view definition at runtime — the hook the
// integration phase / plugins use to add views without editing this file's seed list.
export function registerView(def: ViewDefinition): void {
  const i = VIEWS.findIndex((v) => v.key === def.key)

  if (i >= 0) {
    VIEWS[i] = def

    return
  }

  VIEWS.push(def)
}

// viewByKey resolves a view definition by its stable key.
export function viewByKey(key: ViewKey): ViewDefinition | undefined {
  return VIEWS.find((v) => v.key === key)
}

// DEFAULT_VIEW — the view shown on startup.
export const DEFAULT_VIEW: ViewKey = 'editor'
