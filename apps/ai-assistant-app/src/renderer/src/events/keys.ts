// Keyboard events for scripting. A global key listener turns every key press into app-bus
// events so user scripts (Lua, via `on`/`onKey`) can react to keys and chords with the
// ctrl / alt / shift / meta modifiers. See SCRIPTING.md and EVENTS.md.
//
// For each keydown we emit two events:
//   - 'key'            — every press, payload describes the key + modifiers + combo
//   - 'key:<combo>'    — the specific chord, e.g. 'key:ctrl+shift+s' (handy for on/onKey)
// and the same pair for keyup ('keyup' / 'keyup:<combo>').

import { appBus, type AppEventName, type KeyEvent } from './bus'

const MODS = ['ctrl', 'alt', 'shift', 'meta']

// normalizeKey maps a KeyboardEvent.key to our lowercase form (' ' → 'space').
function normalizeKey(key: string): string {
  if (key === ' ') {
    return 'space'
  }

  return key.toLowerCase()
}

// comboOf builds the canonical chord string: modifiers (ctrl, alt, shift, meta) then key.
function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []

  if (e.ctrlKey) {
    parts.push('ctrl')
  }

  if (e.altKey) {
    parts.push('alt')
  }

  if (e.shiftKey) {
    parts.push('shift')
  }

  if (e.metaKey) {
    parts.push('meta')
  }

  parts.push(normalizeKey(e.key))

  return parts.join('+')
}

// normCombo canonicalizes a user-written chord ("Ctrl+Shift+S", "shift + ctrl + s") to the
// same form comboOf produces, so onKey() subscriptions match regardless of order/casing.
export function normCombo(spec: string): string {
  const toks = spec
    .toLowerCase()
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
  const have = MODS.filter((m) => toks.includes(m))
  const keys = toks.filter((t) => !MODS.includes(t))

  return [...have, ...keys].join('+')
}

// Bound combos — chords registered via onKey() act as real keybindings: their default
// browser/editor action (e.g. Shift+Tab outdenting) is suppressed. Plain on('key:…')
// observers do NOT bind, so they never swallow the key.
const bound = new Set<string>()

// bindCombo marks a chord so its default action is prevented when pressed.
export function bindCombo(spec: string): void {
  bound.add(normCombo(spec))
}

// clearBoundCombos drops all bindings (called when the Lua runtime is reset).
export function clearBoundCombos(): void {
  bound.clear()
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null

  if (!el || !el.tagName) {
    return false
  }

  const tag = el.tagName.toLowerCase()

  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

function emitFor(type: 'key' | 'keyup', e: KeyboardEvent): void {
  // Skip lone modifier presses (Control/Shift/Alt/Meta) — they're noise; chords carry them.
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') {
    return
  }

  const combo = comboOf(e)

  // A bound chord (onKey) behaves like a shortcut: suppress its default action.
  if (type === 'key' && bound.has(combo)) {
    e.preventDefault()
  }

  const payload: KeyEvent = {
    key: normalizeKey(e.key),
    code: e.code,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    combo,
    repeat: e.repeat,
    editable: isEditable(e.target)
  }

  appBus.emit(type, payload)
  // The specific-chord event uses a dynamic name not in AppEventMap → emit with a cast.
  appBus.emit(`${type}:${combo}` as AppEventName, payload as never)
}

let installed = false

// installKeyEvents wires the global listeners once. Idempotent.
export function installKeyEvents(): void {
  if (installed || typeof window === 'undefined') {
    return
  }

  installed = true
  // Capture phase so a bound chord (onKey) can preventDefault before the editor/browser
  // acts on it (e.g. Shift+Tab, which would otherwise outdent or move focus).
  window.addEventListener('keydown', (e) => emitFor('key', e), true)
  window.addEventListener('keyup', (e) => emitFor('keyup', e), true)
}
