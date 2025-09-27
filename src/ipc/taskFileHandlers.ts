import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import log from 'electron-log';
import type { TaskDatabase } from '../taskDatabase';
import type { FileDatabase } from '../fileDatabase';

interface TaskFileHandlerOptions {
  taskDb: () => TaskDatabase | null;
  fileDb: () => FileDatabase | null;
  getMainWindow: () => BrowserWindow | null;
}

type TaskFileEntry = {
  sha256: string;
  fileName?: string;
  folderPath?: string;
  filePath?: string;
  exists: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

function normalizeSha(value: string): string {
  return String(value || '').trim().toUpperCase();
}

async function calculateFileSha256(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

export function registerTaskFileHandlers(opts: TaskFileHandlerOptions): void {
  const { getMainWindow } = opts;
  const getTaskDb = opts.taskDb;
  const getFileDb = opts.fileDb;

  ipcMain.handle('task-files:list', async (_event, taskId: number) => {
    const taskDb = getTaskDb();
    if (!taskDb) {
      return { success: false, message: 'task_db_not_initialized', entries: [] as TaskFileEntry[] };
    }
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return { success: true, entries: [] as TaskFileEntry[] };
    }
    try {
      const rows = await taskDb.listTaskFileLinks(taskId);
      const fileDb = getFileDb();
      const entries: TaskFileEntry[] = [];
      for (const row of rows) {
        const sha = normalizeSha(row.fileSha256);
        let fileName: string | undefined;
        let folderPath: string | undefined;
        let fullPath: string | undefined;
        let exists = false;
        if (fileDb) {
          try {
            const info = await fileDb.getFileInfoBySha256(sha);
            if (info) {
              fileName = info.FILE_NAME;
              folderPath = info.FOLDER_PATH;
              if (folderPath && fileName) {
                fullPath = path.join(folderPath, fileName);
                exists = fs.existsSync(fullPath);
              }
            }
          } catch (err) {
            log.warn('task-files:list: failed to fetch file info', err);
          }
        }
        entries.push({
          sha256: sha,
          fileName,
          folderPath,
          filePath: fullPath,
          exists,
          createdAt: row.createdAt ?? null,
          updatedAt: row.updatedAt ?? null
        });
      }
      return { success: true, entries };
    } catch (error) {
      log.error('task-files:list failed', error);
      return { success: false, message: 'task_files_list_failed', entries: [] as TaskFileEntry[] };
    }
  });

  ipcMain.handle('task-files:set', async (_event, taskId: number, shaList: string[]) => {
    const taskDb = getTaskDb();
    if (!taskDb) {
      return { success: false, message: 'task_db_not_initialized' };
    }
    try {
      await taskDb.setTaskFileLinks(taskId, Array.isArray(shaList) ? shaList : []);
      return { success: true };
    } catch (error: any) {
      log.error('task-files:set failed', error);
      return { success: false, message: error?.message || 'task_files_set_failed' };
    }
  });

  ipcMain.handle('task-files:add-from-dialog', async (event, options: { allowMultiple?: boolean } = {}) => {
    const fileDb = getFileDb();
    if (!fileDb) {
      return { success: false, message: 'file_db_not_initialized', entries: [] as TaskFileEntry[] };
    }
    const mainWindow = getMainWindow() || BrowserWindow.fromWebContents(event.sender) || undefined;
    const dialogOptions: Electron.OpenDialogOptions = {
      title: '関連ファイルを選択',
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    };
    if (options.allowMultiple !== false) {
      dialogOptions.properties!.push('multiSelections');
    }
    let result: Electron.OpenDialogReturnValue;
    if (mainWindow) {
      result = await dialog.showOpenDialog(mainWindow, dialogOptions);
    } else {
      result = await dialog.showOpenDialog(dialogOptions);
    }
    if (result.canceled || !result.filePaths?.length) {
      return { success: false, message: 'canceled', entries: [] as TaskFileEntry[] };
    }
    const entries: TaskFileEntry[] = [];
    for (const filePath of result.filePaths) {
      try {
        const sha = normalizeSha(await calculateFileSha256(filePath));
        const folderPath = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const info = await fileDb.upsertFileInfoBySha256(folderPath, fileName, sha);
        entries.push({
          sha256: normalizeSha(info.SHA_256 || sha),
          fileName: info.FILE_NAME,
          folderPath: info.FOLDER_PATH,
          filePath,
          exists: fs.existsSync(filePath),
          createdAt: info.CREATED_AT ?? null,
          updatedAt: info.UPDATED_AT ?? null
        });
      } catch (error) {
        log.error('task-files:add-from-dialog failed', error);
      }
    }
    if (!entries.length) {
      return { success: false, message: 'no_entries', entries };
    }
    return { success: true, entries };
  });
}
