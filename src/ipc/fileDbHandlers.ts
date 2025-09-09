import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import log from 'electron-log';
import type Store from 'electron-store';
import type { FileDatabase } from '../fileDatabase';

export function registerFileDbIpcHandlers(opts: {
  fileDb: () => FileDatabase | null;
  store: Store<any>;
  getMainWindow: () => BrowserWindow | null;
}): void {
  const { store, getMainWindow } = opts;
  const getFileDb = opts.fileDb;

  ipcMain.handle('show-file-dialog', async (event, options: any) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { canceled: true, filePaths: [] };
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('select-file-db-path', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'ファイルDBのSQLiteファイルを選択',
      defaultPath: app.getPath('userData'),
      properties: ['openFile', 'createDirectory'],
      filters: [
        { name: 'SQLite Database', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { filePath: null, canceled: true };
    }
    return { filePath: result.filePaths[0], canceled: false };
  });

  async function calculateFileSha256(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  ipcMain.handle('add-files-to-filedb', async (event, tagNames: string[] = []) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, message: 'no_main_window' };
    const fileDb = getFileDb();
    if (!fileDb) return { success: false, message: 'file_db_not_initialized' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'ファイルを選択',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths?.length) {
      return { success: false, message: 'canceled' };
    }
    let added = 0;
    let skipped = 0;
    for (const filePath of result.filePaths) {
      try {
        const sha256 = await calculateFileSha256(filePath);
        const folder = path.dirname(filePath);
        const name = path.basename(filePath);
        const existed = await fileDb.getFileInfoBySha256(sha256);
        const info = await fileDb.upsertFileInfoBySha256(folder, name, sha256);
        await fileDb.addTagsToFileByNames(info.ID!, tagNames || []);
        if (existed) skipped++; else added++;
      } catch (e) {
        log.error('ファイル登録エラー:', e);
        skipped++;
      }
    }
    return { success: true, added, skipped, total: result.filePaths.length };
  });

  ipcMain.handle('get-file-info-by-sha256', async (event, sha256: string) => {
    const fileDb = getFileDb();
    if (!fileDb) return null;
    return fileDb.getFileInfoBySha256(sha256);
  });

  ipcMain.handle('show-file-by-sha256', async (event, sha256: string) => {
    const fileDb = getFileDb();
    if (!fileDb) return { success: false, message: 'file_db_not_initialized' };
    const info = await fileDb.getFileInfoBySha256(sha256);
    if (!info) return { success: false, message: 'file_not_found' };
    const fullPath = path.join(info.FOLDER_PATH, info.FILE_NAME);
    if (!fs.existsSync(fullPath)) return { success: false, message: 'file_not_exists', filePath: fullPath };
    await shell.openPath(fullPath);
    return { success: true, filePath: fullPath };
  });

  ipcMain.handle('remove-tags-from-file', async (event, sha256: string, tags: string[]) => {
    const fileDb = getFileDb();
    if (!fileDb) return { success: false, message: 'file_db_not_initialized' };
    const info = await fileDb.getFileInfoBySha256(sha256);
    if (!info || !info.ID) return { success: false, message: 'file_not_found' };
    const removed = await fileDb.removeTagsFromFileByTagNames(info.ID, tags || []);
    return { success: true, removed };
  });
}

