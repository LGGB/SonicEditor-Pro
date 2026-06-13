const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Add any native functions here if needed in the future
  // For now, we are keeping it minimal for maximum security
});
