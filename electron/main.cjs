// Processo principal do Electron: abre o app compilado (dist/) em uma janela própria, sem servidor.
const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const backup = require('./backup.cjs')

const DIST = path.join(__dirname, '..', 'dist')
const ICON = path.join(__dirname, 'icon.png')

// Esquema próprio "app://" — origem estável e segura (IndexedDB, workers e módulos ES funcionam como em https).
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

if (!app.requestSingleInstanceLock()) app.quit()
// necessário para as notificações do Windows aparecerem com o nome e o ícone do app
app.setAppUserModelId('local.notepad.everywhere')

let win = null
let tray = null
let quitting = false

/* ---------- Preferências do processo principal (segundo plano / iniciar com o Windows) ---------- */
const cfgPath = () => path.join(app.getPath('userData'), 'app-config.json')
let appCfg = null
function loadCfg() {
  if (!appCfg) {
    try {
      appCfg = { background: false, startup: false, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }
    } catch {
      appCfg = { background: false, startup: false }
    }
  }
  return appCfg
}
function saveCfg() {
  try {
    fs.writeFileSync(cfgPath(), JSON.stringify(appCfg, null, 1))
  } catch {}
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Ícone ao lado do relógio: mantém lembretes e Pomodoro funcionando com a janela fechada. */
function syncTray() {
  const want = loadCfg().background
  if (want && !tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
    tray.setToolTip('Notepad Everywhere')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir o Notepad Everywhere', click: showWindow },
        { type: 'separator' },
        {
          label: 'Sair',
          click: () => {
            quitting = true
            if (win) win.close()
            else app.quit()
          },
        },
      ]),
    )
    tray.on('click', showWindow)
  } else if (!want && tray) {
    tray.destroy()
    tray = null
  }
}

function createWindow() {
  const startHidden = process.argv.includes('--hidden') && loadCfg().background
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: !startHidden,
    backgroundColor: '#0a0c11',
    autoHideMenuBar: true,
    title: 'Notepad Everywhere',
    icon: ICON,
    // backgroundThrottling: false → timers (lembretes, Pomodoro) continuam certos com a janela oculta
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  })
  // Ao fechar: faz o backup (se ligado) e então esconde na bandeja ou encerra de verdade.
  backup.guardClose(win, () => {
    if (!quitting && loadCfg().background) win.hide()
    else win.destroy()
  })
  win.setMenuBarVisibility(false)

  // links externos abrem no navegador padrão; blobs (botão "Abrir" de arquivos) abrem em janela simples
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return url.startsWith('blob:') ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } } : { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !url.startsWith('http://localhost')) e.preventDefault()
  })

  if (process.env.ELECTRON_DEV_URL) win.loadURL(process.env.ELECTRON_DEV_URL)
  else win.loadURL('app://notepad/')
  win.on('closed', () => (win = null))
}

app.on('second-instance', showWindow)
app.on('before-quit', () => (quitting = true))

/* ---------- Atualização automática (GitHub Releases) ---------- */
let updater = null
let updateState = { status: 'idle', version: null, message: '' }
function setupUpdater() {
  try {
    updater = require('electron-updater').autoUpdater
  } catch {
    updateState = { status: 'unavailable', version: null, message: 'Módulo de atualização ausente.' }
    return
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  const push = (s) => {
    updateState = { ...updateState, ...s }
    if (win && !win.isDestroyed()) win.webContents.send('app:update-state', updateState)
  }
  updater.on('checking-for-update', () => push({ status: 'checking', message: '' }))
  updater.on('update-available', (i) => push({ status: 'downloading', version: i.version }))
  updater.on('update-not-available', () => push({ status: 'none' }))
  updater.on('update-downloaded', (i) => push({ status: 'ready', version: i.version }))
  updater.on('error', (e) => push({ status: 'error', message: String((e && e.message) || e).slice(0, 300) }))
}
async function checkUpdate() {
  if (!updater) return updateState
  if (!app.isPackaged) return { status: 'unavailable', version: null, message: 'Só funciona no app instalado.' }
  // sem "publish" configurado no build não existe app-update.yml — atualização desligada
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return (updateState = { status: 'unconfigured', version: null, message: '' })
  try {
    await updater.checkForUpdates()
  } catch (e) {
    updateState = { status: 'error', version: null, message: String((e && e.message) || e).slice(0, 300) }
  }
  return updateState
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname)
    if (p === '/' || p === '') p = '/index.html'
    const file = path.normalize(path.join(DIST, p))
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  backup.setup(() => win)

  // "Salvar como PDF": usa o layout de impressão da página (CSS @media print)
  ipcMain.handle('app:save-pdf', async (e, name) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Salvar como PDF',
      defaultPath: path.join(app.getPath('documents'), String(name || 'notas').replace(/[\\/:*?"<>|]/g, '_') + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, reason: 'canceled' }
    try {
      const data = await e.sender.printToPDF({ printBackground: true, preferCSSPageSize: true })
      fs.writeFileSync(r.filePath, data)
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, reason: String(err.message || err) }
    }
  })

  ipcMain.handle('app:get-config', () => ({ ...loadCfg(), version: app.getVersion() }))
  ipcMain.handle('app:set-config', (_e, patch) => {
    loadCfg()
    if (patch && typeof patch.background === 'boolean') appCfg.background = patch.background
    if (patch && typeof patch.startup === 'boolean') {
      appCfg.startup = patch.startup
      app.setLoginItemSettings({ openAtLogin: patch.startup, args: ['--hidden'] })
    }
    saveCfg()
    syncTray()
    return { ...appCfg, version: app.getVersion() }
  })
  ipcMain.handle('app:show', () => showWindow())
  ipcMain.handle('app:check-update', () => checkUpdate())
  ipcMain.handle('app:update-state', () => updateState)
  ipcMain.handle('app:install-update', () => {
    if (updater && updateState.status === 'ready') {
      quitting = true
      updater.quitAndInstall()
    }
  })

  setupUpdater()
  createWindow()
  syncTray()
  // procura atualização alguns segundos depois de abrir
  setTimeout(() => checkUpdate().catch(() => {}), 15000)
})

app.on('window-all-closed', () => app.quit())
