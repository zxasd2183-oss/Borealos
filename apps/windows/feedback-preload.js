const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("BorealosFeedbackBridge", Object.freeze({
  captureCurrentWindow: () => ipcRenderer.invoke("feedback:capture-current-window"),
}));
