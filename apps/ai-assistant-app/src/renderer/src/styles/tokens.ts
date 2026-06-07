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
  function: '#ffa657',
  model: '#db61a2'
}

// Kolor węzła aplikacji zależny od frameworka — by serwisy Go, modele Protobuf
// i fronty React były od razu rozróżnialne na grafie (fallback: kolor 'app').
export const frameworkColor: Record<string, string> = {
  react: '#61dafb',
  nestjs: '#e0234e',
  vite: '#646cff',
  typescript: '#3178c6',
  go: '#00add8',
  protobuf: '#db61a2'
}
