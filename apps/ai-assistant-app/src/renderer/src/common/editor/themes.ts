import {
  dracula,
  monokai,
  nord,
  material,
  atomone,
  aura,
  darcula,
  sublime,
  androidstudio,
  githubDark,
  githubLight,
  solarizedDark,
  solarizedLight,
  tokyoNight,
  tokyoNightStorm,
  vscodeDark,
  vscodeLight,
  gruvboxDark,
  gruvboxLight,
  okaidia,
  abcdef,
  abyss,
  xcodeDark,
  xcodeLight,
  andromeda,
  basicDark,
  basicLight,
  bbedit,
  bespin,
  consoleDark,
  consoleLight,
  copilot,
  duotoneDark,
  duotoneLight,
  eclipse,
  kimbie,
  materialDark,
  materialLight,
  monokaiDimmed,
  noctisLilac,
  quietlight,
  red,
  tokyoNightDay,
  tomorrowNightBlue,
  whiteDark,
  whiteLight
} from '@uiw/codemirror-themes-all'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'

// Default look (as before): One Dark colors + forced black background. The bg is
// painted on the scroller/editor (NOT .cm-content) so the column-80 ruler line,
// inserted behind the content, stays visible under the text and ghost bubbles.
const blackBg = EditorView.theme({
  '&': { backgroundColor: '#000' },
  '.cm-editor': { backgroundColor: '#000' },
  '.cm-scroller': { backgroundColor: '#000' },
  '.cm-gutters': { backgroundColor: '#000' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.06)' },
  '.cm-activeLineGutter': { backgroundColor: '#000' }
})

// Rejestr motywów edytora (CodeMirror). Klucz = nazwa w Ustawieniach.
export const editorThemes: Record<string, Extension> = {
  'Czarny (domyślny)': [oneDark, blackBg],
  'One Dark': oneDark,
  Dracula: dracula,
  Monokai: monokai,
  Nord: nord,
  Material: material,
  'Atom One': atomone,
  Aura: aura,
  Darcula: darcula,
  Sublime: sublime,
  'Android Studio': androidstudio,
  'GitHub Dark': githubDark,
  'GitHub Light': githubLight,
  'Solarized Dark': solarizedDark,
  'Solarized Light': solarizedLight,
  'Tokyo Night': tokyoNight,
  'Tokyo Night Storm': tokyoNightStorm,
  'VS Code Dark': vscodeDark,
  'VS Code Light': vscodeLight,
  'Gruvbox Dark': gruvboxDark,
  'Gruvbox Light': gruvboxLight,
  Okaidia: okaidia,
  'abcdef': abcdef,
  Abyss: abyss,
  'Xcode Dark': xcodeDark,
  'Xcode Light': xcodeLight,
  // More themes (v0.3) — pulled from @uiw/codemirror-themes-all so users have a wider pool.
  Andromeda: andromeda,
  'Basic Dark': basicDark,
  'Basic Light': basicLight,
  BBEdit: bbedit,
  Bespin: bespin,
  'Console Dark': consoleDark,
  'Console Light': consoleLight,
  Copilot: copilot,
  'Duotone Dark': duotoneDark,
  'Duotone Light': duotoneLight,
  Eclipse: eclipse,
  Kimbie: kimbie,
  'Material Dark': materialDark,
  'Material Light': materialLight,
  'Monokai Dimmed': monokaiDimmed,
  'Noctis Lilac': noctisLilac,
  Quietlight: quietlight,
  Red: red,
  'Tokyo Night Day': tokyoNightDay,
  'Tomorrow Night Blue': tomorrowNightBlue,
  'White Dark': whiteDark,
  'White Light': whiteLight
}

export const themeNames = Object.keys(editorThemes)

// Motywy jasne (reszta puli to ciemne). Używane do losowania w trybach „różne".
const LIGHT_THEMES = [
  'GitHub Light',
  'Solarized Light',
  'VS Code Light',
  'Gruvbox Light',
  'Xcode Light',
  'Basic Light',
  'Console Light',
  'Duotone Light',
  'Eclipse',
  'Material Light',
  'Noctis Lilac',
  'Quietlight',
  'Tokyo Night Day',
  'White Light',
  'BBEdit'
]
const lightNames = themeNames.filter((n) => LIGHT_THEMES.includes(n))
const darkNames = themeNames.filter((n) => !LIGHT_THEMES.includes(n))

// RANDOM_DARK / RANDOM_LIGHT — specjalne „opcje wyróżnione" w Ustawieniach: zamiast jednego
// motywu, każdy nowo otwarty plik dostaje losowy motyw z odpowiedniej puli (ciemne / jasne).
export const RANDOM_DARK = '🎲 dark:random'
export const RANDOM_LIGHT = '🎲 light:random'

export function isRandomTheme(name: string): boolean {
  return name === RANDOM_DARK || name === RANDOM_LIGHT
}

// randomThemeName picks a concrete theme at random from the pool named by the sentinel.
export function randomThemeName(which: string): string {
  const pool = which === RANDOM_LIGHT ? lightNames : darkNames

  return pool[Math.floor(Math.random() * pool.length)] ?? themeNames[0]
}

// hashString — deterministic 32-bit FNV-1a hash of a string. Same input → same number, so we
// can derive a stable per-file theme without persisting anything.
function hashString(s: string): number {
  let h = 0x811c9dc5

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }

  return h >>> 0
}

