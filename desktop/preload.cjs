/**
 * Preload script — exposes a minimal, safe desktop API to the renderer.
 * contextIsolation is on; nodeIntegration is off.
 * CommonJS for maximum Electron preload compatibility.
 *
 * Existing web code continues to work unchanged. This bridge is optional:
 * features can detect window.yumeriseDesktop and use native dialogs when present.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yumeriseDesktop', {
  isDesktop: true,
  platform: process.platform,

  getPath: (name) => ipcRenderer.invoke('desktop:get-path', name),

  showSaveDialog: (options) => ipcRenderer.invoke('desktop:show-save-dialog', options),

  showOpenDialog: (options) => ipcRenderer.invoke('desktop:show-open-dialog', options),

  writeFile: (filePath, data) => ipcRenderer.invoke('desktop:write-file', filePath, data),

  notify: (opts) => ipcRenderer.invoke('desktop:notify', opts),
});
