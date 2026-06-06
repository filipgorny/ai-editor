import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { appBus } from '../events'
import { type EditorTarget, EDITOR_FADE_MS } from '../components/CodeEditor'
import type { ViewKey } from '../views/types'

// EditorScope — which view's INDEPENDENT editor workspace a set of open files belongs to.
// The editor view and the code-diagram view each keep their own open files / tabs / window
// layout (two separate workspaces); switching between them shows that view's own list.
export type EditorScope = 'editor' | 'diagram'

// EditorWorkspace — one view's full editor-window state: open files, the active one,
// minimized/closing/top-snapped sets, and per-file window geometry. Geometry fields are
// optional because cursor/scroll can be recorded before the window settles its position.
export type EditorGeom = {
  x?: number
  y?: number
  w?: number
  h?: number
  snapped?: boolean
  fullscreen?: boolean
  // cursor — CodeMirror document offset of the caret; scroll — scrollTop of the editor.
  cursor?: number
  scroll?: number
}

export type EditorWorkspace = {
  editors: EditorTarget[]
  activeEditor: string
  minimized: Set<string>
  closingEditors: Set<string>
  snappedTop: Set<string>
  layoutByPath: Record<string, EditorGeom>
}

// emptyWorkspace builds a fresh, empty editor workspace.
export function emptyWorkspace(): EditorWorkspace {
  return {
    editors: [],
    activeEditor: '',
    minimized: new Set(),
    closingEditors: new Set(),
    snappedTop: new Set(),
    layoutByPath: {}
  }
}

// scopeForView maps the active view onto its editor workspace scope. Only the editor and
// diagram views host editors; any other view falls back to the editor scope (its windows
// are hidden there anyway), so handlers always have a valid target.
export function scopeForView(view: ViewKey): EditorScope {
  return view === 'diagram' ? 'diagram' : 'editor'
}

