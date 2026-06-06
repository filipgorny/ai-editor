import { join, dirname, relative, sep } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { readdir, open as fsOpen, readFile as fsReadFile, stat as fsStat } from 'fs/promises'
import { execFile, spawn } from 'child_process'
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } from 'electron'
import Store from 'electron-store'
import {
  kvGet,
  kvSet,
  tasksList,
  tasksSave,
  tasksDelete,
  tasksSetActive,
  jiraGetConfig,
  jiraSetConfig,
  statsGet,
  statsBump,
  type Task,
  type JiraConfig
} from './db'
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
      sandbox: false,
      // Enable <webview> for the in-app web browser view (view 7). The renderer still
      // gates whether webviews are created via browserSetEnabled.
      webviewTag: true
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

// ---- Terminal PTY (view 6) ---------------------------------------------------
// One PTY per id. node-pty is a native module; require it lazily inside try/catch so
// a missing/unbuilt binary degrades gracefully (handlers no-op + report unavailable)
// instead of crashing the app or breaking the renderer build.
type PtyProc = {
  write: (d: string) => void
  resize: (c: number, r: number) => void
  kill: () => void
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (e: { exitCode: number }) => void) => void
}

let ptyModule: { spawn: (...a: unknown[]) => PtyProc } | null | undefined

function loadPty(): { spawn: (...a: unknown[]) => PtyProc } | null {
  if (ptyModule !== undefined) {
    return ptyModule
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyModule = require('node-pty')
  } catch (e) {
    console.error('[pty] node-pty unavailable:', (e as Error).message)
    ptyModule = null
  }

  return ptyModule ?? null
}

const ptys = new Map<string, PtyProc>()

// defaultShell picks a sensible login shell for the host platform.
function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe'
  }

  return process.env.SHELL || '/bin/bash'
}

// ---- React app runner (Run button on the code diagram) ----------------------
// One dev server at a time. The script is spawned in its own process group (detached) so
// stopping it kills the whole tree (the package manager + node + bundler workers).
let reactProc: ReturnType<typeof spawn> | null = null

// stripAnsi removes terminal colour codes so the URL regex matches the dev-server banner.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// detectPm picks the package manager from the lockfile in dir (npm is the fallback).
function detectPm(dir: string): string {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }

  if (existsSync(join(dir, 'yarn.lock'))) {
    return 'yarn'
  }

  if (existsSync(join(dir, 'bun.lockb'))) {
    return 'bun'
  }

  return 'npm'
}

// readPkg reads and parses <dir>/package.json (null when missing/invalid).
async function readPkg(dir: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fsReadFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

// detectApiUrl best-effort finds the backend API base URL the React app talks to, so the
// renderer can probe it before launching. Looks at .env files (API-ish vars), the CRA
// "proxy" field, and a vite server.proxy target. Returns '' when nothing is found.
async function detectApiUrl(dir: string): Promise<string> {
  for (const f of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    let text = ''

    try {
      text = await fsReadFile(join(dir, f), 'utf8')
    } catch {
      continue
    }

    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*['"]?(https?:\/\/[^\s'"]+)/i)

      if (m && /API|BACKEND|SERVER|GATEWAY/i.test(m[1])) {
        return m[2]
      }
    }
  }

  const pkg = await readPkg(dir)

  if (pkg && typeof pkg.proxy === 'string' && /^https?:\/\//.test(pkg.proxy)) {
    return pkg.proxy
  }

  for (const cfg of ['vite.config.ts', 'vite.config.js']) {
    try {
      const m = (await fsReadFile(join(dir, cfg), 'utf8')).match(/target:\s*['"](https?:\/\/[^'"]+)['"]/)

      if (m) {
        return m[1]
      }
    } catch {
      // no vite config / unreadable — skip
    }
  }

  return ''
}

// probeUrl returns true when something answers at url (any HTTP status counts — a 404 still
// means a server is listening). A refused connection / timeout returns false.
async function probeUrl(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)

  try {
    await fetch(url, { method: 'GET', signal: controller.signal })

    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// killReactProc stops the running dev server (whole process group) if any.
function killReactProc(): void {
  const proc = reactProc

  if (!proc) {
    return
  }

  reactProc = null

  try {
    if (proc.pid) {
      process.kill(-proc.pid, 'SIGTERM')
    } else {
      proc.kill('SIGTERM')
    }
  } catch {
    // already gone
  }
}

// ---- Web browser history (view 7) -------------------------------------------
// Lightweight per-id navigation history kept in app_state. The actual page lives in a
// renderer <webview>; this only records where each browser window has been.
type BrowserEntry = { url: string; title: string; ts: number }

// normalizeUrl turns a bare host/search into a real URL (https:// default, or a
// DuckDuckGo search when it doesn't look like a host).
function normalizeUrl(raw: string): string {
  const s = raw.trim()

  if (!s) {
    return ''
  }

  if (/^https?:\/\//i.test(s)) {
    return s
  }

  if (/^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(s) || s === 'localhost' || s.startsWith('localhost:')) {
    return 'https://' + s
  }

  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s)
}

function browserHistoryKey(id: string): string {
  return 'browser:history:' + id
}

function pushBrowserHistory(id: string, url: string): void {
  const list = kvGet<BrowserEntry[]>(browserHistoryKey(id)) ?? []
  list.push({ url, title: '', ts: Date.now() })

  // Cap history so the store doesn't grow unbounded.
  kvSet(browserHistoryKey(id), list.slice(-200))
}

// ---- Telescope finder (Esc+Space) -------------------------------------------
// Filename + content search under a root. Prefers ripgrep for content matches; falls
// back to a bounded fs walk. Skips heavy/irrelevant directories.
type TelescopeHit = {
  path: string
  absPath: string
  line?: number
  preview?: string
  kind: 'name' | 'content'
}

const TELESCOPE_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.next', 'build', '.cache', 'vendor', 'target'])

function hasRipgrep(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('rg', ['--version'], { timeout: 3000 }, (err) => resolve(!err))
  })
}

