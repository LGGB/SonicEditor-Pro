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
  
  // Open external links safely
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Si el proceso de renderizado falla, informar con el código técnico
  win.webContents.on('render-process-gone', (event, details) => {
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Aviso del Sistema',
      message: `El motor de audio se ha detenido (Código: ${details.exitCode})`,
      detail: 'Esto suele ocurrir si el audio es extremadamente largo o hay un conflicto de drivers. Intenta reiniciar la app.',
      buttons: ['Entendido']
    }).then(() => app.quit());
  });
}

// CONFIGURACIÓN ESTÁNDAR Y ESTABLE
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096'); // Suficiente con el ahorro de RAM

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
