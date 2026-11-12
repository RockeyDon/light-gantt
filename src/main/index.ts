import { app, BrowserWindow, dialog, Menu } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDatabase } from './database';
import { TaskService } from './task-service';
import { registerTaskIPC } from './ipc';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// An explicit data directory is useful for isolated integration tests and local development.
if (process.env.LIGHT_GANTT_DATA_DIR) app.setPath('userData', process.env.LIGHT_GANTT_DATA_DIR);

let mainWindow: BrowserWindow | null = null;
let database: ReturnType<typeof openDatabase> | null = null;
const locked = app.requestSingleInstanceLock();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 860,
    minHeight: 600,
    title: '轻甘特',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

if (!locked) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  void app.whenReady().then(() => {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true });
      database = openDatabase(path.join(app.getPath('userData'), 'gantt.sqlite'));
      registerTaskIPC(new TaskService(database), () => mainWindow);
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
      createWindow();
      app.on('activate', () => {
        if (!mainWindow) createWindow();
      });
    } catch (error) {
      dialog.showErrorBox('轻甘特无法启动', error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    database?.close();
    database = null;
  });
}
