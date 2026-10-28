/**
 * YumeRise Next — Electron main process.
 *
 * Loads the Vite-built web app (or the Vite dev server in development).
 * No product logic lives here; this is only the desktop shell.
 * CommonJS for reliable packaging with electron-builder.
 */

const { app, BrowserWindow, shell, Menu, dialog, Notification, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged && process.env.YUMERISE_DESKTOP_DEV === '1';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5180';

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getIconPath() {
  const candidates = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../public/icon.svg'),
    path.join(app.getAppPath(), 'public/icon.svg'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const icon = getIconPath();
  mainWindow = new BrowserWindow({
    title: 'Yumerise',
    width: 1280,
    height: 840,
    minWidth: 360,
    minHeight: 560,
    show: false,
    backgroundColor: '#f4f7fb',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:yumerise',
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = isDev ? DEV_URL : 'file://';
    if (!url.startsWith(appOrigin) && !url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    const indexHtml = path.join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'YumeRise on the web',
          click: () => shell.openExternal('https://yumerise.app'),
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle('desktop:get-path', (_event, name) => {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
});

ipcMain.handle('desktop:show-save-dialog', async (_event, options = {}) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  return dialog.showSaveDialog(win, {
    title: options.title || 'Save file',
    defaultPath: options.defaultPath,
    filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
});

ipcMain.handle('desktop:show-open-dialog', async (_event, options = {}) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  return dialog.showOpenDialog(win, {
    title: options.title || 'Open file',
    properties: options.properties || ['openFile'],
    filters: options.filters || [{ name: 'JSON', extensions: ['json'] }],
  });
});

ipcMain.handle('desktop:write-file', async (_event, filePath, data) => {
  if (typeof data === 'string' && data.startsWith('data:')) {
    const base64 = data.split(',')[1];
    await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
  } else if (typeof data === 'string') {
    await fs.promises.writeFile(filePath, data, 'utf8');
  } else if (Buffer.isBuffer(data)) {
    await fs.promises.writeFile(filePath, data);
  } else {
    throw new Error('Unsupported data type for write-file');
  }
  return true;
});

ipcMain.handle('desktop:notify', (_event, { title, body }) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: title || 'Yumerise', body: body || '' });
  n.show();
  return true;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
