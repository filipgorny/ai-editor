import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { ThemeProvider } from '@mui/material/styles'
import { makeTheme } from './theme'
import { Node } from './model'
import ScanModal from './components/ScanModal'
import SettingsDialog from './components/SettingsDialog'
import ScriptsDialog from './components/ScriptsDialog'
import LogsDialog from './components/LogsDialog'
import ClaudeLoginDialog from './components/ClaudeLoginDialog'
import AiAskModal from './components/AiAskModal'
import ToastHost from './components/ToastHost'
import AgentBar from './components/AgentBar'
import EditorTabs from './components/EditorTabs'
import FileBrowser from './components/FileBrowser'
import CodeEditor from './components/CodeEditor'
import { EditorContext } from './components/EditorContext'
import { GitContext } from './components/GitContext'
import TopBar from './components/TopBar'
import { appBus } from './events'
import { commander } from './commander/Commander'
import { VIEWS, DEFAULT_VIEW } from './views/registry'
import type { ViewContext, ViewKey } from './views/types'
import ViewRail from './views/ViewRail'
import ViewHost from './views/ViewHost'
import { useViewKeys } from './hooks/useViewKeys'
import Telescope, { useTelescopeChord } from './components/Telescope'
import { installKeystrokeCounter } from './components/TopBarStats'
import { useAppSettings } from './hooks/useAppSettings'
import { useProjectScan } from './hooks/useProjectScan'
import { useEditors } from './hooks/useEditors'
import { useDiskWatch } from './hooks/useDiskWatch'
import { useGitReview } from './hooks/useGitReview'
import { useAiAgent } from './hooks/useAiAgent'
import { useFileOps } from './hooks/useFileOps'

const Layout = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
`

// Wiersz głównej zawartości: lewy pasek widoków + panel plików + aktywny widok
// (od paska edytorów do promptu).
const Content = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
`

// Default global script, seeded once into the scripting service. Shift+Tab is now owned by
// the multi-view shell (cycle views — see useViewKeys), and ALT+Left/Right cycle editor
// windows, so the seeded default binds editor-window cycling to Ctrl+Tab / Ctrl+Shift+Tab
// instead (editable: users can rebind or repoint these to any chord/command).
const DEFAULT_SCRIPT = {
  name: 'Window cycle (Ctrl+Tab)',
  content: `-- Ctrl+Tab / Ctrl+Shift+Tab: cycle through open editor windows (files).
-- (Shift+Tab cycles VIEWS; ALT+Left/Right also cycle editor windows.)
onKey("ctrl+tab", function()
  cmd("tabs", "next")
end)

onKey("ctrl+shift+tab", function()
  cmd("tabs", "prev")
end)
`
}

