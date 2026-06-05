import { join, dirname, relative, sep } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { readdir, open as fsOpen } from 'fs/promises'
import { execFile, spawn } from 'child_process'
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } from 'electron'
import Store from 'electron-store'
import { kvGet, kvSet } from './db'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

// Stała nazwa + klasa okna (WM_CLASS na X11, app_id na Wayland). Dzięki temu menedżer okien
// dopasowuje okno do wpisu Blink.desktop (z Icon=) i pokazuje naszą ikonę — na Wayland to
// JEDYNA droga (BrowserWindow.icon jest tam ignorowane). Musi być przed app.whenReady().
app.setName('Blink')
app.commandLine.appendSwitch('class', 'Blink')

// resolveClaude finds the host `claude` CLI. Electron's PATH may miss ~/.local/bin (e.g. when
// launched from a desktop entry), so we check common locations before falling back to PATH.
function resolveClaude(): string {
  const candidates = [
    join(homedir(), '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude'
  ]

  for (const p of candidates) {
    if (existsSync(p)) {
      return p
    }
  }

  return 'claude' // hope it's on PATH
}

// spawnClaudeTerminal launches `claude <args>` in a terminal emulator (interactive flows that
// need a TTY + browser, e.g. `auth login` or `setup-token`). Tries a few terminals; resolves
// false if none worked.
function spawnClaudeTerminal(claudeArgs: string[]): Promise<boolean> {
  const bin = resolveClaude()
  const cmd = [bin, ...claudeArgs]
  const term = process.env.TERMINAL || ''
  const candidates: [string, string[]][] = [
    ...(term ? ([[term, ['-e', ...cmd]]] as [string, string[]][]) : []),
    ['kitty', cmd],
    ['alacritty', ['-e', ...cmd]],
    ['gnome-terminal', ['--', ...cmd]],
    ['konsole', ['-e', ...cmd]],
    ['xfce4-terminal', ['-x', ...cmd]],
    ['x-terminal-emulator', ['-e', ...cmd]],
    ['xterm', ['-e', ...cmd]]
  ]

  return new Promise((resolve) => {
    let i = 0

    const tryNext = (): void => {
      if (i >= candidates.length) {
        resolve(false)

        return
      }

      const [t, args] = candidates[i++]

      try {
        const child = spawn(t, args, { detached: true, stdio: 'ignore' })
        child.on('error', () => tryNext())
        child.unref()
        setTimeout(() => resolve(true), 300)
      } catch {
        tryNext()
      }
    }

    tryNext()
  })
}

const store = new Store()
// Electron komunikuje się WYŁĄCZNIE z gateway; on proxuje do designera/ai/events.
const GATEWAY_ADDR = process.env.GATEWAY_ADDR || '127.0.0.1:50061'

const protoRoot = (): string => process.env.PROTO_ROOT || join(app.getAppPath(), '..', '..', 'proto')

// loadClient ładuje serwis z .proto i tworzy klienta gRPC.
function loadClient(rel: string, pkgPath: string[], addr: string): any {
  const def = protoLoader.loadSync(join(protoRoot(), rel), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  })

  let svc = grpc.loadPackageDefinition(def) as any

  for (const seg of pkgPath) {
    svc = svc[seg]
  }

  return new svc(addr, grpc.credentials.createInsecure())
}

// stripFence usuwa ewentualne ```bloki markdown``` z odpowiedzi LLM.
function stripFence(text: string): string {
  const m = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/)

  return m ? m[1] : text
}

// call wywołuje metodę klienta gateway i zwraca Promise (operacje przez gateway).
function call(method: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    client[method](payload, (err: any, resp: any) => (err ? reject(err) : resolve(resp)))
  })
}

// listGitFiles zbiera wszystkie pliki katalogu .git (rekurencyjnie, bez podążania
// za dowiązaniami) — do wysłania kopii historii do serwisu git przez gateway.
async function listGitFiles(dir: string): Promise<string[]> {
  const out: string[] = []

  const walk = async (d: string): Promise<void> => {
    const entries = await readdir(d, { withFileTypes: true })

    for (const e of entries) {
      const abs = join(d, e.name)

      if (e.isDirectory()) {
        await walk(abs)
      } else if (e.isFile()) {
        out.push(abs)
      }
    }
  }

  await walk(dir)

  return out
}

