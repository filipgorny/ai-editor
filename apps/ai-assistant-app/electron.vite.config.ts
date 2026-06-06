import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        // @codemirror/language is a declared dependency (peer of the already-installed
        // @codemirror/lang-javascript) used by the perSymbolColor editor extension. Until a
        // `pnpm install` hoists it as a direct dep, point the bundler at the copy that already
        // exists in the pnpm store so the build resolves it. After install this alias is a
        // harmless no-op (it resolves to the same package).
        '@codemirror/language': resolve(
          '../../node_modules/.pnpm/@codemirror+language@6.12.3/node_modules/@codemirror/language'
        )
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // Heavy/optional deps that views lazy-import inside try/catch (TerminalView,
        // BrowserView). They are declared in package.json but may be absent until
        // `pnpm install`; externalizing keeps the production build from hard-failing
        // when they're not present, while the runtime guards degrade gracefully.
        external: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/xterm/css/xterm.css']
      }
    }
  }
})
