const { contextBridge, ipcRenderer: ipc } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipc.invoke('load'),
  save: d => ipc.invoke('save', d),
  reset: () => ipc.invoke('reset'),
  log: () => ipc.invoke('log'),
  restore: h => ipc.invoke('restore', h),
  exportFile: (kind, name, md) => ipc.invoke('export', kind, name, md),
  exportJson: (name, data) => ipc.invoke('exportJson', name, data),
  importJson: () => ipc.invoke('importJson'),
  clip: t => ipc.invoke('clip', t)
});
