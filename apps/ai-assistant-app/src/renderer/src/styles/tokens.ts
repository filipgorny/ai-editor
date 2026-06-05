// Tokeny kolorów współdzielone przez styled-components (TS). Lustrzane wartości
// trzymane też w styles/_variables.scss dla stylów globalnych.
export const colors = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#21262d',
  muted: '#8b949e',
  danger: '#f85149',
  module: '#bc8cff',
  controller: '#58a6ff',
  service: '#3fb950'
}

// Każdy rozpoznany rodzaj bytu ma swój charakterystyczny kolor.
export const kindColor: Record<string, string> = {
  folder: '#f2cc60',
  app: '#39c5cf',
  module: '#bc8cff',
  controller: '#58a6ff',
  service: '#3fb950',
  component: '#61dafb',
  class: '#f85149',
  function: '#ffa657'
}
