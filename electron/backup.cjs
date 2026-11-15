// Backup automático em pasta sincronizada (OneDrive / Google Drive / qualquer pasta).
const { app, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SUBFOLDER = 'Notepad Everywhere Backups'
const NAME_RE = /^notepad-backup-[\w-]+\.zip$/
const DEFAULTS = { folder: null, provider: null, onClose: true, everyMin: 30, keep: 10 }

const cfgPath = () => path.join(app.getPath('userData'), 'backup-config.json')
let config = null
function load() {
  if (!config) {
    try {
      config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }
    } catch {
      config = { ...DEFAULTS }
    }
  }
  return config
}
function save() {
  fs.writeFileSync(cfgPath(), JSON.stringify(config, null, 1))
}
const isDir = (p) => {
  try {
    return !!p && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Localiza as pastas locais que os clientes de nuvem mantêm sincronizadas. */
function detect() {
  const oneDrive = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(app.getPath('home'), 'OneDrive')].find(isDir) || null
  const gCandidates = []
  for (const name of ['Meu Drive', 'My Drive']) {
    for (let c = 68; c <= 90; c++) gCandidates.push(`${String.fromCharCode(c)}:\\${name}`) // unidade virtual do Google Drive (D: … Z:)
    gCandidates.push(path.join(app.getPath('home'), name))
  }
  gCandidates.push(path.join(app.getPath('home'), 'Google Drive'))
  const gdrive = gCandidates.find(isDir) || null
  return { onedrive: oneDrive, gdrive }
}

function list() {
  const { folder } = load()
  if (!isDir(folder)) return []
  return fs
    .readdirSync(folder)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(folder, name))
      return { name, size: st.size, mtime: st.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function setup(getWindow) {
  ipcMain.handle('backup:info', () => {
    const c = load()
    return { config: c, detected: detect(), folderOk: isDir(c.folder), files: list() }
  })

  ipcMain.handle('backup:set', (_e, patch) => {
    load()
    for (const k of ['onClose', 'everyMin', 'keep']) if (patch && k in patch) config[k] = patch[k]
    if (patch && patch.folder === null) {
      config.folder = null
      config.provider = null
    }
    save()
    return config
  })

  // "Conectar OneDrive" / "Conectar Google Drive" / "Outra pasta…"
  ipcMain.handle('backup:connect', async (_e, provider) => {
    load()
    let base = null
    if (provider === 'onedrive' || provider === 'gdrive') {
      base = detect()[provider]
      if (!base) return { ok: false, reason: 'not-found' }
    } else if (provider === 'local') {
      base = app.getPath('documents') // para quem não usa nuvem: Documentos
    } else {
      const r = await dialog.showOpenDialog(getWindow(), { title: 'Escolha a pasta para os backups', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return { ok: false, reason: 'canceled' }
      base = r.filePaths[0]
    }
    const folder = path.basename(base) === SUBFOLDER ? base : path.join(base, SUBFOLDER)
    try {
      fs.mkdirSync(folder, { recursive: true })
    } catch (err) {
      return { ok: false, reason: String(err.message || err) }
    }
    config.folder = folder
    config.provider = ['onedrive', 'gdrive', 'local'].includes(provider) ? provider : 'custom'
    save()
    return { ok: true, folder }
  })

  ipcMain.handle('backup:write', (_e, name, data) => {
    const c = load()
    if (!NAME_RE.test(name)) throw new Error('Nome de backup inválido')
    if (!c.folder) throw new Error('Nenhuma pasta de backup conectada')
    fs.mkdirSync(c.folder, { recursive: true })
    const dest = path.join(c.folder, name)
    const tmp = dest + '.tmp'
    fs.writeFileSync(tmp, Buffer.from(data))
    fs.renameSync(tmp, dest)
    // mantém só os N mais recentes
    const all = list()
    for (const old of all.slice(Math.max(1, c.keep))) {
      try {
        fs.unlinkSync(path.join(c.folder, old.name))
      } catch {}
    }
    return { name, files: list() }
  })

  ipcMain.handle('backup:read', (_e, name) => {
    const c = load()
    if (!NAME_RE.test(name) || !c.folder) throw new Error('Backup inválido')
    return fs.readFileSync(path.join(c.folder, name))
  })

  ipcMain.handle('backup:open', () => {
    const c = load()
    if (isDir(c.folder)) shell.openPath(c.folder)
  })
}

/** Ao fechar a janela: pede à página um último backup e só então encerra. */
function guardClose(win, finish) {
  // `finish` decide o que fazer depois do backup: esconder na bandeja ou encerrar (win.destroy não reemite "close").
  let pending = false
  let timer = null
  const done = () => {
    if (!pending) return
    pending = false
    clearTimeout(timer)
    if (!win.isDestroyed()) finish()
  }
  win.on('close', (e) => {
    e.preventDefault()
    if (pending) return
    const c = load()
    if (c.folder && c.onClose) {
      pending = true
      win.webContents.send('backup:before-close')
      timer = setTimeout(done, 20000) // nunca prende o usuário
    } else finish()
  })
  ipcMain.on('backup:closed-ok', (e) => {
    if (!win.isDestroyed() && e.sender === win.webContents) done()
  })
}

module.exports = { setup, guardClose }
