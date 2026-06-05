# In-app events (`appBus`)

The renderer has a small, purely frontend **event bus** that every meaningful UI action
flows through. It is the integration point for **user scripts**: a script can subscribe to
any event and react to what happens in the app, without touching component internals.

> Not to be confused with `window.api.publishEvent(...)`, which publishes to the **backend**
> (gateway → events service / Redis). The bus described here never leaves the renderer.

- **Source of truth:** [`src/renderer/src/events/bus.ts`](src/renderer/src/events/bus.ts) (`AppEventMap`)
- **Global handle:** `window.appBus`
- In **DEV** every event is logged to the console (`installDevLogger`).

## Subscribing

```ts
// Listen to one event (returns an unsubscribe function)
const off = window.appBus.on('file:create', ({ path, kind }) => {
  console.log('new', kind, 'at', path)
})

// Listen once
window.appBus.once('scan:end', () => console.log('first scan finished'))

// Listen to EVERYTHING — the main hook for scripts
window.appBus.onAny((name, payload) => {
  console.log(name, payload)
})

// Stop listening
off()
```

`emit()` is used internally by the app to fire events; scripts normally only `on`/`onAny`.

## Event catalog

### Project / scanning

| Event | Payload | Emitted when |
| --- | --- | --- |
| `project:open` | `{ folder: string }` | A project folder is opened (startup auto-open or "Choose project"). |
| `scan:start` | `{ kind: 'project' \| 'app'; path?: string; appId?: number }` | A scan starts — full project scan or inline app expand. |
| `scan:progress` | `{ currentFile: string; filesDone: number; entitiesDone: number }` | On each scanner progress tick. |
| `scan:end` | `{ kind: 'project' \| 'refresh' \| 'expand' }` | A scan finishes: initial `project`, silent `refresh` after a file op, or app `expand`. |
| `scan:error` | `{ message: string }` | The scanner reports an error. |

### Navigation

| Event | Payload | Emitted when |
| --- | --- | --- |
| `nav:back` | `{}` | History back (mouse back button). |
| `nav:forward` | `{}` | History forward (mouse forward button). |
| `nav:app-expand` | `{ appId: number }` | An app node is expanded inline for the first time. |

### File operations (on-disk mutations)

| Event | Payload | Emitted when |
| --- | --- | --- |
| `file:create` | `{ path: string; kind: 'class' \| 'function' }` | A class/function file is created (Add element). |
| `folder:create` | `{ path: string }` | A folder is created (Add element). |
| `file:rename` | `{ from: string; to: string }` | A file/class is renamed. |
| `file:move` | `{ from: string; to: string }` | A file is moved to another folder. |
| `file:delete` | `{ path: string }` | A file/folder is deleted. |

### Editor

| Event | Payload | Emitted when |
| --- | --- | --- |
| `editor:open` | `{ path: string }` | A file is opened (or revealed) in an editor window. |
| `editor:close` | `{ path: string }` | An editor window is closed. |
| `editor:activate` | `{ path: string }` | An editor tab is selected. |
| `editor:minimize` | `{ path: string }` | An editor window is minimized. |
| `editor:save` | `{ path: string }` | The file is saved (Ctrl/Cmd+S or Save button). |
| `editor:load-error` | `{ path: string }` | The file could not be read. |
| `editor:fullscreen` | `{ path: string; on: boolean }` | Editor fullscreen is toggled. |
| `editor:ai-edit` | `{ path: string }` | The in-editor AI prompt produced a change. |

### AI agent (main prompt bar)

| Event | Payload | Emitted when |
| --- | --- | --- |
| `agent:start` | `{ prompt: string; dir: string }` | An agent request is sent. |
| `agent:success` | `{ ops: number; message: string }` | The agent responds (`ops` = number of file operations). |
| `agent:error` | `{ message: string }` | The agent request fails. |

### Graph

| Event | Payload | Emitted when |
| --- | --- | --- |
| `graph:node-click` | `{ id: string; kind: string }` | A non-folder/app node is clicked. |
| `graph:node-dblclick` | `{ id: string; kind: string }` | A node is double-clicked. |
| `graph:folder-toggle` | `{ id: string; expanded: boolean }` | A folder/app node is expanded or collapsed. |
| `graph:search` | `{ query: string }` | The graph search is submitted (Enter). |
| `graph:move-start` | `{ path: string }` | A "contains" edge is grabbed to move a file (relink mode). |

### Settings

| Event | Payload | Emitted when |
| --- | --- | --- |
| `settings:provider-change` | `{ provider: string }` | The AI model provider is saved. |
| `settings:theme-change` | `{ theme: string }` | The editor theme is changed. |
| `settings:language-change` | `{ lang: string }` | The UI language is changed. |

## Adding a new event

1. Add the name → payload entry to `AppEventMap` in `src/renderer/src/events/bus.ts`.
2. `appBus.emit('your:event', { ... })` at the place where it happens.
3. Document it in the table above.

Names are namespaced `domain:action`; payloads are plain JSON-serializable objects.
