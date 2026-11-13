const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  isElectron: true,
  platform: process.platform,
  open: () => ipcRenderer.invoke('studio:open'),
  saveText: (defaultName, text) => ipcRenderer.invoke('studio:save-text', { defaultName, text }),
  saveBinary: (defaultName, base64) => ipcRenderer.invoke('studio:save-binary', { defaultName, base64 }),
  onImport: (cb) => { ipcRenderer.removeAllListeners('studio:import'); ipcRenderer.on('studio:import', (_e, payload) => cb(payload)); },
  onMenu: (cb) => { ipcRenderer.removeAllListeners('studio:menu'); ipcRenderer.on('studio:menu', (_e, action) => cb(action)); },
});
