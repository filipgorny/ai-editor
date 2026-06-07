// Visual catalog for languages and frameworks shown on graph nodes: a short icon/badge text
// plus a brand-ish colour. Keyed by the strings the scanner's classifiers emit (language and
// framework). Extend by adding an entry — the NodeCard reads this map, nothing else changes.

export type TechVisual = { icon: string; color: string }

export const techVisual: Record<string, TechVisual> = {
  // — languages —
  typescript: { icon: 'TS', color: '#3178c6' },
  javascript: { icon: 'JS', color: '#f1e05a' },
  go: { icon: 'Go', color: '#00add8' },
  python: { icon: 'Py', color: '#3776ab' },
  java: { icon: '☕', color: '#e76f00' },
  kotlin: { icon: 'Kt', color: '#7f52ff' },
  rust: { icon: 'Rs', color: '#dea584' },
  csharp: { icon: 'C#', color: '#178600' },
  php: { icon: 'PHP', color: '#777bb4' },
  ruby: { icon: '💎', color: '#cc342d' },
  elixir: { icon: 'Ex', color: '#6e4a7e' },
  dart: { icon: 'Dt', color: '#00b4ab' },
  swift: { icon: 'Sw', color: '#fa7343' },
  scala: { icon: 'Sc', color: '#dc322f' },
  cpp: { icon: 'C++', color: '#00599c' },
  c: { icon: 'C', color: '#a8b9cc' },

  // — frameworks —
  nestjs: { icon: '🪺', color: '#e0234e' },
  nextjs: { icon: 'N', color: '#c9d1d9' },
  angular: { icon: 'Ng', color: '#dd0031' },
  react: { icon: '⚛️', color: '#61dafb' },
  vue: { icon: 'V', color: '#42b883' },
  svelte: { icon: 'Sv', color: '#ff3e00' },
  express: { icon: 'Ex', color: '#c9d1d9' },
  fastify: { icon: 'Fy', color: '#c9d1d9' },
  koa: { icon: 'Koa', color: '#c9d1d9' },
  electron: { icon: '⚛', color: '#47848f' },
  'react-native': { icon: '⚛️', color: '#61dafb' },
  'spring-boot': { icon: '🍃', color: '#6db33f' },
  django: { icon: 'Dj', color: '#44b78b' },
  flask: { icon: 'Fl', color: '#c9d1d9' },
  fastapi: { icon: 'FA', color: '#009688' },
  rails: { icon: '💎', color: '#cc0000' },
  laravel: { icon: 'Lv', color: '#ff2d20' },
  symfony: { icon: 'Sf', color: '#c9d1d9' }
}

// techOf resolves a language/framework name to its visual, or undefined when unknown.
export function techOf(name: string | undefined): TechVisual | undefined {
  return name ? techVisual[name] : undefined
}