// writeChunk wysyła jeden RepoChunk respektując backpressure strumienia gRPC.
function writeChunk(callStream: any, obj: any): Promise<void> {
  return new Promise((resolve) => {
    if (callStream.write(obj)) {
      resolve()
    } else {
      callStream.once('drain', resolve)
    }
  })
}

// streamGitFile strumieniuje jeden plik .git kawałkami (eof na ostatnim). Pusty
// plik wysyła jako pojedynczy kawałek z eof — by serwis i tak go utworzył.
async function streamGitFile(callStream: any, abs: string, rel: string, repoPath: string): Promise<void> {
  const fh = await fsOpen(abs, 'r')

  try {
    const size = (await fh.stat()).size

    if (size === 0) {
      await writeChunk(callStream, { repoPath, relPath: rel, data: Buffer.alloc(0), eof: true })

      return
    }

    const CHUNK = 512 * 1024
    const buf = Buffer.allocUnsafe(CHUNK)
    let pos = 0

    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos)
      pos += bytesRead
      const data = Buffer.from(buf.subarray(0, bytesRead))
      await writeChunk(callStream, { repoPath, relPath: rel, data, eof: pos >= size })
    }
  } finally {
    await fh.close()
  }
}

// uploadGit wysyła całą zawartość <repoPath>/.git do serwisu git (przez gateway).
async function uploadGit(repoPath: string): Promise<any> {
  const gitDir = join(repoPath, '.git')

  if (!existsSync(gitDir)) {
    return { ok: false, files: 0, headBranch: '' }
  }

  const files = await listGitFiles(gitDir)

  return new Promise((resolve, reject) => {
    const callStream = client.UploadRepo((err: any, resp: any) => (err ? reject(err) : resolve(resp)))

    ;(async () => {
      try {
        for (const abs of files) {
          const rel = relative(gitDir, abs).split(sep).join('/')
          await streamGitFile(callStream, abs, rel, repoPath)
        }

        callStream.end()
      } catch (e) {
        try {
          callStream.cancel()
        } catch {
          // already torn down
        }

        reject(e)
      }
    })()
  })
}

let client: any

// onScreen sprawdza, czy zapisany prostokąt okna mieści się (przecina) z którymś
// z monitorów — chroni przed przywróceniem okna poza ekranem (np. po odpięciu monitora).
function onScreen(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea

    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
}

type WinState = { width: number; height: number; x?: number; y?: number; maximized?: boolean }

function createWindow(): BrowserWindow {
  // Open a bit larger at startup, centered. Cap the width so it doesn't stretch wide
  // on big/ultrawide displays.
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // Przywróć zapamiętany rozmiar/pozycję/maksymalizację okna głównego (SQLite).
  const saved = kvGet<WinState>('window:main')
  const place =
    saved && saved.x != null && saved.y != null && onScreen({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
      ? { x: saved.x, y: saved.y }
      : { center: true as const }

  const win = new BrowserWindow({
    width: saved?.width ?? Math.min(1480, Math.round(sw * 0.72)),
    height: saved?.height ?? Math.round(sh * 0.88),
    ...place,
    backgroundColor: '#0d1117',
    show: false,
    autoHideMenuBar: true,
    title: `Blink ${app.getVersion()}`,
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (saved?.maximized) {
    win.maximize()
  }

  // Zapamiętaj geometrię okna. getNormalBounds = rozmiar SPRZED maksymalizacji, więc
  // po wyjściu z fullscreena okno wraca do właściwego rozmiaru. Zapis odroczony (debounce).
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const persistWindow = (): void => {
    const b = win.getNormalBounds()
    kvSet('window:main', { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() })
  }

  const persistSoon = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer)
    }

    saveTimer = setTimeout(persistWindow, 400)
  }

  win.on('resize', persistSoon)
  win.on('move', persistSoon)
  win.on('maximize', persistSoon)
  win.on('unmaximize', persistSoon)
  win.on('close', persistWindow)

  win.on('ready-to-show', () => win.show())

  // Tytuł okna to "Blink <wersja>" (z package.json). Strona ma <title>Blink</title>, które
  // normalnie nadpisałoby tytuł — blokujemy to, by wersja została widoczna na pasku okna.
  const windowTitle = `Blink ${app.getVersion()}`
  win.webContents.on('page-title-updated', (e) => {
    e.preventDefault()
    win.setTitle(windowTitle)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Surface renderer load failures + crashes in the main-process terminal so a blank
  // window isn't a silent dead-end.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer] did-fail-load', code, desc, url)
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] render-process-gone', details.reason, details.exitCode)
  })

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.error(`[renderer-console] ${message} (${sourceId}:${line})`)
  })

  return win
}

