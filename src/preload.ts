import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  selectFileDbPath: () => ipcRenderer.invoke('select-file-db-path'),

  // File dialog
  showFileDialog: (options: any) => ipcRenderer.invoke('show-file-dialog', options),

  // File DB operations
  addFilesToFileDb: (tagNames: string[]) => ipcRenderer.invoke('add-files-to-filedb', tagNames),
  getFileInfoBySha256: (sha256: string) => ipcRenderer.invoke('get-file-info-by-sha256', sha256),
  showFileBySha256: (sha256: string) => ipcRenderer.invoke('show-file-by-sha256', sha256),
  removeTagsFromFile: (sha256: string, tags: string[]) => ipcRenderer.invoke('remove-tags-from-file', sha256, tags)
});

declare global {
  interface Window {
    electronAPI: {
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<{ success: boolean }>;
      selectFileDbPath: () => Promise<{ filePath: string | null; canceled: boolean }>;
      showFileDialog: (options: any) => Promise<any>;
      addFilesToFileDb: (tagNames: string[]) => Promise<{ success: boolean; added?: number; skipped?: number; total?: number; message?: string }>;
      getFileInfoBySha256: (sha256: string) => Promise<any>;
      showFileBySha256: (sha256: string) => Promise<{ success: boolean; filePath?: string; message?: string }>;
      removeTagsFromFile: (sha256: string, tags: string[]) => Promise<{ success: boolean; removed?: number; message?: string }>;
    };
  }
}

