# Scripting (Lua)

The app runs **Lua** scripts that drive it through the [Commander](COMMANDS.md) and react to
[events](EVENTS.md). Scripts are stored in the **scripting** backend service (Postgres) and
can be edited from the **Skrypty** button in the top bar (right of *Settings*).

- **Runtime:** [wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4 → WASM), embedded in the renderer.
- **Source of truth:** [`src/renderer/src/lua/runtime.ts`](src/renderer/src/lua/runtime.ts)
- **Storage:** `scripting` service → gateway → `window.api.{listScripts,getScript,saveScript,deleteScript}`
- Lazily loaded — the WASM engine is pulled in only when the first script runs.

## Where scripts live

Each script has a **name**, **content** (Lua), and an optional **project** it is pinned to:

- `project == ""` → **global**: available in every project.
- `project == "<folder>"` → only loaded when that project is open.

`project` is **optional** — leave it empty for a global script. When a project opens, the app
auto-loads its scripts (global + pinned to that folder) and runs them once.

Manage scripts in the **Skrypty** dialog: create, edit, pin to the current project, **Run**, and
delete. You can also run a stored script by id from the Commander: `script:<id>`.

## The Lua API

Every script is given these globals:

### Commands & events

| Global | Signature | Does |
| --- | --- | --- |
| `cmd` | `cmd(name, arg?)` | Run a Commander command, e.g. `cmd("write", "hi")` → `write:hi`. |
| `run` | `run(str)` | Run a raw command string, e.g. `run("goto:10")`. |
| `on` | `on(event, fn)` | Subscribe to one app event; `fn` gets the payload as a table. Returns an unsubscribe fn. |
| `onAny` | `onAny(fn)` | Subscribe to every event; `fn(name, payload)`. |
| `emit` | `emit(name, payload?)` | Fire an app-bus event. |
| `onKey` | `onKey(combo, fn)` | Bind a key chord (a real keybinding — suppresses the default action). |
| `register` | `register(name, fn, summary?)` | Define a new Commander command backed by a Lua function. |
| `log` | `log(...)` | Print to the dev console (`[lua]`). |

### Keys

`onKey(combo, fn)` binds a keyboard chord. The combo is `modifier+...+key` with modifiers
`ctrl` / `alt` / `shift` / `meta` in any order/casing — e.g. `"ctrl+shift+s"`, `"Shift+Tab"`.
`fn` receives the `KeyEvent` table (`key`, `code`, `ctrl`, `alt`, `shift`, `meta`, `combo`,
`repeat`, `editable`). Unlike `on("key:…")`, `onKey` **suppresses the chord's default action**
(so e.g. Shift+Tab won't also outdent). To merely observe keys without binding, use
`on("key", fn)` or `on("key:<combo>", fn)`.

```lua
-- The default seeded script: Shift+Tab cycles to the next editor window.
onKey("shift+tab", function() cmd("tabs", "next") end)

-- Observe every key (no binding, no preventDefault)
on("key", function(e) log(e.combo) end)
```

> A **default global script** ("Cykl okien (Shift+Tab)") is seeded into the store on first
> run with exactly the binding above, so cycling between open editor windows works out of the
> box. Edit or delete it from the **Skrypty** dialog.

### `api` — the backend surface (gateway)

`api.*` calls reach the backend through the gateway and **return values** to the script
(unlike `cmd`, which is fire-and-forget). Mirrors `window.api`.

- **Files / project:** `api.readFile(path)`, `api.saveFile(path, content)`, `api.createFile(dir, file, name)`,
  `api.createFolder(dir, name)`, `api.moveFile(old, targetDir)`, `api.renameFile(old, base, className, oldName)`,
  `api.deleteFile(path)`, `api.resolveImport(from, spec)`, `api.listProjects()`, `api.getGraph(projectId)`,
  `api.getAppGraph(appId)`, `api.startScan(path)`, `api.startScanApp(appId)`
- **Disk browse:** `api.fsHome()`, `api.fsList(path)`, `api.fsFind(path)`, `api.fsConventions(path)`
- **AI:** `api.aiAgent(prompt, dir, lang)`, `api.aiEdit(code, prompt, file)`, `api.aiComplete(prefix, suffix, file)`,
  `api.aiReview(code, file, lang)`, `api.aiModel()`, `api.aiSetProvider(name)`, `api.lintFile(code, file)`
- **Events (Redis):** `api.publishEvent({ type=..., title=... })`
- **Stored scripts:** `api.listScripts(project?)`, `api.getScript(id)`, `api.saveScript({ name=..., content=..., project=? })`,
  `api.deleteScript(id)`

## Examples

```lua
-- React to app events
on("file:create", function(p) log("new file: " .. p.path) end)
on("editor:save", function(p) log("saved " .. p.path) end)

-- Drive the editor
cmd("open", "src/main.ts")
cmd("goto", "10")
cmd("write", "-- hello from Lua")
cmd("save")

-- Define a custom command, then use it
register("hr", function() cmd("write", string.rep("-", 60)) end, "Insert a rule")
run("hr")

-- Read from the backend and act on the result
local code = api.readFile("/abs/path/file.ts")
log("file has " .. #code .. " bytes")
```

## Commands related to scripting

From the Commander (see [COMMANDS.md](COMMANDS.md)):

| Command | Does |
| --- | --- |
| `lua:<path>` | Load and run a `.lua` file from disk. |
| `lua-eval:<code>` | Run inline Lua. |
| `lua-reset` | Tear down the runtime (detach all script listeners). |
| `script:<id>` | Load a stored script by id and run its content. |

## Architecture

```
Skrypty dialog / auto-load ─┐
window.commander  ──────────┼─→ lua/runtime.ts (wasmoon)  ──→ commander / appBus
window.api.*scripts*  ──→ gateway ──→ scripting service ──→ Postgres
```

The gateway only **proxies** script CRUD; all logic and storage live in the `scripting`
service (`services/scripting`, `proto/scripting/v1`).
