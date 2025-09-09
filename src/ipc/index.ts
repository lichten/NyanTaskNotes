import type { BrowserWindow } from 'electron';
import type Store from 'electron-store';
import type { FileDatabase } from '../fileDatabase';
import { registerFileDbIpcHandlers } from './fileDbHandlers';

export function registerIpcHandlers(opts: {
  fileDb: () => FileDatabase | null;
  store: Store<any>;
  getMainWindow: () => BrowserWindow | null;
}): void {
  registerFileDbIpcHandlers(opts);
}