export function useEditors(activeView: ViewKey, folder: string) {
  // Per-view editor workspaces: the editor view and the code-diagram view each keep their
  // OWN independent open-files / tabs / window layout. The active scope (derived from the
  // active view) selects which workspace the editor handlers and the UI read & mutate.
  // Window geometry inside each workspace is persisted per project (SQLite in main).
  const [workspaces, setWorkspaces] = useState<Record<EditorScope, EditorWorkspace>>(() => ({
    editor: emptyWorkspace(),
    diagram: emptyWorkspace()
  }))
  // czy układ edytorów dla bieżącego folderu został już odtworzony (bramkuje zapis,
  // by świeżo wczytany stan nie został nadpisany pustym przy montażu).
  const restoredFolder = useRef('')
  // ostatnio otwarty folder (kontekst dla agenta — domyślny katalog nowych plików)
  const lastDir = useRef('')

  // editorScope — the editor workspace the active view owns. ws — its live slice. Editor
  // handlers read ws and mutate via patchWorkspace(scope, …) so the editor and diagram
  // views never share open files. scopeRef keeps the latest scope for handlers that mutate
  // outside render (e.g. timeouts) without re-binding.
  const editorScope = scopeForView(activeView)
  const ws = workspaces[editorScope]
  const scopeRef = useRef<EditorScope>(editorScope)
  scopeRef.current = editorScope

  // allEditors — UNION of open files across EVERY workspace, tagged with their owning scope,
  // so a persistent tab strip can list every open file regardless of the active view. Deduped
  // by path: the 'editor' scope wins so its window is the one a duplicate tab activates.
  const allEditors = useMemo<{ path: string; scope: EditorScope }[]>(() => {
    const seen = new Set<string>()
    const out: { path: string; scope: EditorScope }[] = []

    for (const scope of ['editor', 'diagram'] as EditorScope[]) {
      for (const e of workspaces[scope].editors) {
        if (seen.has(e.path)) {
          continue
        }

        seen.add(e.path)
        out.push({ path: e.path, scope })
      }
    }

    return out
  }, [workspaces])

  // patchWorkspace applies a partial update to one scope's workspace immutably.
  const patchWorkspace = useCallback(
    (scope: EditorScope, patch: Partial<EditorWorkspace> | ((w: EditorWorkspace) => Partial<EditorWorkspace>)): void => {
      setWorkspaces((prev) => {
        const cur = prev[scope]
        const next = typeof patch === 'function' ? patch(cur) : patch

        return { ...prev, [scope]: { ...cur, ...next } }
      })
    },
    []
  )

  // openFile otwiera (lub aktywuje) okno edytora; można mieć kilka naraz.
  // animate=true → zawartość „wpisuje się" na żywo (gdy plik otwiera agent).
  const openFile = (absFile: string, fn?: string, animate = false, gotoLine?: number) => {
    lastDir.current = absFile.replace(/[\\/][^\\/]+$/, '') // zapamiętaj folder
    appBus.emit('editor:open', { path: absFile })

    patchWorkspace(scopeRef.current, (w) => {
      const editors = w.editors.some((e) => e.path === absFile)
        ? w.editors.map((e) => (e.path === absFile ? { path: absFile, gotoFn: fn, gotoLine, animate } : e))
        : [...w.editors, { path: absFile, gotoFn: fn, gotoLine, animate }]

      const minimized = new Set(w.minimized)
      minimized.delete(absFile)

      return { editors, activeEditor: absFile, minimized }
    })
  }

  const closeEditor = (path: string) => {
    appBus.emit('editor:close', { path })

    patchWorkspace(scopeRef.current, (w) => {
      const minimized = new Set(w.minimized)
      minimized.delete(path)

      const snappedTop = new Set(w.snappedTop)
      snappedTop.delete(path)

      return { editors: w.editors.filter((e) => e.path !== path), minimized, snappedTop }
    })
  }

  // setEditorSnap records whether an editor window is snapped to the top (graph area), so
  // that opening another file while one is snapped opens the new window snapped too.
  const setEditorSnap = (path: string, snapped: boolean): void => {
    patchWorkspace(scopeRef.current, (w) => {
      if (snapped === w.snappedTop.has(path)) {
        return {}
      }

      const snappedTop = new Set(w.snappedTop)

      if (snapped) {
        snappedTop.add(path)
      } else {
        snappedTop.delete(path)
      }

      return { snappedTop }
    })
  }

  // onEditorGeometry zapamiętuje geometrię okna danego pliku (zgłaszaną przez CodeEditor).
  // MERGE z istniejącym wpisem, by nie zgubić zapisanej pozycji kursora/scrolla.
  const onEditorGeometry = (path: string, g: EditorGeom): void => {
    patchWorkspace(scopeRef.current, (w) => {
      const c = w.layoutByPath[path]

      if (c && c.x === g.x && c.y === g.y && c.w === g.w && c.h === g.h && c.snapped === g.snapped && c.fullscreen === g.fullscreen) {
        return {}
      }

      return { layoutByPath: { ...w.layoutByPath, [path]: { ...c, ...g } } }
    })
  }

  // onEditorCursor zapamiętuje pozycję kursora i scroll w pliku (zgłaszane przez CodeEditor),
  // dokładając je do wpisu geometrii (bez ruszania pozycji/rozmiaru okna).
  const onEditorCursor = (path: string, cursor: number, scroll: number): void => {
    patchWorkspace(scopeRef.current, (w) => {
      const c = w.layoutByPath[path]

      if (c && c.cursor === cursor && c.scroll === scroll) {
        return {}
      }

      return { layoutByPath: { ...w.layoutByPath, [path]: { ...c, cursor, scroll } } }
    })
  }

  // Po otwarciu projektu ODTWÓRZ zapamiętany układ okien edytorów (SQLite per folder):
  // te same pliki, w tych samych miejscach/rozmiarach, zesnapowane/zminimalizowane jak były.
  useEffect(() => {
    restoredFolder.current = ''

    // Guard a stale preload (dev): the editor-layout API only exists after a full
    // `pnpm dev` restart, so skip cleanly instead of crashing the renderer.
    if (!folder || typeof window.api.getEditorLayout !== 'function') {
      restoredFolder.current = folder
      return
    }

    let cancelled = false

    window.api
      .getEditorLayout(folder)
      .then((data) => {
        if (cancelled) {
          return
        }

        const wins = data?.editors ?? []
        const geom: Record<string, EditorGeom> = {}

        for (const w of wins) {
          const { path, ...rest } = w

          if (Object.keys(rest).length > 0) {
            geom[path] = rest as EditorGeom
          }
        }

        // Restore the persisted layout into the editor workspace; the diagram workspace
        // starts empty (its open files are a session-only, independent list).
        setWorkspaces({
          editor: {
            editors: wins.map((w) => ({ path: w.path })),
            activeEditor: data?.active ?? '',
            minimized: new Set(data?.minimized ?? []),
            closingEditors: new Set(),
            snappedTop: new Set(data?.snapped ?? []),
            layoutByPath: geom
          },
          diagram: emptyWorkspace()
        })
        restoredFolder.current = folder
      })
      .catch(() => {
        restoredFolder.current = folder
      })

    return () => {
      cancelled = true
    }
  }, [folder])

  // Zapisz układ okien edytorów dla bieżącego projektu (odroczony zapis do SQLite).
  // Bramkowane przez restoredFolder, by nie nadpisać świeżo wczytanego stanu pustym.
  useEffect(() => {
    if (!folder || restoredFolder.current !== folder || typeof window.api.saveEditorLayout !== 'function') {
      return
    }

    const id = window.setTimeout(() => {
      // Persist only the editor workspace (the diagram workspace's open files are
      // session-only); both lists stay independent in-session.
      const e0 = workspaces.editor
      const data: EditorLayout = {
        editors: e0.editors.map((e) => {
          const g = e0.layoutByPath[e.path]

          return g ? { path: e.path, ...g } : { path: e.path }
        }),
        active: e0.activeEditor,
        minimized: [...e0.minimized],
        snapped: [...e0.snappedTop]
      }

      window.api.saveEditorLayout(folder, data)
    }, 500)

    return () => window.clearTimeout(id)
  }, [folder, workspaces])

  // closeEditorAnimated fades the window out (opacity 1→0) before removing it.
  const closeEditorAnimated = (path: string) => {
    // Capture the scope now so the deferred removal targets the same workspace even if the
    // active view changes during the fade.
    const scope = scopeRef.current

    patchWorkspace(scope, (w) => ({ closingEditors: new Set(w.closingEditors).add(path) }))

    window.setTimeout(() => {
      patchWorkspace(scope, (w) => {
        const minimized = new Set(w.minimized)
        minimized.delete(path)

        const snappedTop = new Set(w.snappedTop)
        snappedTop.delete(path)

        const closingEditors = new Set(w.closingEditors)
        closingEditors.delete(path)

        return { editors: w.editors.filter((e) => e.path !== path), minimized, snappedTop, closingEditors }
      })

      appBus.emit('editor:close', { path })
    }, EDITOR_FADE_MS)
  }

  // Klik w zakładkę: przywróć (jeśli zminimalizowane) i uaktywnij.
  const selectEditor = (path: string) => {
    appBus.emit('editor:activate', { path })

    patchWorkspace(scopeRef.current, (w) => {
      const minimized = new Set(w.minimized)
      minimized.delete(path)

      return { minimized, activeEditor: path }
    })
  }

  const minimizeEditor = (path: string) => {
    appBus.emit('editor:minimize', { path })

    patchWorkspace(scopeRef.current, (w) => ({ minimized: new Set(w.minimized).add(path) }))
  }

  // cycleEditor switches the active editor window to the prev/next OPEN one (ALT+arrows
  // and, in the editor view, the mouse back/forward buttons).
  const cycleEditor = useCallback(
    (dir: 'prev' | 'next'): void => {
      const scope = scopeRef.current

      setWorkspaces((prev) => {
        const w = prev[scope]
        const list = w.editors

        if (list.length === 0) {
          return prev
        }

        const i = list.findIndex((e) => e.path === w.activeEditor)
        const base = i < 0 ? 0 : i
        const step = dir === 'next' ? 1 : -1
        const next = list[(base + step + list.length) % list.length]

        if (!next) {
          return prev
        }

        appBus.emit('editor:activate', { path: next.path })
        const minimized = new Set(w.minimized)
        minimized.delete(next.path)

        return { ...prev, [scope]: { ...w, minimized, activeEditor: next.path } }
      })
    },
    [] // setWorkspaces is stable
  )

  return {
    ws,
    workspaces,
    allEditors,
    editorScope,
    scopeRef,
    lastDir,
    patchWorkspace,
    openFile,
    closeEditor,
    closeEditorAnimated,
    selectEditor,
    minimizeEditor,
    setEditorSnap,
    onEditorGeometry,
    onEditorCursor,
    cycleEditor
  }
}
