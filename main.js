const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');

function checkDependencies() {
  // Comprobar si Node.js existe en el sistema
  exec('node -v', (error) => {
    if (error) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Dependencia Faltante',
        message: 'Node.js LTS no está instalado en este sistema.',
        detail: 'SonicEditor Pro requiere Node.js para ciertas funciones avanzadas. ¿Deseas ir a la página de descarga oficial ahora?',
        buttons: ['Descargar Node.js', 'Más tarde'],
        defaultId: 0
      }).then((result) => {
        if (result.response === 0) {
          shell.openExternal('https://nodejs.org/');
        }
      });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f0f12',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  
  // Strict Content Security Policy implementation
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' data: blob:;"
        ]
      }
    });
  });

  // Open external links in real browser (though we block all outgoing traffic)
  win.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });

  // Si el proceso de renderizado falla, informar al usuario en lugar de dejar la pantalla en negro
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details.reason);
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Error de Aplicación',
      message: 'El procesador de audio ha colapsado por falta de memoria.',
      detail: 'Intenta cerrar otras aplicaciones o usar un archivo de audio más pequeño. El programa se cerrará ahora.',
      buttons: ['Entendido']
    }).then(() => app.quit());
  });
}

// CRÍTICO: Desactivar aceleración por hardware para evitar fallos de GPU (Pantallas negras) en Windows
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  checkDependencies();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
