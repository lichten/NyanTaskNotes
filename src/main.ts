import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import Store from 'electron-store';
import { FileDatabase } from './fileDatabase';
import { registerIpcHandlers } from './ipc';
import { TaskDatabase } from './taskDatabase';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 5 * 1024 * 1024;

const store = new Store({
  defaults: {
    windowState: { isMaximized: false, width: 900, height: 640, x: undefined as any, y: undefined as any },
    fileDbPath: '',
    taskDbPath: '',
    taskFileAutoTagName: 'タスク'
  }
});

let fileDb: FileDatabase | null = null;
let taskDb: TaskDatabase | null = null;
let mainWindow: BrowserWindow | null = null;

function saveWindowState(): void {
  if (!mainWindow) return;
  const isMaximized = mainWindow.isMaximized();
  const b = mainWindow.getBounds();
  store.set('windowState', { isMaximized, width: b.width, height: b.height, x: b.x, y: b.y });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'メニュー',
      submenu: [
        { label: 'Top', click: () => mainWindow?.loadFile('index.html') },
        { label: '設定', click: () => mainWindow?.loadFile('settings.html') },
        { label: 'タグ編集', click: () => mainWindow?.loadFile('tag-manager.html') },
        { label: 'タスク設定一覧', click: () => mainWindow?.loadFile('task-settings.html') },
        { label: 'タスク表示', click: () => mainWindow?.loadFile('task-view.html') },
        { label: 'タスク編集', click: () => mainWindow?.loadFile('task-editor.html') },
        { label: 'タスク編集（新規/新画面）', click: () => mainWindow?.loadFile('task-editor2.html', { query: { new: '1' } }) }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  const windowState = store.get('windowState') as any;
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    if (windowState.isMaximized) mainWindow!.maximize();
    mainWindow!.show();
    // Open DevTools on startup
    try { mainWindow!.webContents.openDevTools({ mode: 'detach' }); } catch { /* noop */ }
  });
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  mainWindow.on('resize', () => { if (!mainWindow!.isMaximized()) saveWindowState(); });
  mainWindow.on('move', () => { if (!mainWindow!.isMaximized()) saveWindowState(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow(): BrowserWindow | null { return mainWindow; }

app.whenReady().then(async () => {
  try {
    const settings = store.store as any;

    // タスクDB（アプリ固有）は既定パスを用意して初期化
    try {
      let taskDbPath: string = settings.taskDbPath;
      if (!taskDbPath) {
        taskDbPath = path.join(app.getPath('userData'), 'tasks.sqlite3');
        store.set({ ...settings, taskDbPath });
      }
      taskDb = new TaskDatabase(taskDbPath);
      await taskDb.init();
      log.info('Task DB initialized:', taskDbPath);
    } catch (e) {
      log.error('Failed to init task DB:', e);
      taskDb = null;
    }

    // ファイルDB（外部ファイル管理）は任意設定
    const fileDbPath = settings.fileDbPath;
    if (fileDbPath) {
      fileDb = new FileDatabase(fileDbPath);
      await fileDb.init();
      log.info('File DB initialized:', fileDbPath);
    } else {
      log.info('File DB path not set yet.');
    }
  } catch (e) {
    log.error('Failed to init databases:', e);
    fileDb = null;
  }

  // Basic settings handlers (general purpose)
  ipcMain.handle('get-settings', async () => store.store);
  ipcMain.handle('save-settings', async (event, settings: any) => { store.set({ ...store.store, ...settings }); return { success: true }; });

  registerIpcHandlers({
    fileDb: () => fileDb,
    taskDb: () => taskDb,
    store,
    getMainWindow
  });

  createMenu();
  createWindow();
});

app.on('before-quit', async () => {
  saveWindowState();
  if (taskDb) {
    try { await taskDb.close(); } catch { /* noop */ }
  }
  if (fileDb) {
    try { await fileDb.close(); } catch { /* noop */ }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
