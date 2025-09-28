import { app, dialog, ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import type Store from 'electron-store';
import type { TaskDatabase } from '../taskDatabase';
import * as path from 'path';

export function registerTaskIpcHandlers(opts: {
  taskDb: () => TaskDatabase | null;
  store: Store<any>;
  getMainWindow: () => BrowserWindow | null;
}): void {
  const getTaskDb = opts.taskDb;
  const { getMainWindow } = opts;

  // Select task DB path (similar to file DB)
  ipcMain.handle('select-task-db-path', async () => {
    const mainWindow = getMainWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'タスクDBのSQLiteファイルを選択',
      defaultPath: app.getPath('userData'),
      properties: ['openFile', 'createDirectory'],
      filters: [
        { name: 'SQLite Database', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { filePath: null, canceled: true };
    }
    return { filePath: result.filePaths[0], canceled: false };
  });

  ipcMain.handle('tasks:list', async (_event, params: { query?: string; status?: string } = {}) => {
    const db = getTaskDb();
    if (!db) return [];
    try {
      return await db.listTasks(params);
    } catch (e) {
      log.error('tasks:list error', e);
      throw e;
    }
  });

  ipcMain.handle('tasks:get', async (_event, id: number) => {
    const db = getTaskDb();
    if (!db) return null;
    try {
      return await db.getTask(id);
    } catch (e) {
      log.error('tasks:get error', e);
      throw e;
    }
  });

  ipcMain.handle('tasks:create', async (_event, payload: any) => {
    const db = getTaskDb();
    if (!db) return { success: false };
    try {
      const id = await db.createTask(payload);
      return { success: true, id };
    } catch (e) {
      log.error('tasks:create error', e);
      throw e;
    }
  });

  ipcMain.handle('tasks:update', async (_event, id: number, payload: any) => {
    const db = getTaskDb();
    if (!db) return { success: false };
    try {
      await db.updateTask(id, payload);
      return { success: true };
    } catch (e) {
      log.error('tasks:update error', e);
      throw e;
    }
  });

  ipcMain.handle('tasks:delete', async (_event, id: number) => {
    const db = getTaskDb();
    if (!db) return { success: false };
    try {
      await db.deleteTask(id);
      return { success: true };
    } catch (e) {
      log.error('tasks:delete error', e);
      throw e;
    }
  });

  // Occurrences
  ipcMain.handle('occ:list', async (_event, params: { from?: string; to?: string; query?: string; status?: string } = {}) => {
    const db = getTaskDb();
    if (!db) return [];
    try {
      return await (db as any).listOccurrences(params);
    } catch (e) {
      log.error('occ:list error', e);
      throw e;
    }
  });

  ipcMain.handle('occ:complete', async (_event, id: number, options?: { comment?: string; completedAt?: string }) => {
    const db = getTaskDb();
    if (!db) return { success: false };
    try {
      await (db as any).completeOccurrence(id, options || {});
      return { success: true };
    } catch (e) {
      log.error('occ:complete error', e);
      throw e;
    }
  });

  ipcMain.handle('occ:defer', async (_event, id: number, newDate?: string | null) => {
    const db = getTaskDb();
    if (!db) return { success: false };
    try {
      await (db as any).deferOccurrence(id, newDate ?? null);
      return { success: true };
    } catch (e) {
      log.error('occ:defer error', e);
      throw e;
    }
  });

  // Task tag helpers
  ipcMain.handle('task-tags:list', async () => {
    const db = getTaskDb();
    if (!db) return [];
    try {
      return await (db as any).listAllTags();
    } catch (e) {
      log.error('task-tags:list error', e);
      throw e;
    }
  });

  ipcMain.handle('task-tags:list-infos', async () => {
    const db = getTaskDb();
    if (!db) return [];
    try {
      return await (db as any).listTagInfos();
    } catch (e) {
      log.error('task-tags:list-infos error', e);
      throw e;
    }
  });

  ipcMain.handle('task-tags:rename', async (_event, id: number, name: string) => {
    const db = getTaskDb();
    if (!db) return { success: false, message: 'タスクDBが初期化されていません' };
    try {
      await (db as any).renameTag(id, name);
      return { success: true };
    } catch (e: any) {
      log.error('task-tags:rename error', e);
      return { success: false, message: e?.message || 'タグ名の更新に失敗しました' };
    }
  });

  // Task events (logs)
  ipcMain.handle('events:list', async (_event, params: { taskId: number; limit?: number } ) => {
    const db = getTaskDb();
    if (!db) return [];
    try {
      const { taskId, limit } = params || ({} as any);
      if (!taskId) return [];
      return await (db as any).listTaskEvents({ taskId, limit: limit ?? 10 });
    } catch (e) {
      log.error('events:list error', e);
      throw e;
    }
  });

  // Simple text prompt using electron-prompt
  ipcMain.handle('prompt:text', async (event, opts: { title?: string; label?: string; placeholder?: string; ok?: string; cancel?: string }) => {
    const parent = getMainWindow() || BrowserWindow.fromWebContents(event.sender) || undefined;
    try {
      const mod = await import('electron-prompt' as any);
      const promptFn: any = (mod as any).default || (mod as any);
      const result = await promptFn({
        title: opts?.title ?? '入力',
        label: opts?.label ?? '入力',
        inputAttrs: { type: 'text', placeholder: opts?.placeholder ?? '' },
        buttonLabels: { ok: opts?.ok ?? 'OK', cancel: opts?.cancel ?? 'キャンセル' }
      }, parent as any);
      return (typeof result === 'string') ? result : null;
    } catch (e) {
      log.error('prompt:text error', e);
      return null;
    }
  });
}
