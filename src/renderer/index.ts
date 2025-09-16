(() => {
  function byId<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

  function parseTags(input: string): string[] {
    return (input || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
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
    byId<HTMLButtonElement>('addFiles').addEventListener('click', onAddFiles);
  });
})();
