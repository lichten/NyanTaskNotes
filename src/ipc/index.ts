import type { BrowserWindow } from 'electron';
import type Store from 'electron-store';
import type { FileDatabase } from '../fileDatabase';
import type { TaskDatabase } from '../taskDatabase';
import { registerFileDbIpcHandlers } from './fileDbHandlers';
import { registerTaskIpcHandlers } from './taskHandlers';

export function registerIpcHandlers(opts: {
  fileDb: () => FileDatabase | null;
  taskDb: () => TaskDatabase | null;
  store: Store<any>;
  getMainWindow: () => BrowserWindow | null;
}): void {
  registerFileDbIpcHandlers(opts);
  registerTaskIpcHandlers(opts as any);
}