// walkFiles collects files under root (skipping noise dirs) up to a cap.
async function walkFiles(root: string, cap: number): Promise<string[]> {
  const out: string[] = []

  const walk = async (dir: string): Promise<void> => {
    if (out.length >= cap) {
      return
    }

    let entries: import('fs').Dirent[]

    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const e of entries) {
      if (out.length >= cap) {
        return
      }

      if (e.name.startsWith('.') && e.name !== '.env') {
        // Skip dotfiles/dotdirs except a couple of useful ones; .git etc. already in skip set.
      }

      if (e.isDirectory()) {
        if (!TELESCOPE_SKIP.has(e.name) && !e.name.startsWith('.')) {
          await walk(join(dir, e.name))
        }
      } else if (e.isFile()) {
        out.push(join(dir, e.name))
      }
    }
  }

  await walk(root)

  return out
}

// telescopeRgContent runs ripgrep for content matches and parses its vimgrep output.
function telescopeRgContent(query: string, root: string, limit: number): Promise<TelescopeHit[]> {
  return new Promise((resolve) => {
    const args = [
      '--vimgrep',
      '--no-heading',
      '--smart-case',
      '--max-count',
      '5',
      '-g',
      '!node_modules',
      '-g',
      '!.git',
      '-g',
      '!dist',
      '-g',
      '!out',
      query,
      root
    ]

    execFile('rg', args, { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
      const hits: TelescopeHit[] = []
      const lines = (stdout || '').split('\n')

      for (const raw of lines) {
        if (hits.length >= limit) {
          break
        }

        // Format: path:line:col:preview
        const m = raw.match(/^(.*?):(\d+):(\d+):(.*)$/)

        if (!m) {
          continue
        }

        const absPath = m[1]
        hits.push({
          path: relative(root, absPath),
          absPath,
          line: Number(m[2]),
          preview: m[4].slice(0, 200),
          kind: 'content'
        })
      }

      resolve(hits)
    })
  })
}

// telescopeWalkContent is the ripgrep-less fallback: grep file contents during a walk.
async function telescopeWalkContent(query: string, files: string[], limit: number): Promise<TelescopeHit[]> {
  const hits: TelescopeHit[] = []
  const needle = query.toLowerCase()

  for (const abs of files) {
    if (hits.length >= limit) {
      break
    }

    try {
      const st = await fsStat(abs)

      if (st.size > 1024 * 1024) {
        continue
      }

      const text = await fsReadFile(abs, 'utf8')

      if (text.includes(' ')) {
        continue
      }

      const fileLines = text.split('\n')

      for (let i = 0; i < fileLines.length; i++) {
        if (hits.length >= limit) {
          break
        }

        if (fileLines[i].toLowerCase().includes(needle)) {
          hits.push({
            path: abs,
            absPath: abs,
            line: i + 1,
            preview: fileLines[i].trim().slice(0, 200),
            kind: 'content'
          })
        }
      }
    } catch {
      // unreadable / binary — skip
    }
  }

  return hits
}

