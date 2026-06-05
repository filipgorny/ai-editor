# Commands (`commander`)

The renderer has a single, app-wide **command dispatcher** — `Commander`. Where the
[event bus](EVENTS.md) (`appBus`) is for *reacting* to what happened, the Commander is for
*driving* the app: a flat list of named commands that type text, move the cursor, open
files, run the AI, and more. It is the imperative counterpart of the bus, and the second
integration point for **user scripts**.

- **Source of truth:** [`src/renderer/src/commander/Commander.ts`](src/renderer/src/commander/Commander.ts)
- **Global handle:** `window.commander`
- Wired into the app once in `App.tsx` (host actions) and per active editor in `CodeEditor.tsx`.

## Running commands

```ts
// Run one command (returns { ok: boolean, error?: string })
await window.commander.run('write:hello world')

// Run several, one per line (blank lines and #-comments skipped; stops on first error)
await window.commander.runScript(`
  open:src/main.ts
  goto:10
  write:// TODO
  newline
  save
`)
```

### Syntax

A command string is **`name:arg`** — everything up to the **first colon** is the command
name, everything after it is the **raw argument** (colons and spaces are preserved, so
`write:foo: bar` writes the literal `foo: bar`). Commands that take no argument are just
their name: `save`, `close`, `refresh`.

Most editor commands (`write`, `cursor`, `select`, `save`, `find`, …) act on the **active
editor window**. If no editor is active they fail with `no active editor`.

### Result & events

`run()` returns `{ ok, error }` and also fires on the event bus:

| Event | Payload | When |
| --- | --- | --- |
| `command:run` | `{ name, arg }` | A command ran successfully. |
| `command:error` | `{ name, arg, message }` | Unknown command, or the handler threw. |

So a script can watch every command the same way it watches every event:

```ts
window.appBus.on('command:run', ({ name, arg }) => console.log('ran', name, arg))
```

## Command catalog

### Edycja (text editing — active editor)

| Command | Argument | Does |
| --- | --- | --- |
| `write:<text>` | text | Inserts text at the cursor, replacing any selection. |
| `newline` | — | Inserts a line break at the cursor. |
| `tab` | — | Inserts an indent (two spaces) at the cursor. |
| `backspace` | — | Deletes the character before the cursor (or the selection). |
| `delete` | — | Deletes the character after the cursor (or the selection). |
| `delete:line` | — | Deletes the current line. |
| `clear` | — | Clears the whole document. |
| `replace:<old>::<new>` | `old::new` | Replaces **all** occurrences of `old` with `new` in the file. |
| `duplicate` | — | Duplicates the selection, or the current line if nothing is selected. |
| `move:up` / `move:down` | — | Moves the current line up / down (swaps with its neighbour). |
| `join` | — | Joins the next line onto the current one (with a single space). |
| `comment` | — | Toggles a `//` line comment on the current line (or selected lines). |
| `indent` / `outdent` | — | Adds / removes two-space indentation on the current line(s). |
| `upper` / `lower` | — | Upper/lower-cases the selection (or the word under the cursor). |
| `trim` | — | Strips trailing whitespace from every line. |
| `insertAbove:<text>` | text | Inserts a new line with `text` **above** the current line. |
| `insertBelow:<text>` | text | Inserts a new line with `text` **below** the current line. |
| `append:<text>` | text | Appends `text` at the **end** of the current line. |
| `prepend:<text>` | text | Inserts `text` at the **start** of the current line. |
| `wrap:<before>::<after>` | `before::after` | Wraps the selection (e.g. `wrap:(::)`). Without `::`, the same text on both sides. |

```
write:export const x = 1
newline
replace:foo::bar
comment
move:down
wrap:`::`
```

### Schowek (clipboard — active editor)

| Command | Argument | Does |
| --- | --- | --- |
| `copy` | — | Copies the selection (or current line) to the clipboard. |
| `cut` | — | Cuts the selection (or current line) to the clipboard. |
| `paste` | — | Pastes the clipboard contents at the cursor. |

### Kursor (cursor movement — active editor)

| Command | Argument | Does |
| --- | --- | --- |
| `cursor:<dir>` | `up` `down` `left` `right` `wordLeft` `wordRight` `lineStart` `lineEnd` `docStart` `docEnd` | Moves the caret one step in that direction. `home`/`end`/`top`/`bottom` are accepted aliases. |
| `extend:<dir>` | same directions as `cursor` | Moves the caret the same way but **keeps the anchor**, growing the selection. |
| `page:up` / `page:down` | — | Moves the caret up / down by one viewport height. |
| `goto:<line>` | line (1-based) | Moves the caret to the start of a line. |
| `goto:<line>:<col>` | line:col (both 1-based) | Moves the caret to a line and column. |
| `scroll:<where>` | `top` `bottom` `center` | Scrolls the view (without moving the caret). |

```
goto:42:5
cursor:wordRight
extend:lineEnd
scroll:center
```

### Zaznaczenie (selection — active editor)

| Command | Argument | Does |
| --- | --- | --- |
| `select:all` | — | Selects the whole document. |
| `select:line` | — | Selects the current line. |
| `select:word` | — | Selects the word under the cursor. |
| `select:none` | — | Collapses the selection to a caret. |

