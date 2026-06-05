// Builds an AI context describing the Lua scripting vocabulary (globals, events, commands,
// api methods). It's prepended to the copilot prefix in the scripts editor so completions are
// aware of what scripts can actually call. NOT inserted into the document.

import { commander } from '../commander/Commander'

// App-bus events scripts can listen to (mirrors AppEventMap in events/bus.ts + keys.ts).
const EVENTS = [
  'project:open',
  'scan:start',
  'scan:progress',
  'scan:end',
  'scan:error',
  'nav:back',
  'nav:forward',
  'nav:app-expand',
  'file:create',
  'folder:create',
  'file:rename',
  'file:move',
  'file:delete',
  'disk:change',
  'disk:refresh',
  'editor:open',
  'editor:close',
  'editor:activate',
  'editor:minimize',
  'editor:save',
  'editor:load-error',
  'editor:fullscreen',
  'editor:ai-edit',
  'agent:start',
  'agent:success',
  'agent:error',
  'graph:node-click',
  'graph:node-dblclick',
  'graph:folder-toggle',
  'graph:search',
  'graph:move-start',
  'settings:provider-change',
  'settings:theme-change',
  'settings:language-change',
  'command:run',
  'command:error',
  'key',
  'key:<combo>',
  'keyup',
  'keyup:<combo>'
]

// Backend api methods exposed to scripts (mirrors the `api` table in lua/runtime.ts).
const API = [
  'readFile(path)',
  'saveFile(path,content)',
  'createFile(dir,file,name)',
  'createFolder(dir,name)',
  'moveFile(old,targetDir)',
  'renameFile(old,base,className,oldName)',
  'deleteFile(path)',
  'resolveImport(from,spec)',
  'listProjects()',
  'getGraph(projectId)',
  'getAppGraph(appId)',
  'startScan(path)',
  'startScanApp(appId)',
  'fsHome()',
  'fsList(path)',
  'fsFind(path)',
  'fsConventions(path)',
  'aiAgent(prompt,dir,lang)',
  'aiEdit(code,prompt,file)',
  'aiComplete(prefix,suffix,file)',
  'aiReview(code,file,lang)',
  'aiModel()',
  'aiSetProvider(name)',
  'lintFile(code,file)',
  'publishEvent({type=...,title=...})',
  'listScripts(project)',
  'getScript(id)',
  'saveScript({name=...,content=...,project=?})',
  'deleteScript(id)'
]

// buildScriptContext returns a Lua comment block describing the scripting API. Built from the
// live Commander registry (so user-registered commands are included too) plus the lists above.
export function buildScriptContext(): string {
  const cmds = commander
    .list()
    .map((c) => (c.params && c.params !== '—' ? `${c.name}:<${c.params}>` : c.name))

  return [
    '-- AI context for writing Lua scripts in this app (reference only).',
    '-- Globals: cmd(name,arg), run("name:arg"), on(event,fn), onAny(fn), onKey("ctrl+s",fn), emit(name,payload), log(...), register(name,fn,summary), api.*',
    '-- Events (use with on/onKey): ' + EVENTS.join(', '),
    '-- Commands (use with cmd/run): ' + cmds.join(', '),
    '-- api methods: ' + API.join(', ')
  ].join('\n')
}
