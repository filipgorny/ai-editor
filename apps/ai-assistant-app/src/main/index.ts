import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
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

let client: any

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    backgroundColor: '#0d1117',
    show: false,
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

  ipcMain.handle('file:read', (_e, absPath: string) => readFile(absPath, 'utf8'))

  ipcMain.handle('file:save', async (_e, payload: { path: string; content: string }) => {
    await writeFile(payload.path, payload.content, 'utf8')

    return true
  })

  // ai:edit — przez gateway → serwis ai (cały LLM jest w ai).
  ipcMain.handle('ai:edit', (_e, payload: { code: string; prompt: string; file: string }) =>
    new Promise((resolve, reject) => {
      client.AiEdit(
        { code: payload.code, prompt: payload.prompt, file: payload.file },
        (err: any, resp: any) => (err ? reject(err) : resolve(stripFence(resp?.code ?? '')))
      )
    })
  )

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
