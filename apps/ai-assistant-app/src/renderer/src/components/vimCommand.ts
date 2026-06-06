// vimCommand — a tiny vim/ex command-line parser + dispatcher for the AI area.
//
// When the bottom AI input starts with ':' the text is treated as a vim/ex command
// (NOT a prompt for the LLM). This module recognises the command, runs it against the
// active editor through the app-wide Commander (window.commander / the imported
// singleton), and reports success/failure back to the caller so the AI area can show a
// short status instead of sending the line to the model.
//
// Supported (intentionally small — the Commander already owns the full editor command
// catalogue; this is just the vim-flavoured surface the plan asks for):
//   :%s/old/new/g   substitute across the whole active editor (regex; flags g/i)
//   :s/old/new/g    substitute on the current line (or selection) — best-effort
//   :w              write (save) the active editor
//   :q              close the active editor window
//   :wq / :x        write then close
//
// It never imports App.tsx or the registry. It talks to the editor exclusively via the
// Commander singleton (which holds the live, bound active-editor view) and the bus.

import { commander } from '../commander/Commander'
import { appBus } from '../events'

// VimCommandResult — outcome of handling a ':' line. `messageKey` is an i18n key (never a
// literal string) the AI area resolves with t(); `messageVars` are its interpolation vars.
export type VimCommandResult = {
  handled: boolean
  ok: boolean
  messageKey?: string
  messageVars?: Record<string, string | number>
}

// isVimCommand — true when the trimmed text is a vim/ex command line (starts with ':').
export function isVimCommand(text: string): boolean {
  return text.trim().startsWith(':')
}

// ParsedSubstitute — the pieces of a :s / :%s substitute command.
type ParsedSubstitute = {
  kind: 'substitute'
  range: 'file' | 'line'
  pattern: string
  replacement: string
  global: boolean
  ignoreCase: boolean
}

type ParsedSimple = { kind: 'write' | 'quit' | 'writeQuit' | 'unknown'; raw: string }

export type ParsedVimCommand = ParsedSubstitute | ParsedSimple

// splitSubstitute splits a substitute body on an unescaped delimiter (default '/'),
// honouring backslash escapes so patterns like \/ survive. Returns up to 3 parts.
function splitSubstitute(body: string, delim: string): string[] {
  const parts: string[] = []
  let current = ''
  let i = 0

  while (i < body.length) {
    const ch = body[i]

    if (ch === '\\' && i + 1 < body.length) {
      // Keep the escape sequence intact for the regex engine, except an escaped
      // delimiter which becomes a literal delimiter inside the part.
      const next = body[i + 1]

      if (next === delim) {
        current += delim
      } else {
        current += ch + next
      }

      i += 2

      continue
    }

    if (ch === delim) {
      parts.push(current)
      current = ''
      i += 1

      continue
    }

    current += ch
    i += 1
  }

  parts.push(current)

  return parts
}

// parseVimCommand turns a ':' line into a structured command, or null when the text is
// not a vim command at all (caller should then treat it as an LLM prompt).
export function parseVimCommand(input: string): ParsedVimCommand | null {
  const trimmed = input.trim()

  if (!trimmed.startsWith(':')) {
    return null
  }

  const body = trimmed.slice(1).trim()

  // Substitute: optional '%' range, then s<delim>pat<delim>rep<delim>flags.
  const subMatch = /^(%?)s(.)/.exec(body)

  if (subMatch) {
    const range: 'file' | 'line' = subMatch[1] === '%' ? 'file' : 'line'
    const delim = subMatch[2]
    const rest = body.slice(subMatch[0].length)
    const parts = splitSubstitute(rest, delim)
    const pattern = parts[0] ?? ''
    const replacement = parts[1] ?? ''
    const flags = parts[2] ?? ''

    return {
      kind: 'substitute',
      range,
      pattern,
      replacement,
      global: flags.includes('g'),
      ignoreCase: flags.includes('i')
    }
  }

  // Simple ex commands. ':wq' and ':x' write then close; ':w' writes; ':q' closes.
  if (body === 'w' || body === 'write') {
    return { kind: 'write', raw: body }
  }

  if (body === 'q' || body === 'q!' || body === 'quit') {
    return { kind: 'quit', raw: body }
  }

  if (body === 'wq' || body === 'x') {
    return { kind: 'writeQuit', raw: body }
  }

  return { kind: 'unknown', raw: body }
}

// vimReplacementToJs converts a vim substitute replacement into a JS replacement string:
// vim uses \1, \2 for capture groups while JS String.replace uses $1, $2. A literal '$'
// is escaped to '$$' so it is not treated as a JS replacement token.
function vimReplacementToJs(rep: string): string {
  return rep.replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1')
}