function registerIpc(win: BrowserWindow): void {
  ipcMain.handle('app:lastFolder', () => store.get('lastFolder', '') as string)

  ipcMain.handle('dialog:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })

    if (res.canceled || res.filePaths.length === 0) {
      return ''
    }

    const folder = res.filePaths[0]
    store.set('lastFolder', folder)

    return folder
  })

  ipcMain.handle('graph:get', (_e, projectId: number) =>
    new Promise((resolve, reject) => {
      client.GetGraph({ projectId: projectId || 0 }, (err: any, resp: any) =>
        err ? reject(err) : resolve(resp)
      )
    })
  )

  ipcMain.handle('graph:getApp', (_e, appId: number) =>
    new Promise((resolve, reject) => {
      client.GetAppGraph({ appId }, (err: any, resp: any) => (err ? reject(err) : resolve(resp)))
    })
  )

  ipcMain.handle('projects:list', () =>
    new Promise((resolve, reject) => {
      client.ListProjects({}, (err: any, resp: any) => (err ? reject(err) : resolve(resp)))
    })
  )

  // graph state (viewport/positions) — persisted in Postgres via gateway → designer.
  ipcMain.handle('viewport:get', async (_e, key: string) => {
    const data = (await call('GetGraphState', { key })).data ?? ''

    try {
      return data ? JSON.parse(data) : null
    } catch {
      return null
    }
  })

  ipcMain.handle('viewport:set', (_e, p: { key: string; vp: unknown }) =>
    call('SaveGraphState', { key: p.key, data: JSON.stringify(p.vp) }).then(() => true)
  )

  // settings — preferencje (dostawca modelu, motyw, tapeta) w electron-store.
  // Zapis MERGE'uje z istniejącymi, by zapis jednego pola nie kasował pozostałych.
  ipcMain.handle('settings:get', () => store.get('settings', { provider: 'ollama' }))
  ipcMain.handle('settings:set', (_e, s: Record<string, unknown>) => {
    const cur = (store.get('settings', {}) as Record<string, unknown>) ?? {}
    store.set('settings', { ...cur, ...s })

    return true
  })

  // oauth:claude — start logowania do subskrypcji Claude Code (otwiera przeglądarkę).
  // UWAGA: wymiana tokenu i przełączenie providera w serwisie ai to osobny backend.
  ipcMain.handle('oauth:claude', async () => {
    await shell.openExternal('https://claude.ai/login')

    return true
  })

  // claude:status — czy host ma zalogowane Claude Code (`claude auth status` → JSON).
  ipcMain.handle('claude:status', () =>
    new Promise((resolve) => {
      execFile(resolveClaude(), ['auth', 'status'], { timeout: 10000 }, (err, stdout) => {
        try {
          const j = JSON.parse(stdout)
          resolve({ loggedIn: !!j.loggedIn, email: j.email ?? '', method: j.authMethod ?? '', installed: true })
        } catch {
          // brak binarki / nie-JSON → traktuj jako niezalogowany; installed=false gdy ENOENT
          const installed = !(err && (err as NodeJS.ErrnoException).code === 'ENOENT')
          resolve({ loggedIn: false, email: '', method: '', installed })
        }
      })
    })
  )

  // claude:login — odpala interaktywne `claude auth login` w terminalu (OAuth w przeglądarce).
  ipcMain.handle('claude:login', () => spawnClaudeTerminal(['auth', 'login']))

  // claude:setupToken — odpala `claude setup-token` w terminalu: otwiera przeglądarkę i po
  // autoryzacji wypisuje długoterminowy token (sk-ant-oat...), który user wkleja w okienku.
  ipcMain.handle('claude:setupToken', () => spawnClaudeTerminal(['setup-token']))

  // claude:saveToken — wysyła token do serwisu ai (przez gateway), który zapisuje go u siebie.
  ipcMain.handle('claude:saveToken', async (_e, token: string) =>
    (await call('AiSetClaudeToken', { token })).hasToken ?? false
  )

  // claude:tokenStatus — czy serwis ai ma zapisany token Claude (źródło prawdy dla UI).
  ipcMain.handle('claude:tokenStatus', async () => (await call('AiClaudeStatus', {})).hasToken ?? false)

  // --- Operacje na plikach: WSZYSTKIE idą przez gateway → serwis filer ---
  ipcMain.handle('file:read', async (_e, absPath: string) => (await call('ReadFile', { path: absPath })).content ?? '')

  ipcMain.handle('file:save', (_e, p: { path: string; content: string }) => call('SaveFile', p).then(() => true))

  ipcMain.handle('file:create', async (_e, p: { dir: string; file: string; name: string }) =>
    (await call('CreateFile', p)).path ?? ''
  )

  ipcMain.handle('file:mkdir', async (_e, p: { dir: string; name: string }) =>
    (await call('CreateFolder', p)).path ?? ''
  )

  ipcMain.handle('file:move', async (_e, p: { oldPath: string; targetDir: string }) =>
    (await call('MoveFile', p)).path ?? ''
  )

  ipcMain.handle(
    'file:rename',
    async (_e, p: { oldPath: string; fileBase: string; className: string; oldName: string }) =>
      (await call('RenameFile', p)).path ?? ''
  )

  ipcMain.handle('file:resolve', async (_e, p: { from: string; spec: string }) =>
    (await call('ResolveImport', p)).path ?? ''
  )

  // def:links — code-link analysis (go-to-definition) via gateway → scanner.
  ipcMain.handle('def:links', async (_e, p: { path: string; content: string }) =>
    (await call('Links', p)).links ?? []
  )

  ipcMain.handle('file:delete', async (_e, path: string) => (await call('DeletePath', { path })).ok ?? false)

  // --- Przeglądanie dysku / szukanie projektów: przez gateway → filer ---
  ipcMain.handle('fs:home', async () => (await call('HomeDir', {})).path ?? '')
  ipcMain.handle('fs:list', (_e, path: string) => call('ListDir', { path }))
  ipcMain.handle('fs:find', (_e, path: string) => call('FindProjects', { path }))
  ipcMain.handle('fs:conventions', (_e, path: string) => call('DetectConventions', { path }))

  // --- Git: autorstwo + diff-review (przez gateway → serwis git) ---
  // git:upload streamuje <folder>/.git do serwisu (otwarty projekt „wysyła" .git).
  // --- Układ okien edytorów per projekt (lokalny SQLite) ---
  // Zapamiętuje, które pliki były otwarte, w jakim miejscu/rozmiarze i czy zesnapowane,
  // by po ponownym otwarciu tego samego projektu odtworzyć te same okna.
  ipcMain.handle('editors:get', (_e, folder: string) => kvGet('editors:' + folder))
  ipcMain.handle('editors:set', (_e, p: { folder: string; data: unknown }) => {
    kvSet('editors:' + p.folder, p.data)

    return true
  })

  ipcMain.handle('git:upload', (_e, repoPath: string) => uploadGit(repoPath))
  ipcMain.handle('git:fileInfo', (_e, p: { repoPath: string; file: string }) => call('GitFileInfo', p))
  ipcMain.handle('git:review', (_e, p: { repoPath: string; base?: string }) =>
    call('GitReviewStatus', { repoPath: p.repoPath, base: p.base ?? '' })
  )
  ipcMain.handle('git:fileDiff', (_e, p: { repoPath: string; file: string; base?: string }) =>
    call('GitFileDiff', { repoPath: p.repoPath, file: p.file, base: p.base ?? '' })
  )

  // --- ai:agent — agent plików: ai PLANUJE, gateway (filer) WYKONUJE ---
  ipcMain.handle('ai:agent', (_e, p: { prompt: string; dir: string; lang: string }) => call('AiAgent', p))

  // ai:provider — przełączenie dostawcy LLM (przez gateway → ai). Zwraca nazwę.
  ipcMain.handle('ai:provider', async (_e, provider: string) => (await call('AiSetProvider', { provider })).name ?? '')

  // ai:edit — przez gateway → serwis ai (cały LLM jest w ai).
  ipcMain.handle('ai:edit', (_e, payload: { code: string; prompt: string; file: string }) =>
    new Promise((resolve, reject) => {
      client.AiEdit(
        { code: payload.code, prompt: payload.prompt, file: payload.file },
        (err: any, resp: any) => (err ? reject(err) : resolve(stripFence(resp?.code ?? '')))
      )
    })
  )

  // ai:complete — podpowiedź Copilot (prefix/suffix wokół kursora) przez gateway → ai.
  ipcMain.handle('ai:complete', async (_e, p: { prefix: string; suffix: string; file: string }) =>
    (await call('AiComplete', p)).text ?? ''
  )

  ipcMain.handle('ai:model', () =>
    new Promise((resolve, reject) => {
      client.AiModel({}, (err: any, resp: any) => (err ? reject(err) : resolve(resp?.name ?? '')))
    })
  )

  ipcMain.handle('ai:review', (_e, payload: { code: string; file: string; lang: string }) =>
    new Promise((resolve, reject) => {
      client.AiReview({ code: payload.code, file: payload.file, lang: payload.lang }, (err: any, resp: any) =>
        err ? reject(err) : resolve(resp?.remarks ?? [])
      )
    })
  )

  // lint:file — ESLint. Najpierw lokalny config projektu; gdy brak — wbudowany
  // flat config (typescript-eslint recommended).
  ipcMain.handle('lint:file', async (_e, payload: { code: string; file: string }) => {
    const runLint = async (eslint: any) => {
      const results = await eslint.lintText(payload.code, { filePath: payload.file })
      const messages = results[0]?.messages ?? []

      return messages.map((m: any) => ({
        line: m.line || 1,
        text: m.message + (m.ruleId ? ` [${m.ruleId}]` : ''),
        severity: m.severity
      }))
    }

    try {
      const eslintMod: any = await import('eslint')
      const ESLint = eslintMod.ESLint ?? eslintMod.default?.ESLint
      const dir = dirname(payload.file)

      try {
        // lokalna konfiguracja projektu (eslint.config.* / .eslintrc) szukana od katalogu pliku
        return await runLint(new ESLint({ cwd: dir, errorOnUnmatchedPattern: false }))
      } catch {
        // brak lokalnego configu → wbudowany flat config
        const tseslintMod: any = await import('typescript-eslint')
        const tseslint = tseslintMod.default ?? tseslintMod

        return await runLint(
          new ESLint({
            cwd: dir,
            overrideConfigFile: true,
            overrideConfig: tseslint.config(...tseslint.configs.recommended)
          })
        )
      }
    } catch {
      return []
    }
  })

  // event:publish — przez gateway → serwis events (Redis).
  ipcMain.handle('event:publish', (_e, ev: any) =>
    new Promise((resolve, reject) => {
      client.PublishEvent(ev, (err: any, resp: any) => (err ? reject(err) : resolve(resp)))
    })
  )

  // --- User scripts: via gateway → scripting service (Postgres) ---
  // project == '' → all; otherwise global + pinned to the project. project is not required.
  ipcMain.handle('scripts:list', async (_e, project?: string) =>
    (await call('ListScripts', { project: project ?? '' })).scripts ?? []
  )
  ipcMain.handle('scripts:get', (_e, id: number) => call('GetScript', { id }))
  ipcMain.handle('scripts:save', (_e, s: { id?: number; name: string; content: string; project?: string }) =>
    call('SaveScript', { id: s.id ?? 0, name: s.name, content: s.content, project: s.project ?? '' })
  )
  ipcMain.handle('scripts:delete', async (_e, id: number) => (await call('DeleteScript', { id })).ok ?? false)

  // --- App logs: przez gateway → serwis logs (własna baza) ---
  ipcMain.handle('logs:append', (_e, entries: { time: number; level: string; message: string; source?: string }[]) =>
    call('AppendLogs', { entries }).then(() => true)
  )
  ipcMain.handle('logs:list', async (_e, limit?: number) => (await call('ListLogs', { limit: limit ?? 0 })).entries ?? [])
  ipcMain.handle('logs:clear', () => call('ClearLogs', {}).then(() => true))

  ipcMain.on('scan:start', (e, path: string) => {
    const call = client.Scan({ path })

    call.on('data', (p: any) => e.sender.send('scan:progress', p))
    call.on('end', () => e.sender.send('scan:end'))
    call.on('error', (err: any) => e.sender.send('scan:error', String(err)))
  })

  ipcMain.on('app:scan:start', (e, appId: number) => {
    const call = client.ScanApp({ appId })

    call.on('data', (p: any) => e.sender.send('scan:progress', p))
    call.on('end', () => e.sender.send('scan:end'))
    call.on('error', (err: any) => e.sender.send('scan:error', String(err)))
  })

  // --- Disk watcher: gateway → filer streams fs changes so the graph stays fresh ---
  // Only one watcher at a time; starting a new one cancels the previous stream.
  let watchCall: any = null

  const stopWatch = (): void => {
    if (watchCall) {
      try {
        watchCall.cancel()
      } catch {
        // stream already closed
      }

      watchCall = null
    }
  }

  ipcMain.on('fs:watch:start', (e, path: string) => {
    stopWatch()

    if (!path) {
      return
    }

    const call = client.WatchFiles({ path })
    watchCall = call

    call.on('data', (ev: any) => e.sender.send('fs:change', ev))
    call.on('end', () => undefined)
    call.on('error', () => undefined) // cancel / transient errors — ignore
  })

  ipcMain.on('fs:watch:stop', () => stopWatch())

  // --- Agent AI ze skillami (DWUKIERUNKOWY stream gateway → ai). Jedna aktywna tura naraz.
  // Plan/narzędzia/odpowiedź lecą jako 'ai:event'; żądania skilli jako 'ai:skill' (aplikacja
  // je wykonuje: read_file/list_dir/get_graph/ask_user) i odsyła wynik przez 'ai:skill:result'.
  let askStream: any = null

  const cancelAsk = (): void => {
    if (askStream) {
      try {
        askStream.cancel()
      } catch {
        // already closed
      }

      askStream = null
    }
  }

  ipcMain.on('ai:ask:start', (e, payload: unknown) => {
    cancelAsk()

    const stream = client.AiAsk()
    askStream = stream

    stream.on('data', (ev: any) => {
      const kind = ev.event // selektor oneof (camelCase z proto-loadera)

      if (kind === 'plan') {
        e.sender.send('ai:event', { type: 'plan', plan: ev.plan })
      } else if (kind === 'tool') {
        e.sender.send('ai:event', { type: 'tool', tool: ev.tool })
      } else if (kind === 'answer') {
        e.sender.send('ai:event', { type: 'answer', answer: ev.answer })
      } else if (kind === 'skillRequest') {
        e.sender.send('ai:skill', ev.skillRequest)
      }
    })

    stream.on('end', () => {
      e.sender.send('ai:event', { type: 'done' })

      if (askStream === stream) {
        askStream = null
      }
    })

    stream.on('error', (err: any) => {
      e.sender.send('ai:event', { type: 'error', message: String(err?.message || err) })

      if (askStream === stream) {
        askStream = null
      }
    })

    stream.write({ start: payload })
  })

  ipcMain.on('ai:skill:result', (_e, res: unknown) => {
    if (askStream) {
      try {
        askStream.write({ skillResult: res })
      } catch {
        // stream already closed
      }
    }
  })

  ipcMain.on('ai:ask:cancel', () => cancelAsk())
}

app.whenReady().then(() => {
  // Bez natywnego paska menu (File/Edit/View…).
  Menu.setApplicationMenu(null)

  client = loadClient('gateway/v1/gateway.proto', ['gateway', 'v1', 'Gateway'], GATEWAY_ADDR)

  const win = createWindow()
  registerIpc(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
