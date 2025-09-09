function byId<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  const filedb = byId<HTMLInputElement>('filedb');
  filedb.value = s.fileDbPath || '';
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

async function onSaveDb() {
  const path = byId<HTMLInputElement>('filedb').value.trim();
  const { success } = await window.electronAPI.saveSettings({ fileDbPath: path });
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
  byId<HTMLButtonElement>('addFiles').addEventListener('click', onAddFiles);
  loadSettings();
});

