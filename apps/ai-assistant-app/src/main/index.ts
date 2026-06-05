import { join, dirname } from 'path'
import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import Store from 'electron-store'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

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

let client: any

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    backgroundColor: '#0d1117',
    show: false,
    autoHideMenuBar: true,
    title: 'Avier',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

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

  // settings — preferencje (m.in. dostawca modelu) w electron-store.
  ipcMain.handle('settings:get', () => store.get('settings', { provider: 'ollama' }))
  ipcMain.handle('settings:set', (_e, s: { provider: string }) => {
    store.set('settings', s)

    return true
  })

  // oauth:claude — start logowania do subskrypcji Claude Code (otwiera przeglądarkę).
  // UWAGA: wymiana tokenu i przełączenie providera w serwisie ai to osobny backend.
  ipcMain.handle('oauth:claude', async () => {
    await shell.openExternal('https://claude.ai/login')

    return true
  })

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

  ipcMain.handle('file:delete', async (_e, path: string) => (await call('DeletePath', { path })).ok ?? false)

  // --- Przeglądanie dysku / szukanie projektów: przez gateway → filer ---
  ipcMain.handle('fs:home', async () => (await call('HomeDir', {})).path ?? '')
  ipcMain.handle('fs:list', (_e, path: string) => call('ListDir', { path }))
  ipcMain.handle('fs:find', (_e, path: string) => call('FindProjects', { path }))
  ipcMain.handle('fs:conventions', (_e, path: string) => call('DetectConventions', { path }))

  // --- ai:agent — agent plików: ai PLANUJE, gateway (filer) WYKONUJE ---
  ipcMain.handle('ai:agent', (_e, p: { prompt: string; dir: string }) => call('AiAgent', p))

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

  ipcMain.handle('ai:review', (_e, payload: { code: string; file: string }) =>
    new Promise((resolve, reject) => {
      client.AiReview({ code: payload.code, file: payload.file }, (err: any, resp: any) =>
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
