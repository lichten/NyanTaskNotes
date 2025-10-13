import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  selectFileDbPath: () => ipcRenderer.invoke('select-file-db-path'),
  selectTaskDbPath: () => ipcRenderer.invoke('select-task-db-path'),

  // File dialog
  showFileDialog: (options: any) => ipcRenderer.invoke('show-file-dialog', options),

  // File DB operations
  addFilesToFileDb: (tagNames: string[]) => ipcRenderer.invoke('add-files-to-filedb', tagNames),
  getFileInfoBySha256: (sha256: string) => ipcRenderer.invoke('get-file-info-by-sha256', sha256),
  showFileBySha256: (sha256: string) => ipcRenderer.invoke('show-file-by-sha256', sha256),
  removeTagsFromFile: (sha256: string, tags: string[]) => ipcRenderer.invoke('remove-tags-from-file', sha256, tags)
  ,
  // Task file links
  listTaskFiles: (taskId: number) => ipcRenderer.invoke('task-files:list', taskId),
  setTaskFiles: (taskId: number, shaList: string[]) => ipcRenderer.invoke('task-files:set', taskId, shaList),
  pickTaskFiles: (options?: { allowMultiple?: boolean }) => ipcRenderer.invoke('task-files:add-from-dialog', options || {})
  ,
  // Tasks
  listTasks: (params?: any) => ipcRenderer.invoke('tasks:list', params || {}),
  getTask: (id: number) => ipcRenderer.invoke('tasks:get', id),
  createTask: (payload: any) => ipcRenderer.invoke('tasks:create', payload),
  updateTask: (id: number, payload: any) => ipcRenderer.invoke('tasks:update', id, payload),
  deleteTask: (id: number) => ipcRenderer.invoke('tasks:delete', id)
  ,
  // Occurrences
  listOccurrences: (params?: any) => ipcRenderer.invoke('occ:list', params || {}),
  completeOccurrence: (id: number, options?: { comment?: string; completedAt?: string; manualNextDue?: string }) => ipcRenderer.invoke('occ:complete', id, options || {}),
  deferOccurrence: (id: number, newDate?: string | null) => ipcRenderer.invoke('occ:defer', id, newDate ?? null),
  prunePastOccurrences: (taskId: number) => ipcRenderer.invoke('occ:prune-past', taskId),
  listOccurrencesByTask: (taskId: number) => ipcRenderer.invoke('occ:list-by-task', taskId),
  setOccurrenceStatus: (occurrenceId: number, status: 'pending' | 'done') => ipcRenderer.invoke('occ:set-status', occurrenceId, status)
  ,
  // Task tags
  listTaskTags: () => ipcRenderer.invoke('task-tags:list'),
  listTaskTagInfos: () => ipcRenderer.invoke('task-tags:list-infos'),
  renameTaskTag: (id: number, name: string) => ipcRenderer.invoke('task-tags:rename', id, name)
  ,
  // Events (logs)
  listEvents: (params: { taskId: number; limit?: number }) => ipcRenderer.invoke('events:list', params)
  ,
  // Prompt
  promptText: (options: { title?: string; label?: string; placeholder?: string; ok?: string; cancel?: string }) => ipcRenderer.invoke('prompt:text', options || {})
});

declare global {
  interface Window {
    electronAPI: {
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<{ success: boolean }>;
      selectFileDbPath: () => Promise<{ filePath: string | null; canceled: boolean }>;
      selectTaskDbPath: () => Promise<{ filePath: string | null; canceled: boolean }>;
      showFileDialog: (options: any) => Promise<any>;
      addFilesToFileDb: (tagNames: string[]) => Promise<{ success: boolean; added?: number; skipped?: number; total?: number; message?: string }>;
      getFileInfoBySha256: (sha256: string) => Promise<any>;
      showFileBySha256: (sha256: string) => Promise<{ success: boolean; filePath?: string; message?: string }>;
      removeTagsFromFile: (sha256: string, tags: string[]) => Promise<{ success: boolean; removed?: number; message?: string }>;
      listTaskFiles: (taskId: number) => Promise<{ success: boolean; entries: Array<{ sha256: string; fileName?: string; folderPath?: string; filePath?: string; exists: boolean; createdAt: string | null; updatedAt: string | null }>; message?: string }>;
      setTaskFiles: (taskId: number, shaList: string[]) => Promise<{ success: boolean; message?: string }>;
      pickTaskFiles: (options?: { allowMultiple?: boolean }) => Promise<{ success: boolean; entries: Array<{ sha256: string; fileName?: string; folderPath?: string; filePath?: string; exists: boolean; createdAt: string | null; updatedAt: string | null }>; message?: string }>;
      listTasks: (params?: any) => Promise<any[]>;
      getTask: (id: number) => Promise<any>;
      createTask: (payload: any) => Promise<{ success: boolean; id?: number }>;
      updateTask: (id: number, payload: any) => Promise<{ success: boolean }>;
      deleteTask: (id: number) => Promise<{ success: boolean }>;
      listOccurrences: (params?: any) => Promise<any[]>;
      completeOccurrence: (id: number, options?: { comment?: string; completedAt?: string; manualNextDue?: string }) => Promise<{ success: boolean }>;
      deferOccurrence: (id: number, newDate?: string | null) => Promise<{ success: boolean }>;
      prunePastOccurrences: (taskId: number) => Promise<{ success: boolean; removed?: number; keptOccurrenceId?: number | null; totalMatched?: number; skippedManualNext?: boolean; message?: string }>;
      listOccurrencesByTask: (taskId: number) => Promise<{ success: boolean; records?: Array<{ occurrenceId: number; taskId: number; status: string; scheduledDate: string | null; scheduledTime: string | null; deferredDate: string | null; completedAt: string | null; createdAt: string | null; updatedAt: string | null }>; message?: string }>;
      setOccurrenceStatus: (occurrenceId: number, status: 'pending' | 'done') => Promise<{ success: boolean; message?: string }>;
      listTaskTags: () => Promise<string[]>;
      listTaskTagInfos: () => Promise<Array<{ id: number; name: string; createdAt: string | null; updatedAt: string | null }>>;
      renameTaskTag: (id: number, name: string) => Promise<{ success: boolean; message?: string }>;
      listEvents: (params: { taskId: number; limit?: number }) => Promise<any[]>;
      promptText: (options: { title?: string; label?: string; placeholder?: string; ok?: string; cancel?: string }) => Promise<string | null>;
    };
  }
}
