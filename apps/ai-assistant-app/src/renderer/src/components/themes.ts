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

// randomThemeName losuje nazwę konkretnego motywu z puli wskazanej sentinelem.
export function randomThemeName(which: string): string {
  const pool = which === RANDOM_LIGHT ? lightNames : darkNames

  return pool[Math.floor(Math.random() * pool.length)] ?? themeNames[0]
}

export function themeExt(name: string): Extension {
  return editorThemes[name] ?? oneDark
}
