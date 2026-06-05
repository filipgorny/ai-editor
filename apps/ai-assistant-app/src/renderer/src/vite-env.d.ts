/// <reference types="vite/client" />

// Vite asset imports — `import url from 'foo.wasm?url'` yields the emitted asset URL.
// (Pure ambient declaration: no top-level import/export, so it registers globally.)
declare module '*?url' {
  const src: string
  export default src
}
