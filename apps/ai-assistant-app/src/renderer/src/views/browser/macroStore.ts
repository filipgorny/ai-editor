// macroStore — browser macros persisted through the EXISTING scripts service.
//
// Per the IPC contract there is no dedicated macro CRUD; macros are just stored Lua
// scripts filed under a reserved project id ('__browser__'). This thin wrapper hides that
// convention behind list/save/delete so the view never spreads the magic project string.

import type { Api } from './types'

// The reserved project bucket that scopes macros away from real project scripts.
export const MACRO_PROJECT = '__browser__'

export interface Macro {
  id: number
  name: string
  content: string
}

// Starter macros seeded the first time the panel opens with an empty store, so users have
// runnable examples (and a template) without writing Lua from scratch.
export const STARTER_MACROS: { name: string; content: string }[] = [
  {
    name: 'Login (example)',
    content: [
      "-- Fill a generic email/password form and submit.",
      "-- Adjust the selectors to match the target page.",
      "type('#email', 'a@b.com')",
      "type('#password', 'test')",
      "click('#submit')"
    ].join('\n')
  },
  {
    name: 'Accept cookies',
    content: [
      "-- Click a common cookie-consent button if present.",
      "wait(400)",
      "click('button#onetrust-accept-btn-handler')"
    ].join('\n')
  },
  {
    name: 'DuckDuckGo search',
    content: [
      "-- Type a query into DuckDuckGo and run it.",
      "goto('https://duckduckgo.com')",
      "waitFor('input[name=q]')",
      "type('input[name=q]', 'electron webview')",
      "click('button[type=submit]')"
    ].join('\n')
  }
]

// listMacros returns macros, seeding the starter set on a first-ever empty store.
export async function listMacros(api: Api): Promise<Macro[]> {
  const scripts = await api.listScripts(MACRO_PROJECT)

  if (scripts.length === 0) {
    for (const m of STARTER_MACROS) {
      await api.saveScript({ name: m.name, content: m.content, project: MACRO_PROJECT })
    }

    const seeded = await api.listScripts(MACRO_PROJECT)

    return seeded.map((s) => ({ id: s.id, name: s.name, content: s.content }))
  }

  return scripts.map((s) => ({ id: s.id, name: s.name, content: s.content }))
}

// saveMacro creates or updates a macro (id omitted = create).
export async function saveMacro(
  api: Api,
  m: { id?: number; name: string; content: string }
): Promise<Macro> {
  const saved = await api.saveScript({ id: m.id, name: m.name, content: m.content, project: MACRO_PROJECT })

  return { id: saved.id, name: saved.name, content: saved.content }
}

// deleteMacro removes a macro by id.
export async function deleteMacro(api: Api, id: number): Promise<boolean> {
  return api.deleteScript(id)
}
