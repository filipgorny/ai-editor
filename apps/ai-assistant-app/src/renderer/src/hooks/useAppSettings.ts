import { useEffect, useRef, useState } from 'react'
import { appBus } from '../events'
import { accentBy } from '../styles/accents'
import type { BlameMode } from '../components/GitContext'

export function useAppSettings(onNeedClaudeLogin: () => void) {
  // globalne ustawienia edytorów (wspólne dla wszystkich okien)
  const [vimOn, setVimOn] = useState(true)
  const [copilotOn, setCopilotOn] = useState(true)
  const [rainbow, setRainbow] = useState(true) // kolorowanie par nawiasów w edytorze
  // each function/class gets its own stable color in the editor (perSymbolColor extension)
  const [eachFnColor, setEachFnColor] = useState(false)
  const [editorTheme, setEditorTheme] = useState('Czarny (domyślny)')
  const [wallpaper, setWallpaper] = useState('') // graph background image url
  const [accent, setAccent] = useState('blue') // app accent (button colour) theme
  // git: tryb autorstwa na klockach (off/last)
  const [gitBlame, setGitBlame] = useState<BlameMode>('off')

  // Load persisted visual settings (accent / editor theme / wallpaper) on startup.
  // settingsLoaded guards the persist effects below so they don't clobber the store
  // with defaults before the load completes.
  const settingsLoaded = useRef(false)

  useEffect(() => {
    let cancelled = false

    window.api.getSettings().then(async (s) => {
      if (s?.appTheme) {
        setAccent(s.appTheme)
      }

      if (s?.editorTheme) {
        setEditorTheme(s.editorTheme)
      }

      if (s?.wallpaper !== undefined) {
        setWallpaper(s.wallpaper)
      }

      if (s?.rainbowBrackets !== undefined) {
        setRainbow(s.rainbowBrackets)
      }

      if (s?.gitBlame === 'off' || s?.gitBlame === 'last') {
        setGitBlame(s.gitBlame)
      }

      if (s?.vim !== undefined) {
        setVimOn(s.vim)
      }

      if (s?.copilot !== undefined) {
        setCopilotOn(s.copilot)
      }

      if (s?.eachFnColor !== undefined) {
        setEachFnColor(s.eachFnColor)
      }

      settingsLoaded.current = true

      // Apply the saved LLM provider to the ai service on startup — otherwise it always
      // starts on the config default (ollama), ignoring a "Claude" selection until the user
      // re-saves Settings. Retried a few times to ride out the backend coming up.
      const provider = s?.provider

      if (provider) {
        for (let i = 0; i < 5 && !cancelled; i++) {
          try {
            await window.api.aiSetProvider(provider)
            break
          } catch {
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
      }

      // Claude headless needs an OAuth token on the server — prompt for one if it's missing.
      if (provider === 'claude' && !cancelled) {
        const hasToken = await window.api.claudeTokenStatus().catch(() => false)

        if (!hasToken && !cancelled) {
          onNeedClaudeLogin()
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Re-check Claude login whenever the user switches the provider to Claude in Settings.
  useEffect(() => {
    return appBus.on('settings:provider-change', async ({ provider }) => {
      if (provider !== 'claude') {
        return
      }

      const hasToken = await window.api.claudeTokenStatus().catch(() => false)

      if (!hasToken) {
        onNeedClaudeLogin()
      }
    })
  }, [])

  // Persist each visual setting when it changes (merged server-side).
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentBy(accent).color)

    if (settingsLoaded.current) {
      window.api.setSettings({ appTheme: accent })
    }
  }, [accent])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ editorTheme })
    }
  }, [editorTheme])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ wallpaper })
    }
  }, [wallpaper])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ rainbowBrackets: rainbow })
    }
  }, [rainbow])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ vim: vimOn })
    }
  }, [vimOn])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ copilot: copilotOn })
    }
  }, [copilotOn])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ eachFnColor })
    }
  }, [eachFnColor])

  useEffect(() => {
    if (settingsLoaded.current) {
      window.api.setSettings({ gitBlame })
    }
  }, [gitBlame])

  return {
    vimOn,
    setVimOn,
    copilotOn,
    setCopilotOn,
    rainbow,
    setRainbow,
    eachFnColor,
    setEachFnColor,
    editorTheme,
    setEditorTheme,
    wallpaper,
    setWallpaper,
    accent,
    setAccent,
    gitBlame,
    setGitBlame,
    settingsLoaded
  }
}
