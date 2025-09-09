import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import type Store from 'electron-store';
import type { TaskDatabase } from '../taskDatabase';

export function registerTaskIpcHandlers(opts: {
  taskDb: () => TaskDatabase | null;
  store: Store<any>;
  getMainWindow: () => BrowserWindow | null;
}): void {
  const getTaskDb = opts.taskDb;

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
}

