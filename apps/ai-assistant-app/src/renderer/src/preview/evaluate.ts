import React from 'react'
import * as StyledNS from 'styled-components'
import * as MUI from '@mui/material'

// Live component preview — compile a component's TSX source in the browser and return
// the resulting React component. The component lives in the SCANNED project (outside this
// app's bundle), so we transpile with Babel and resolve its imports through a shim:
// known libs (React / MUI / styled-components) map to our bundled copies, everything else
// becomes a harmless stub. Good enough to render a component in isolation, not to run it.

// Babel standalone is ~3MB, so load it lazily — only when a preview is first opened.
let babelPromise: Promise<typeof import('@babel/standalone')> | null = null

function loadBabel(): Promise<typeof import('@babel/standalone')> {
  if (!babelPromise) {
    babelPromise = import('@babel/standalone')
  }

  return babelPromise
}

// universalStub works as both a (null-rendering) component and an arbitrary value:
// property access yields another stub, calls/new return empty. Covers unknown named
// imports used as components, enums, classes or constants without crashing.
function universalStub(): unknown {
  const fn = (): null => null

  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === '__esModule') return true

      if (prop === 'default') return fn

      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === Symbol.toStringTag) {
        return () => ''
      }

      return universalStub()
    },
    apply: () => null,
    construct: () => ({})
  })
}

// Placeholder — visible box standing in for a nested component imported from a sibling
// file (we don't resolve relative imports, so we show its name instead).
function placeholder(label: string): React.ComponentType {
  const P = (): React.ReactElement =>
    React.createElement(
      'div',
      {
        style: {
          padding: '8px 12px',
          border: '1px dashed #8b949e',
          borderRadius: 6,
          color: '#8b949e',
          font: '12px monospace',
          display: 'inline-block'
        }
      },
      `<${label} />`
    )

  P.displayName = label

  return P
}

// iconStub — generic stand-in for any @mui/icons-material icon.
const iconStub = (): React.ReactElement =>
  React.createElement('span', { style: { font: '14px monospace' } }, '▢')

function stubModule(defaultExport: unknown): Record<string | symbol, unknown> {
  return new Proxy(
    { __esModule: true, default: defaultExport },
    {
      get: (target, prop) => (prop in target ? (target as Record<symbol | string, unknown>)[prop] : universalStub())
    }
  )
}

// require shim — maps a module specifier to a runtime value for the evaluated module.
function shimRequire(name: string): unknown {
  if (name === 'react') {
    return React
  }

  if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') {
    return React
  }

  if (name === 'styled-components' || name.startsWith('@emotion/styled')) {
    return StyledNS
  }

  if (name === '@mui/material' || name.startsWith('@mui/material/')) {
    return MUI
  }

  if (name.startsWith('@mui/icons-material')) {
    return stubModule(iconStub)
  }

  if (/\.(css|scss|sass|less)$/.test(name)) {
    return {}
  }

  // relative import → a named placeholder for whatever it exports (likely a component)
  if (name.startsWith('.') || name.startsWith('/')) {
    const base = (name.split('/').pop() || name).replace(/\.[^.]+$/, '')

    return stubModule(placeholder(base))
  }

  // unknown bare package (reactflow, etc.) → universal stub
  return stubModule(universalStub())
}

// compileComponent transpiles the source and evaluates it into a React component.
export async function compileComponent(source: string, path: string): Promise<React.ComponentType<Record<string, unknown>>> {
  const Babel = await loadBabel()

  const filename = /\.(t|j)sx?$/.test(path) ? path : path + '.tsx'
  const out = Babel.transform(source, {
    filename,
    presets: [
      ['react', { runtime: 'classic' }],
      ['typescript', { isTSX: true, allExtensions: true, onlyRemoveTypeImports: false }]
    ],
    plugins: ['transform-modules-commonjs'],
    sourceType: 'module'
  })

  const code = out.code

  if (!code) {
    throw new Error('Babel returned no code')
  }

  const module = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('require', 'module', 'exports', 'React', code)
  factory(shimRequire, module, module.exports, React)

  const picked = module.exports.default ?? Object.values(module.exports).find((v) => typeof v === 'function')

  if (typeof picked !== 'function') {
    throw new Error('No component (default export) found in this file')
  }

  return picked as React.ComponentType<Record<string, unknown>>
}