export default function App() {
  // activeView drives the view shell (rail + ViewHost). scanning is an independent
  // overlay flag (ScanModal) that no longer hijacks the whole stage.
  const [activeView, setActiveView] = useState<ViewKey>(DEFAULT_VIEW)
  const [focusPath, setFocusPath] = useState('')
  // last-clicked graph node — highlighted, and its info is sent with the AI prompt
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scriptsOpen, setScriptsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [claudeLoginOpen, setClaudeLoginOpen] = useState(false)
  // Telescope (Esc+Space) finder overlay — controlled open state.
  const [telescopeOpen, setTelescopeOpen] = useState(false)
  // czy próbowaliśmy już zasiać domyślny skrypt (raz na sesję)
  const seeded = useRef(false)

  // switchView changes the active view and announces it on the bus ('view:change').
  // The single mutator of activeView — rail clicks, ALT+n, Shift+Tab and deep-links
  // ('view:request') all funnel through here. activeViewRef keeps the latest value for
  // bus handlers registered once (so the 'from' field is accurate without re-subscribing).
  const activeViewRef = useRef<ViewKey>(activeView)
  activeViewRef.current = activeView

  const switchView = useCallback((to: ViewKey): void => {
    const from = activeViewRef.current

    if (from === to) {
      return
    }

    activeViewRef.current = to
    setActiveView(to)
    // 'view:change' is integration-owned (not yet in AppEventMap) → emit with a cast,
    // the same pattern keys.ts uses for dynamic event names.
    appBus.emit('view:change' as never, { from, to } as never)
  }, [])

  // Per-project tab memory: remember which view (tab) was open for each project folder and
  // return to it when the project is reopened. restoredTabFolder gates the persist effect so
  // we never write the PREVIOUS project's tab onto a freshly-opened folder before its saved
  // tab has been restored. onInitialScanRef lets useProjectScan register its scan-end handler
  // once while still calling the latest closure (with the current folder).
  const restoredTabFolder = useRef('')
  const onInitialScanRef = useRef<() => void>(() => {})

  // Visual / editor settings + persistence. Prompts for Claude login when the saved
  // provider is Claude but no token is present.
  const settings = useAppSettings(() => setClaudeLoginOpen(true))
  const {
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
    setGitBlame
  } = settings

  const muiTheme = useMemo(() => makeTheme(accent), [accent])

  // Graph / scan / navigation. Once the initial scan ends, restore the project's last-open
  // tab (default: code-diagram) instead of always jumping to the diagram.
  const scan = useProjectScan(() => onInitialScanRef.current())
  const {
    folder,
    graph,
    graphRef,
    scanning,
    progress,
    log,
    error,
    navKey,
    fsVersion,
    pickAndScan,
    refreshForPath,
    refreshCurrentView,
    expandApp
  } = scan

  // restoreProjectTab — read the saved view for a folder and switch to it (falling back to
  // the code-diagram when nothing is stored). Marks the folder as restored so the persist
  // effect below can take over without clobbering the value we just read.
  const restoreProjectTab = useCallback(
    async (f: string): Promise<void> => {
      let target: ViewKey = 'diagram'

      if (f) {
        try {
          const saved = await window.api.getState<ViewKey>('view:last:' + f)

          if (saved && VIEWS.some((v) => v.key === saved)) {
            target = saved
          }
        } catch {
          // brak zapisanego widoku lub błąd odczytu — zostaje domyślny diagram
        }
      }

      restoredTabFolder.current = f
      switchView(target)
    },
    [switchView]
  )

  // Keep the scan-end callback pointing at the latest folder. useProjectScan invokes this
  // once per completed project scan; we restore that project's remembered tab there.
  useEffect(() => {
    onInitialScanRef.current = () => {
      void restoreProjectTab(folder)
    }
  }, [folder, restoreProjectTab])

  // Persist the active view per project so reopening it returns to the same tab. Gated on
  // restoredTabFolder so the previous project's view isn't written onto a newly-opened
  // folder before restoration has run for it.
  useEffect(() => {
    if (!folder || restoredTabFolder.current !== folder) {
      return
    }

    window.api.setState('view:last:' + folder, activeView)
  }, [activeView, folder])

  // Per-view editor workspaces (editor / diagram each independent).
  const editors = useEditors(activeView, folder)
  const {
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
  } = editors

  // Per-view shell flags from the registry: which views show the left file tree and which
  // host editor windows + their tab strip (only the editor and code-diagram views do).
  const activeDef = useMemo(() => VIEWS.find((v) => v.key === activeView), [activeView])
  const showsFileTree = !!activeDef?.showsFileTree
  const hostsEditors = !!activeDef?.hostsEditors

  // Persistent union tab strip (every view): map a tab's owning scope onto its canonical
  // view, switch to that view, then activate / restore the file in THAT scope's workspace.
  // scopeView — 'editor' scope ↔ 'editor' view, 'diagram' scope ↔ 'diagram' view.
  const scopeView = (scope: 'editor' | 'diagram'): ViewKey => scope

  const selectUnionTab = useCallback(
    (path: string): void => {
      const tab = allEditors.find((t) => t.path === path)

      if (!tab) {
        return
      }

      switchView(scopeView(tab.scope))
      patchWorkspace(tab.scope, (w) => {
        const minimized = new Set(w.minimized)
        minimized.delete(path)

        return { minimized, activeEditor: path }
      })
      appBus.emit('editor:activate', { path })
    },
    [allEditors, switchView, patchWorkspace]
  )

  const closeUnionTab = useCallback(
    (path: string): void => {
      const tab = allEditors.find((t) => t.path === path)

      if (!tab) {
        return
      }

      appBus.emit('editor:close', { path })
      patchWorkspace(tab.scope, (w) => {
        const minimized = new Set(w.minimized)
        minimized.delete(path)

        const snappedTop = new Set(w.snappedTop)
        snappedTop.delete(path)

        return { editors: w.editors.filter((e) => e.path !== path), minimized, snappedTop }
      })
    },
    [allEditors, patchWorkspace]
  )

  // React to on-disk changes (filer watcher) → refresh the graph for the changed path.
  useDiskWatch(folder, refreshForPath)

  // Git review mode (driven by the active view) + git context for blocks/editor.
  const { review, reviewFiles, gitState } = useGitReview(folder, activeView, gitBlame)

  // AI agent (Ask + file-writing agent) wired to the live editor / graph / file ops.
  const { agentBusy, agentReply, pendingAsk, runAsk, runAgent, onAskChoose, clearReply } = useAiAgent({
    folder,
    selectedNode,
    activeEditorPath: ws.activeEditor,
    graphRef,
    lastDir,
    openFile,
    closeEditorAnimated,
    refreshForPath,
    setFocusPath,
    getOpenEditors: () => ws.editors
  })

  // File operations from the graph context menu (add / rename / move / delete).
  const { addElement, renameElement, moveFile, deleteElement } = useFileOps({
    folder,
    openFile,
    refreshForPath,
    setFocusPath
  })

  // Wire app-level actions into the Commander (open/close editors, switch tabs, pick a
  // project, run the agent). Re-wired when editors/folder change so closures stay fresh.
  useEffect(() => {
    commander.setHost({
      openFile,
      closeEditor,
      selectEditor,
      minimizeEditor,
      listEditors: () => workspaces[scopeRef.current].editors.map((e) => e.path),
      activePath: () => workspaces[scopeRef.current].activeEditor,
      pickProject: pickAndScan,
      refresh: refreshCurrentView,
      runAgent,
      resolvePath: (p) => {
        if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) {
          return p
        }

        const rel = p.replace(/^\.?[\\/]/, '')

        return folder ? folder.replace(/[\\/]$/, '') + '/' + rel : rel
      }
    })
  }, [workspaces, folder])

  // Auto-load stored Lua scripts for the open project from the scripting service (global +
  // project-pinned). Runs only when scripts exist (so the WASM runtime isn't pulled in
  // otherwise); the runtime is reset first for a fresh per-project environment. Failures are
  // swallowed so a bad script can't break startup.
  useEffect(() => {
    if (!folder) {
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        // Seed the default global script once (if the user hasn't created it already).
        if (!seeded.current) {
          seeded.current = true

          const all = await window.api.listScripts('')

          if (!all.some((s) => s.name === DEFAULT_SCRIPT.name)) {
            await window.api.saveScript({ name: DEFAULT_SCRIPT.name, content: DEFAULT_SCRIPT.content, project: '' })
          }
        }

        const scripts = await window.api.listScripts(folder)

        if (!scripts.length || cancelled) {
          return
        }

        const { runLuaSource, disposeLua } = await import('./lua/runtime')

        await disposeLua()

        for (const s of scripts) {
          if (cancelled) {
            return
          }

          await runLuaSource(s.content)
        }
      } catch {
        // serwis scripting niedostępny lub błąd skryptu — pomijamy (start nie może paść)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [folder])

  // Ordered view keys (registry order) for the keyboard shortcuts (ALT+n, Shift+Tab).
  const viewOrder = useMemo(() => VIEWS.map((v) => v.key), [])

  // Global view keybindings: ALT+n select, Shift+Tab cycle, ALT+arrows editor nav,
  // Escape → AI area. Implemented over the bus so they can become editable scripts later.
  useViewKeys({ order: viewOrder, active: activeView, setActive: switchView })

  // Telescope (Esc+Space) chord: the hook flips the overlay open. The 'telescope:open' bus
  // event (deep-links / scripts) can open it too; both funnel into setTelescopeOpen.
  useTelescopeChord(() => setTelescopeOpen(true))

  useEffect(() => {
    return appBus.on('telescope:open', () => setTelescopeOpen(true))
  }, [])

  // Global keystroke counter — batches keydowns and flushes to statsBump every ~2.5s so
  // the topbar's daily counter updates without an IPC call per key.
  useEffect(() => installKeystrokeCounter(), [])

  // onTelescopePick — Telescope selection: open the file at the matched line and jump to
  // the editor view. Also re-broadcast on the bus for any other listener.
  const onTelescopePick = useCallback(
    (absPath: string, line?: number): void => {
      openFile(absPath, undefined, true, line)
      switchView('editor')
      appBus.emit('telescope:pick', { absPath, line })
      setTelescopeOpen(false)
    },
    [switchView]
  )

  // Deep-links: any component may ask App to switch views ('view:request'); App is the
  // only mutator of activeView. ALT+arrows emit 'editor:nav' which we resolve here.
  useEffect(() => {
    const offReq = appBus.on('view:request' as never, (p: { to: ViewKey }) => {
      if (p?.to) {
        switchView(p.to)
      }
    })

    const offNav = appBus.on('editor:nav' as never, (p: { dir: 'prev' | 'next' }) => {
      cycleEditor(p?.dir === 'prev' ? 'prev' : 'next')
    })

    return () => {
      offReq()
      offNav()
    }
  }, [switchView, cycleEditor])

  // ViewContext — the single object every view receives. Memoized over its live fields so
  // keepMounted views (editor/terminal/browser) don't re-render on unrelated App updates.
  // The 'viewKey'/'active' fields are filled in per-view by ViewHost; here we default them.
  const viewCtx: ViewContext = useMemo(
    () => ({
      viewKey: activeView,
      active: true,
      folder,
      graph,
      selectedNode,
      navKey,
      editors: ws.editors,
      activeEditorPath: ws.activeEditor,
      minimized: ws.minimized,
      wallpaper,
      editorTheme,
      vimOn,
      copilotOn,
      rainbow,
      accent,
      focusPath,
      review,
      reviewFiles,
      openFile,
      closeEditor,
      selectEditor,
      minimizeEditor,
      expandApp,
      addElement,
      renameElement,
      moveFile,
      deleteElement,
      setSelectedNode,
      bus: appBus,
      api: window.api
    }),
    // Functions are stable enough (closures rebuilt each render); only live values gate
    // the memo so keepMounted views aren't churned needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeView,
      folder,
      graph,
      selectedNode,
      navKey,
      ws.editors,
      ws.activeEditor,
      ws.minimized,
      wallpaper,
      editorTheme,
      vimOn,
      copilotOn,
      rainbow,
      accent,
      focusPath,
      review,
      reviewFiles
    ]
  )

  return (
    <ThemeProvider theme={muiTheme}>
    <EditorContext.Provider value={openFile}>
    <GitContext.Provider value={gitState}>
      <Layout>
        <TopBar
          folder={folder}
          onPickProject={pickAndScan}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenScripts={() => setScriptsOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
        />

      {/* Persistent editor tab strip on EVERY view: the UNION of open files across all
          editor workspaces. Clicking a tab switches to the view that hosts that file's
          window and activates it. The active tab is the active file of the currently active
          scope (only when that view hosts editors). Minimized tabs (any scope) show greyed. */}
      <EditorTabs
        editors={allEditors}
        active={hostsEditors ? ws.activeEditor : ''}
        minimized={new Set([...workspaces.editor.minimized, ...workspaces.diagram.minimized])}
        onSelect={selectUnionTab}
        onClose={closeUnionTab}
      />

      <Content>
        <ViewRail views={VIEWS} active={activeView} onSelect={switchView} />

        {/* Left panel: the file tree shows ONLY on views that work on files (editor /
            code-diagram). In review mode it stays visible but renders the flat "Changed
            Files" list instead of the tree; every other view hides it entirely. */}
        {(showsFileTree || review) && (
          <FileBrowser
            root={folder}
            version={fsVersion}
            onOpenFile={(p) => openFile(p)}
            onChanged={(p) => refreshForPath(p)}
            review={review}
            changed={reviewFiles}
          />
        )}

        <ViewHost views={VIEWS} active={activeView} ctx={viewCtx} />
      </Content>

      {/* AgentBar is pinned at the bottom for EVERY view — the AI always knows what's on
          screen and can help, regardless of the active view. */}
      <AgentBar
        onSubmit={runAsk}
        busy={agentBusy}
        reply={agentReply}
        onClearReply={clearReply}
      />

      <ScanModal open={scanning} progress={progress} log={log} error={error} />
        {/* Floating editor windows live at the root (position:fixed) so they survive view
            switches; they render only for views that host editors (editor / code-diagram)
            and show that view's OWN workspace (independent open-files list). */}
        {hostsEditors && ws.editors.map((t, i) => (
          <CodeEditor
            key={t.path}
            target={t}
            index={i}
            active={ws.activeEditor === t.path}
            onActivate={() => patchWorkspace(scopeRef.current, { activeEditor: t.path })}
            minimized={ws.minimized.has(t.path)}
            onMinimize={() => minimizeEditor(t.path)}
            onClose={() => closeEditor(t.path)}
            onOpen={(nt) => openFile(nt.path, nt.gotoFn, false, nt.gotoLine)}
            vim={vimOn}
            onVimChange={setVimOn}
            copilot={copilotOn}
            onCopilotChange={setCopilotOn}
            rainbow={rainbow}
            eachFnColor={eachFnColor}
            theme={editorTheme}
            root={folder}
            closing={ws.closingEditors.has(t.path)}
            review={review}
            initialSnap={ws.snappedTop.size > 0 || review}
            onSnapChange={(snapped) => setEditorSnap(t.path, snapped)}
            initialGeom={ws.layoutByPath[t.path]}
            onGeometry={onEditorGeometry}
            onCursor={onEditorCursor}
          />
        ))}
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          theme={editorTheme}
          onThemeChange={setEditorTheme}
          wallpaper={wallpaper}
          onWallpaperChange={setWallpaper}
          accent={accent}
          onAccentChange={setAccent}
          blame={gitBlame}
          onBlameChange={setGitBlame}
          rainbow={rainbow}
          onRainbowChange={setRainbow}
          vimOn={vimOn}
          onVimChange={setVimOn}
          copilotOn={copilotOn}
          onCopilotChange={setCopilotOn}
          eachFnColor={eachFnColor}
          onEachFnColorChange={setEachFnColor}
        />
        <ScriptsDialog open={scriptsOpen} onClose={() => setScriptsOpen(false)} project={folder} theme={editorTheme} />
        <LogsDialog open={logsOpen} onClose={() => setLogsOpen(false)} />
        <ClaudeLoginDialog open={claudeLoginOpen} onClose={() => setClaudeLoginOpen(false)} />
        <AiAskModal ask={pendingAsk} onChoose={onAskChoose} />
        {/* Telescope (Esc+Space) file + content finder. Root-level portal above editors;
            a pick opens the file and switches to the editor view. */}
        <Telescope
          open={telescopeOpen}
          onClose={() => setTelescopeOpen(false)}
          root={folder}
          onOpenFile={onTelescopePick}
        />
        <ToastHost />
      </Layout>
    </GitContext.Provider>
    </EditorContext.Provider>
    </ThemeProvider>
  )
}
