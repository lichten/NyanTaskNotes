function byId<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  const filedb = byId<HTMLInputElement>('filedb');
  filedb.value = s.fileDbPath || '';
  const taskdb = document.getElementById('taskdb') as HTMLInputElement | null;
  if (taskdb) taskdb.value = s.taskDbPath || '';
}

function parseTags(input: string): string[] {
  return (input || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function onBrowseDb() {
  const res = await window.electronAPI.selectFileDbPath();
  if (!res.canceled && res.filePath) {
    byId<HTMLInputElement>('filedb').value = res.filePath;
  }
}

async function onBrowseTaskDb() {
  const api: any = (window as any).electronAPI;
  const res: any = await api.showFileDialog({
    title: 'タスクDBのSQLiteファイルを選択',
    properties: ['openFile', 'createDirectory'],
    filters: [
      { name: 'SQLite Database', extensions: ['sqlite', 'db', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  const el = document.getElementById('taskdb') as HTMLInputElement | null;
  if (!el) return;
  if (!res.canceled && res.filePaths && res.filePaths.length > 0) el.value = res.filePaths[0];
}

async function onSaveDb() {
  const path = byId<HTMLInputElement>('filedb').value.trim();
  const { success } = await window.electronAPI.saveSettings({ fileDbPath: path });
  const status = byId<HTMLDivElement>('status');
  status.textContent = success ? '保存しました。アプリを再起動するとDBが初期化されます。' : '保存に失敗しました';
}

async function onSaveTaskDb() {
  const el = document.getElementById('taskdb') as HTMLInputElement | null;
  if (!el) return;
  const path = el.value.trim();
  const { success } = await window.electronAPI.saveSettings({ taskDbPath: path });
  const status = byId<HTMLDivElement>('status');
  status.textContent = success ? '保存しました。アプリを再起動するとDBが初期化されます。' : '保存に失敗しました';
}

async function onAddFiles() {
  const tagsStr = byId<HTMLInputElement>('tags').value;
  const tags = parseTags(tagsStr);
  const res = await window.electronAPI.addFilesToFileDb(tags);
  const status = byId<HTMLDivElement>('status');
  if (res.success) {
    status.textContent = `登録完了: 追加 ${res.added || 0}, 既存 ${res.skipped || 0}, 合計 ${res.total || 0}`;
  } else {
    status.textContent = `登録失敗: ${res.message || 'unknown'}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  byId<HTMLButtonElement>('browseDb').addEventListener('click', onBrowseDb);
  byId<HTMLButtonElement>('saveDb').addEventListener('click', onSaveDb);
  const b1 = document.getElementById('browseTaskDb');
  if (b1) b1.addEventListener('click', onBrowseTaskDb);
  const b2 = document.getElementById('saveTaskDb');
  if (b2) b2.addEventListener('click', onSaveTaskDb);
  byId<HTMLButtonElement>('addFiles').addEventListener('click', onAddFiles);
  loadSettings();
});
