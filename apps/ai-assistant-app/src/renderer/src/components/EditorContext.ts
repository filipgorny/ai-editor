import { createContext, useContext } from 'react'

// openFile otwiera edytor pliku; opcjonalnie przewija do podanej funkcji.
export type OpenFile = (absFile: string, fn?: string) => void

export const EditorContext = createContext<OpenFile>(() => {})

export const useEditor = (): OpenFile => useContext(EditorContext)
