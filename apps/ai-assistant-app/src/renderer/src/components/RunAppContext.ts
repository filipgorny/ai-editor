import { createContext, useContext } from 'react'
import type { Node } from '../model'

// RunApp — the code-diagram's "run this React app" action. GraphView provides it (it knows the
// project root needed to resolve the app's directory) and the app NodeCard consumes it to render
// the Run button. runningId is the id of the app node currently starting, so the card that
// triggered the run can show a spinner.
export type RunApp = {
  runningId: string
  run: (node: Node) => void
}

export const RunAppContext = createContext<RunApp>({ runningId: '', run: () => undefined })

export const useRunApp = (): RunApp => useContext(RunAppContext)