// telescopeFind returns filename hits plus content hits (capped).
async function telescopeFind(
  query: string,
  opts?: { root?: string; limit?: number; content?: boolean }
): Promise<TelescopeHit[]> {
  const root = opts?.root || ''
  const limit = opts?.limit ?? 50

  if (!root || !query.trim()) {
    return []
  }

  const files = await walkFiles(root, 5000)
  const needle = query.toLowerCase()
  const nameHits: TelescopeHit[] = []

  for (const abs of files) {
    if (nameHits.length >= limit) {
      break
    }

    const rel = relative(root, abs)

    if (rel.toLowerCase().includes(needle)) {
      nameHits.push({ path: rel, absPath: abs, kind: 'name' })
    }
  }

  if (opts?.content === false) {
    return nameHits.slice(0, limit)
  }

  let contentHits: TelescopeHit[] = []

  if (await hasRipgrep()) {
    contentHits = (await telescopeRgContent(query, root, limit)).map((h) => ({
      ...h,
      path: relative(root, h.absPath)
    }))
  } else {
    const walked = await telescopeWalkContent(query, files, limit)
    contentHits = walked.map((h) => ({ ...h, path: relative(root, h.absPath) }))
  }

  return [...nameHits, ...contentHits].slice(0, limit * 2)
}

// ---- Git auto-branch helpers (tasks view) -----------------------------------
function runGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoPath, ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || (err as Error).message))

        return
      }

      resolve(stdout.trim())
    })
  })
}

async function gitCurrentBranch(repoPath: string): Promise<{ branch: string; dirty: boolean }> {
  const branch = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await runGit(repoPath, ['status', '--porcelain'])

  return { branch, dirty: status.length > 0 }
}

async function gitCreateBranch(
  repoPath: string,
  name: string,
  base?: string
): Promise<{ branch: string; created: boolean }> {
  // If the branch already exists, just report it; otherwise create from base/HEAD.
  const existing = await runGit(repoPath, ['branch', '--list', name]).catch(() => '')

  if (existing.trim()) {
    await runGit(repoPath, ['checkout', name])

    return { branch: name, created: false }
  }

  const args = base ? ['checkout', '-b', name, base] : ['checkout', '-b', name]
  await runGit(repoPath, args)

  return { branch: name, created: true }
}

async function gitCheckoutBranch(repoPath: string, name: string): Promise<{ branch: string }> {
  await runGit(repoPath, ['checkout', name])

  return { branch: name }
}

// ---- Jira import -------------------------------------------------------------
// Pulls issues for the configured project via the Jira REST API and upserts them into
// the local tasks store (keyed by jiraKey so re-imports update instead of duplicating).
async function jiraImport(): Promise<Task[]> {
  const cfg = jiraGetConfig()

  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.token) {
    return []
  }

  const base = cfg.baseUrl.replace(/\/$/, '')
  const jql = encodeURIComponent(`project = ${cfg.project} ORDER BY updated DESC`)
  const url = `${base}/rest/api/2/search?jql=${jql}&maxResults=50&fields=summary,description,status`
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
  })

  if (!res.ok) {
    throw new Error(`Jira HTTP ${res.status}`)
  }

  const body = (await res.json()) as { issues?: { key: string; fields?: Record<string, unknown> }[] }
  const issues = body.issues ?? []
  const existing = tasksList(cfg.project)
  const byKey = new Map(existing.filter((t) => t.jiraKey).map((t) => [t.jiraKey as string, t]))

  for (const issue of issues) {
    const fields = (issue.fields ?? {}) as { summary?: string; description?: string; status?: { name?: string } }
    const statusName = (fields.status?.name || '').toLowerCase()
    const status = statusName.includes('done') || statusName.includes('closed')
      ? 'done'
      : statusName.includes('progress')
        ? 'doing'
        : 'todo'
    const prev = byKey.get(issue.key)

    tasksSave({
      id: prev?.id,
      title: fields.summary || issue.key,
      description: typeof fields.description === 'string' ? fields.description : '',
      status,
      jiraKey: issue.key,
      branch: prev?.branch,
      project: cfg.project
    })
  }

  return tasksList(cfg.project)
}

