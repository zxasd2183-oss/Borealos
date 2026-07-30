const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bar', {
  onStatus: (fn) => ipcRenderer.on('bar-status', (e, d) => fn(d)),
  action: (a) => ipcRenderer.send('bar-action', a),
});