### Nawigacja (navigation in file — active editor)

| Command | Argument | Does |
| --- | --- | --- |
| `find:<text>` | text | Opens the find box and jumps to the first match. |
| `goto-fn:<name>` | function/method name | Scrolls to the declaration and places the caret. |

```
find:useEffect
goto-fn:runAgent
```

### Pliki (files & editor windows)

| Command | Argument | Does |
| --- | --- | --- |
| `open:<path>` | path, relative to the project or absolute | Opens the file in an editor window. |
| `open:<path>#<fn>` | path + function | Opens the file and scrolls to a function. |
| `save` | — | Saves the active editor to disk. |
| `close` | — | Closes the active editor. |
| `close:<path>` | path / filename | Closes the matching open editor. |
| `focus:<path>` | path / filename | Switches to (activates) the matching open editor. |
| `minimize` | — | Minimizes the active editor. |
| `fullscreen:<mode>` | `on` `off` `toggle` | Toggles the active editor's fullscreen. |
| `tabs:next` / `tabs:prev` | — | Switches to the next / previous open editor. |
| `closeAll` | — | Closes every open editor. |

Paths in `open` may be relative to the project root (`src/main.ts`) or absolute
(`/home/…`). `close`/`focus` match an open editor by exact path **or** by suffix, so a bare
filename usually works.

```
open:src/renderer/src/App.tsx#runAgent
focus:App.tsx
tabs:next
```

### AI

| Command | Argument | Does |
| --- | --- | --- |
| `ai:<prompt>` | prompt | Runs the in-editor AI prompt on the active editor (rewrites its content). |
| `agent:<prompt>` | prompt | Sends a request to the main agent (file operations across the project). |

```
ai:add JSDoc to every function
agent:create a UserRepository class in src/db
```

### Projekt (project)

| Command | Argument | Does |
| --- | --- | --- |
| `pickProject` | — | Opens the folder picker and scans the chosen project. |
| `refresh` | — | Re-scans the current project; refreshes the graph and file tree. |

### Backend (gateway → services)

Fire-and-forget commands that call the backend through `window.api` (the gateway surface). For
calls that **return data**, scripts should use the Lua `api` table instead (see [SCRIPTING.md](SCRIPTING.md)).

| Command | Argument | Does |
| --- | --- | --- |
| `scan:<path>` | path | Starts a project scan (gateway → scanner). |
| `scan-app:<appId>` | app id | Deep-scans a single app by its `app_id`. |
| `new-file:<dir>::<file>::<name>` | dir, file, name | Creates a file (filer) and opens it. |
| `new-folder:<dir>::<name>` | dir, name | Creates a folder (filer). |
| `delete-file:<path>` | path | Deletes a file/folder on disk (filer). |
| `move-file:<path>::<targetDir>` | path, target | Moves a file to another folder (filer). |
| `ai-provider:<name>` | provider | Switches the LLM provider in the `ai` service (e.g. `ollama`/`openai`). |
| `publish-event:<type>::<title>` | type, title | Publishes a backend event (events service / Redis). |
| `script:<id>` | script id | Loads a stored script (scripting service) by id and runs its content as Lua. |

### Lua (see [SCRIPTING.md](SCRIPTING.md))

| Command | Argument | Does |
| --- | --- | --- |
| `lua:<path>` | path to a `.lua` file | Loads and runs a Lua script file from disk. |
| `lua-eval:<code>` | Lua code | Runs inline Lua, e.g. `lua-eval:cmd("write","hi")`. |
| `lua-reset` | — | Tears down the Lua runtime (detaches all script listeners). |

### Narzędzia (utilities)

| Command | Argument | Does |
| --- | --- | --- |
| `log:<message>` | message | Prints a message to the console (handy inside scripts). |
| `wait:<ms>` | milliseconds | Awaits a delay — useful for scripted animations / sequences. |
| `repeat:<n>:<command>` | n + command | Runs a command `n` times, e.g. `repeat:5:cursor:down`. |
| `emit:<event>` | event name | Fires an `appBus` event (bridge to [EVENTS.md](EVENTS.md)). |
| `emit:<event>::<json>` | event + JSON payload | Same, with a JSON payload: `emit:my:event::{"x":1}`. |
| `help` | — | Prints the full command list to the console (`console.table`). |
| `noop` | — | Does nothing (placeholder). |

Because `wait` and `repeat` are async-aware, scripts can drive timed sequences:

```
open:src/main.ts
repeat:3:newline
wait:200
write:// generated
```

## Adding / overriding a command

The Commander is extensible — a script can register new commands (or override built-ins):

```ts
window.commander.register({
  name: 'banner',
  group: 'Custom',
  params: 'text',
  summary: 'Wstawia ramkę z komentarzem.',
  run: (arg) => window.commander.run(`write:// ===== ${arg} =====`)
})

await window.commander.run('banner:SECTION')
```

`register({ name, group, params, summary, run })` — `run(arg)` receives the raw argument
string and may be async; throwing turns into a `command:error` event and `{ ok:false }`.

To add a **built-in** command, register it in `registerBuiltins()` in `Commander.ts` and add
a row to the relevant table above. Editor-only commands use `this.view()` (the active
CodeMirror view); app-level commands use `this.host` (wired in `App.tsx`).
