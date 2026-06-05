// App accent themes — the primary colour used for buttons and highlights. Each has
// per-language labels (UI is PL/EN). `color` becomes the MUI primary + the --accent
// CSS variable; `contrast` overrides button text where the accent is light (white).
export type Accent = {
  key: string
  en: string
  pl: string
  color: string
  contrast?: string
}

export const accents: Accent[] = [
  { key: 'blue', en: 'Blue (default)', pl: 'Niebieski (domyślny)', color: '#58a6ff' },
  { key: 'red', en: 'Red', pl: 'Czerwony', color: '#f85149' },
  { key: 'orange', en: 'Orange', pl: 'Pomarańczowy', color: '#f0883e' },
  { key: 'green', en: 'Green', pl: 'Zielony', color: '#3fb950' },
  { key: 'purple', en: 'Purple', pl: 'Fioletowy', color: '#bc8cff' },
  { key: 'white', en: 'White', pl: 'Biały', color: '#e6edf3', contrast: '#0d1117' }
]

export function accentBy(key: string): Accent {
  return accents.find((a) => a.key === key) ?? accents[0]
}