// hashThemeName picks a theme from the random pool DETERMINISTICALLY from a key (e.g. the
// file / class / function name). Reopening the same file yields the same theme — a stable
// alternative to randomThemeName for the "🎲 random" modes.
export function hashThemeName(key: string, which: string): string {
  const pool = which === RANDOM_LIGHT ? lightNames : darkNames

  if (pool.length === 0) {
    return themeNames[0]
  }

  return pool[hashString(key) % pool.length]
}

export function themeExt(name: string): Extension {
  return editorThemes[name] ?? oneDark
}

// AUTOGEN_DARK / AUTOGEN_LIGHT — special "featured options" like the random ones, but instead
// of picking from the preset pool they SYNTHESIZE a full colour scheme per file: the base hue
// comes from the package / folder (so files in the same package share a colour family) and the
// file (class/function) name varies the hue + accent spacing. Same file → same generated theme.
export const AUTOGEN_DARK = '🧬 dark:autogen'
export const AUTOGEN_LIGHT = '🧬 light:autogen'

export function isAutogenTheme(name: string): boolean {
  return name === AUTOGEN_DARK || name === AUTOGEN_LIGHT
}

// Generated themes are pure functions of (variant, package, file), so we cache them — both to
// avoid rebuilding on every render and to keep a STABLE Extension identity (otherwise CodeMirror
// would reconfigure the editor each time and steal focus).
const generatedCache = new Map<string, Extension>()

// buildAutogenTheme synthesizes a CodeMirror theme from a deterministic seed.
function buildAutogenTheme(fileKey: string, pkgKey: string, variant: 'dark' | 'light'): Extension {
  const baseHue = hashString(pkgKey || fileKey) % 360
  const fileHash = hashString(fileKey)
  const hue = (baseHue + ((fileHash % 40) - 20) + 360) % 360
  const spin = 24 + ((fileHash >> 8) % 56) // distance between successive accent hues (24..79)
  const rot = (deg: number): number => Math.round((hue + deg) % 360)

  // Per-variant lightness/saturation knobs: dark = deep bg + bright tokens, light = pale bg +
  // deep tokens. hsl() strings are valid CSS colours, so createTheme accepts them directly.
  const dark = variant === 'dark'
  const bgL = dark ? 8 : 97
  const fgL = dark ? 85 : 22
  const tokL = dark ? 72 : 38
  const tokS = dark ? 68 : 62
  const hsl = (h: number, s: number, l: number): string => `hsl(${h}, ${s}%, ${l}%)`
  const acc = (i: number, s = tokS, l = tokL): string => hsl(rot(i * spin), s, l)

  const ext = createTheme({
    theme: variant,
    settings: {
      background: hsl(hue, dark ? 22 : 30, bgL),
      foreground: hsl(hue, 14, fgL),
      caret: hsl(rot(180), 90, dark ? 70 : 45),
      selection: `hsla(${rot(120)}, 60%, ${dark ? 45 : 70}%, 0.35)`,
      selectionMatch: `hsla(${rot(120)}, 60%, ${dark ? 45 : 70}%, 0.25)`,
      lineHighlight: `hsla(${hue}, 60%, ${dark ? 60 : 40}%, 0.08)`,
      gutterBackground: hsl(hue, dark ? 22 : 30, bgL),
      gutterForeground: hsl(hue, 10, dark ? 42 : 58),
      gutterActiveForeground: hsl(hue, 14, dark ? 75 : 30)
    },
    styles: [
      { tag: t.comment, color: hsl(hue, 12, dark ? 45 : 55), fontStyle: 'italic' },
      { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: acc(1) },
      { tag: [t.string, t.special(t.string), t.regexp], color: acc(2, tokS - 8) },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: acc(3) },
      { tag: [t.number, t.bool, t.null, t.atom], color: acc(4) },
      { tag: [t.typeName, t.className, t.namespace, t.tagName], color: acc(5) },
      { tag: [t.propertyName, t.attributeName], color: acc(6, tokS - 10) },
      { tag: [t.definition(t.variableName), t.variableName], color: hsl(hue, 16, dark ? 82 : 28) },
      { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: hsl(hue, 12, dark ? 60 : 45) },
      { tag: [t.heading, t.strong], color: acc(3, tokS, dark ? 78 : 32), fontWeight: 'bold' },
      { tag: [t.link, t.url], color: acc(2), textDecoration: 'underline' }
    ]
  })

  return ext
}

// generateTheme returns the cached synthesized theme for a seed (file/class/function name + its
// package/folder name) and the chosen autogen sentinel.
export function generateTheme(fileKey: string, pkgKey: string, which: string): Extension {
  const variant: 'dark' | 'light' = which === AUTOGEN_LIGHT ? 'light' : 'dark'
  const cacheKey = `${variant}|${pkgKey}|${fileKey}`
  const hit = generatedCache.get(cacheKey)

  if (hit) {
    return hit
  }

  const ext = buildAutogenTheme(fileKey, pkgKey, variant)
  generatedCache.set(cacheKey, ext)

  return ext
}

// resolveEditorTheme is the single entry point CodeEditor uses to turn the theme SETTING into an
// actual extension, seeded by the file's name and package/folder: autogen → synthesized theme,
// random → deterministic pick from the preset pool, otherwise the named preset.
export function resolveEditorTheme(setting: string, fileKey: string, pkgKey: string): Extension {
  if (isAutogenTheme(setting)) {
    return generateTheme(fileKey, pkgKey, setting)
  }

  if (isRandomTheme(setting)) {
    return themeExt(hashThemeName(fileKey, setting))
  }

  return themeExt(setting)
}
