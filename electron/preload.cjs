// Ponte segura entre a página e o processo principal: só as operações de backup em pasta.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nativeApp', {
  savePdf: (name) => ipcRenderer.invoke('app:save-pdf', name),
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  setConfig: (patch) => ipcRenderer.invoke('app:set-config', patch),
  show: () => ipcRenderer.invoke('app:show'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  updateState: () => ipcRenderer.invoke('app:update-state'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateState: (cb) => ipcRenderer.on('app:update-state', (_e, s) => cb(s)),
})

contextBridge.exposeInMainWorld('nativeBackup', {
  info: () => ipcRenderer.invoke('backup:info'),
  set: (patch) => ipcRenderer.invoke('backup:set', patch),
  connect: (provider) => ipcRenderer.invoke('backup:connect', provider),
  write: (name, data) => ipcRenderer.invoke('backup:write', name, data),
  read: (name) => ipcRenderer.invoke('backup:read', name),
  open: () => ipcRenderer.invoke('backup:open'),
  onBeforeClose: (cb) => ipcRenderer.on('backup:before-close', () => cb()),
  closedOk: () => ipcRenderer.send('backup:closed-ok'),
})