function registerIpc(win: BrowserWindow): void {
  ipcMain.handle('app:lastFolder', () => store.get('lastFolder', '') as string)

  // Zapamiętaj ostatnio otwarty projekt PRZY KAŻDEJ zmianie folderu (nie tylko z dialogu),
  // by po restarcie aplikacja sama wczytała ten projekt.
  ipcMain.handle('app:setLastFolder', (_e, folder: string) => {
    if (folder) {
      store.set('lastFolder', folder)
    }

    return true
  })

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

  // --- Generyczny stan sesji (lokalny SQLite) ---
  // Pełny snapshot sesji per projekt (aktywny widok, oba workspace'y edytorów, review),
  // by po ponownym otwarciu projektu sesja wyglądała identycznie.
  ipcMain.handle('state:get', (_e, key: string) => kvGet(key))
  ipcMain.handle('state:set', (_e, p: { key: string; value: unknown }) => {
    kvSet(p.key, p.value)

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

  // ---- Terminal PTY (view 6) ----
  // term:start spawns a PTY; output streams as term:data, exit as term:exit. When
  // node-pty is unavailable we emit a synthetic exit so the renderer can show a notice.
  ipcMain.on('term:start', (e, opts: { id: string; cwd?: string; cols?: number; rows?: number; shell?: string }) => {
    const mod = loadPty()

    if (!mod) {
      e.sender.send('term:exit', { id: opts.id, code: -1 })

      return
    }

    // Reuse-by-id: kill an existing PTY before re-spawning under the same id.
    const prev = ptys.get(opts.id)

    if (prev) {
      try {
        prev.kill()
      } catch {
        // already gone
      }

      ptys.delete(opts.id)
    }

    try {
      const proc = mod.spawn(opts.shell || defaultShell(), [], {
        name: 'xterm-color',
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: opts.cwd || homedir(),
        env: process.env
      })
      ptys.set(opts.id, proc)

      proc.onData((data) => {
        if (!e.sender.isDestroyed()) {
          e.sender.send('term:data', { id: opts.id, data })
        }
      })

      proc.onExit(({ exitCode }) => {
        ptys.delete(opts.id)

        if (!e.sender.isDestroyed()) {
          e.sender.send('term:exit', { id: opts.id, code: exitCode })
        }
      })
    } catch (err) {
      console.error('[pty] spawn failed:', (err as Error).message)
      e.sender.send('term:exit', { id: opts.id, code: -1 })
    }
  })

  ipcMain.on('term:write', (_e, p: { id: string; data: string }) => {
    const proc = ptys.get(p.id)

    if (proc) {
      try {
        proc.write(p.data)
      } catch {
        // pty already closed
      }
    }
  })

  ipcMain.on('term:resize', (_e, p: { id: string; cols: number; rows: number }) => {
    const proc = ptys.get(p.id)

    if (proc) {
      try {
        proc.resize(p.cols, p.rows)
      } catch {
        // pty already closed
      }
    }
  })

  ipcMain.on('term:kill', (_e, id: string) => {
    const proc = ptys.get(id)

    if (proc) {
      try {
        proc.kill()
      } catch {
        // already gone
      }

      ptys.delete(id)
    }
  })

  // ---- Web browser (view 7) ----
  // webviewTag is enabled at window creation; this toggle just records intent + reports
  // back so the renderer can gate webview creation. History is a main-side store.
  ipcMain.handle('browser:setEnabled', (_e, enabled: boolean) => {
    kvSet('browser:enabled', !!enabled)

    return !!enabled
  })

  ipcMain.handle('browser:navigate', (_e, p: { id: string; url: string }) => {
    const url = normalizeUrl(p.url)

    if (url) {
      pushBrowserHistory(p.id, url)
    }

    return { url }
  })

  ipcMain.handle('browser:history', (_e, id: string) => kvGet<BrowserEntry[]>(browserHistoryKey(id)) ?? [])

  // ---- React app runner (Run button on the code diagram) ----
  // detectApi: best-effort backend URL the app talks to. probe: is that URL answering now.
  ipcMain.handle('react:detectApi', async (_e, cwd: string) => ({ url: await detectApiUrl(cwd) }))
  ipcMain.handle('react:probe', async (_e, url: string) => ({ ok: await probeUrl(url) }))

  // react:run spawns the project's dev server in cwd and resolves with the local URL once the
  // dev server prints it (Vite/CRA banner). Re-running kills the previous server first.
  ipcMain.handle('react:run', async (_e, cwd: string) => {
    const pkg = await readPkg(cwd)

    if (!pkg) {
      throw new Error('no-package-json')
    }

    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    const script = scripts.dev ? 'dev' : scripts.start ? 'start' : ''

    if (!script) {
      throw new Error('no-dev-script')
    }

    killReactProc()

    const proc = spawn(detectPm(cwd), ['run', script], {
      cwd,
      detached: true,
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' }
    })
    reactProc = proc

    return await new Promise<{ url: string }>((resolve, reject) => {
      let settled = false
      let buf = ''
      let timer: ReturnType<typeof setTimeout>

      const finish = (url: string): void => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        resolve({ url })
      }

      const scan = (chunk: Buffer): void => {
        buf += stripAnsi(chunk.toString())
        const m = buf.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\/?/i)

        if (m) {
          finish(m[0].replace('0.0.0.0', 'localhost'))
        }
      }

      proc.stdout?.on('data', scan)
      proc.stderr?.on('data', scan)

      proc.on('error', (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      })

      proc.on('exit', (code) => {
        if (reactProc === proc) {
          reactProc = null
        }

        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error('dev-server-exited:' + code))
        }
      })

      // The server may be up but never print a parseable URL — after a grace period hand
      // back the framework's conventional dev URL so the browser can still try to load it.
      const fallback = JSON.stringify(pkg.devDependencies ?? {}).includes('vite')
        ? 'http://localhost:5173'
        : 'http://localhost:3000'
      timer = setTimeout(() => finish(fallback), 25000)
    })
  })

  ipcMain.handle('react:stop', () => {
    killReactProc()

    return true
  })

  // ---- Tasks store (view 4) ----
  ipcMain.handle('tasks:list', (_e, project: string) => tasksList(project ?? ''))
  ipcMain.handle('tasks:save', (_e, t: Parameters<typeof tasksSave>[0]) => tasksSave(t))
  ipcMain.handle('tasks:delete', (_e, id: number) => tasksDelete(id))
  ipcMain.handle('tasks:setActive', (_e, id: number) => tasksSetActive(id))
  ipcMain.handle('jira:getConfig', () => jiraGetConfig())
  ipcMain.handle('jira:setConfig', (_e, cfg: JiraConfig) => {
    jiraSetConfig(cfg)

    return true
  })
  ipcMain.handle('jira:import', () => jiraImport())

  // ---- Telescope finder (Esc+Space) ----
  ipcMain.handle('telescope:find', (_e, p: { query: string; opts?: { root?: string; limit?: number; content?: boolean } }) =>
    telescopeFind(p.query, p.opts)
  )

  // ---- Stats counters (topbar) ----
  ipcMain.handle('stats:get', () => statsGet())
  ipcMain.handle('stats:bump', (_e, p: { field: 'keystrokes' | 'lines' | 'tasks'; by?: number }) =>
    statsBump(p.field, p.by)
  )

  // ---- Git auto-branch (tasks view) ----
  ipcMain.handle('git:currentBranch', (_e, repoPath: string) => gitCurrentBranch(repoPath))
  ipcMain.handle('git:createBranch', (_e, p: { repoPath: string; name: string; base?: string }) =>
    gitCreateBranch(p.repoPath, p.name, p.base)
  )
  ipcMain.handle('git:checkoutBranch', (_e, p: { repoPath: string; name: string }) =>
    gitCheckoutBranch(p.repoPath, p.name)
  )

  // Kill all PTYs when the window goes away so we don't leak shell processes.
  win.on('closed', () => {
    for (const proc of ptys.values()) {
      try {
        proc.kill()
      } catch {
        // already gone
      }
    }

    ptys.clear()
    killReactProc()
  })
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