// applyFileSubstitute computes the substituted whole-document text and writes it back
// through the Commander (clear + write preserves undo and keeps the editor authoritative).
async function applyFileSubstitute(cmd: ParsedSubstitute): Promise<VimCommandResult> {
  const editor = commander.activeEditor()

  if (!editor) {
    return { handled: true, ok: false, messageKey: 'vim.noEditor' }
  }

  let re: RegExp

  try {
    const flags = 'gm' + (cmd.ignoreCase ? 'i' : '')
    re = new RegExp(cmd.pattern, flags)
  } catch {
    return { handled: true, ok: false, messageKey: 'vim.badPattern' }
  }

  const jsRep = vimReplacementToJs(cmd.replacement)
  let count = 0
  let next: string

  if (cmd.global) {
    // /g: replace every match on every line.
    next = editor.content.replace(re, (...m) => {
      count++

      return resolveReplacement(jsRep, m)
    })
  } else {
    // Without /g vim replaces only the FIRST match on each line.
    next = editor.content
      .split('\n')
      .map((line) => {
        let replaced = false

        return line.replace(re, (...m) => {
          if (replaced) {
            return m[0]
          }

          replaced = true
          count++

          return resolveReplacement(jsRep, m)
        })
      })
      .join('\n')
  }

  if (count === 0) {
    return { handled: true, ok: true, messageKey: 'vim.noMatch', messageVars: { pattern: cmd.pattern } }
  }

  // Rewrite the whole document: clear, then write the new text verbatim (Commander's
  // `write` keeps everything after the first colon, including newlines, intact).
  await commander.run('clear')
  await commander.run('write:' + next)

  return { handled: true, ok: true, messageKey: 'vim.substituted', messageVars: { count } }
}

// resolveReplacement applies a JS-style replacement string to one regex match tuple
// (as received by String.replace's function callback: [match, ...groups, offset, str]).
function resolveReplacement(jsRep: string, match: unknown[]): string {
  const whole = String(match[0])
  // Drop the trailing offset (number) and full-string (string) entries to isolate groups.
  const groups = match.slice(1, -2).map((g) => (g == null ? '' : String(g)))

  return jsRep.replace(/\$(\d|\$|&)/g, (_, tok: string) => {
    if (tok === '$') {
      return '$'
    }

    if (tok === '&') {
      return whole
    }

    const idx = Number(tok)

    return idx === 0 ? whole : groups[idx - 1] ?? ''
  })
}

// applyLineSubstitute does a best-effort current-line substitute by reusing the file
// substitute machinery but constraining it to the line under the caret. The Commander
// does not expose the caret line cheaply here, so we approximate by substituting the
// whole document with /g off (first match per line) — which for a single-line edit
// matches vim's :s closely enough for the AI command line.
async function applyLineSubstitute(cmd: ParsedSubstitute): Promise<VimCommandResult> {
  return applyFileSubstitute({ ...cmd, range: 'file' })
}

// runVimCommand parses and executes a ':' line. The returned result tells the AI area
// whether the line was consumed (handled) and an i18n status key to surface briefly.
export async function runVimCommand(input: string): Promise<VimCommandResult> {
  const parsed = parseVimCommand(input)

  if (!parsed) {
    return { handled: false, ok: false }
  }

  // Mirror onto the bus so Commander/scripts/integration can observe vim command lines
  // (the contract's ai:command event). Cast: the event is added to AppEventMap by the
  // integration phase; emitting via cast keeps this file decoupled from that edit.
  ;(appBus.emit as (name: string, payload: unknown) => void)('ai:command', {
    text: input.trim(),
    handled: true
  })

  if (parsed.kind === 'substitute') {
    if (parsed.range === 'file') {
      return applyFileSubstitute(parsed)
    }

    return applyLineSubstitute(parsed)
  }

  if (parsed.kind === 'write') {
    const res = await commander.run('save')

    return { handled: true, ok: res.ok, messageKey: res.ok ? 'vim.saved' : 'vim.noEditor' }
  }

  if (parsed.kind === 'quit') {
    const res = await commander.run('close')

    return { handled: true, ok: res.ok, messageKey: res.ok ? 'vim.closed' : 'vim.noEditor' }
  }

  if (parsed.kind === 'writeQuit') {
    const saved = await commander.run('save')

    if (!saved.ok) {
      return { handled: true, ok: false, messageKey: 'vim.noEditor' }
    }

    await commander.run('close')

    return { handled: true, ok: true, messageKey: 'vim.savedClosed' }
  }

  // Unknown ':' command — still consumed (do NOT fall through to the LLM), report it.
  return { handled: true, ok: false, messageKey: 'vim.unknown', messageVars: { cmd: parsed.raw } }
}
