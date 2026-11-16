import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDatabase } from './database';
import { ProgressService } from './progress-service';
import { TaskService } from './task-service';
import { registerIPC } from './ipc';
import { SettingsService } from './settings-service';
import { CHANNELS, type Theme } from '../shared/contracts';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// An explicit data directory is useful for isolated integration tests and local development.
if (process.env.LIGHT_GANTT_DATA_DIR) app.setPath('userData', process.env.LIGHT_GANTT_DATA_DIR);

let mainWindow: BrowserWindow | null = null;
let database: ReturnType<typeof openDatabase> | null = null;
let settings: SettingsService;
const locked = app.requestSingleInstanceLock();

function applyTheme(theme: Theme): void {
  nativeTheme.themeSource = theme;
  mainWindow?.setBackgroundColor(theme === 'dark' ? '#181d1a' : '#f6f7f3');
}

function createWindow(): void {
  const theme = settings.getTheme();
  applyTheme(theme);
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 860,
    minHeight: 600,
    title: '轻甘特',
    show: false,
    backgroundColor: theme === 'dark' ? '#181d1a' : '#f6f7f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--light-gantt-theme=${theme}`],
    },
  });
  const window = mainWindow;
  window.once('ready-to-show', () => window.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

function openSettings(): void {
  if (!mainWindow) {
    createWindow();
    mainWindow!.webContents.once('did-finish-load', () => mainWindow?.webContents.send(CHANNELS.openSettings));
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(CHANNELS.openSettings);
  }
}

function applicationMenu(): Menu {
  const preferences: MenuItemConstructorOptions = { label: '配置…', accelerator: 'CmdOrCtrl+,', click: openSettings };
  const appMenu: MenuItemConstructorOptions =
    process.platform === 'darwin'
      ? {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            preferences,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }
      : { label: '应用', submenu: [preferences, { type: 'separator' }, { role: 'quit' }] };
  return Menu.buildFromTemplate([appMenu, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]);
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
      settings = new SettingsService(database, safeStorage);
      registerIPC(new TaskService(database), new ProgressService(database), settings, () => mainWindow, applyTheme);
      Menu.setApplicationMenu(applicationMenu());
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
