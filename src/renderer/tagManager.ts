(() => {
  type TagInfo = { id: number; name: string; createdAt: string | null; updatedAt: string | null };
  type StatusKind = 'info' | 'error' | 'success';

  const state: { tags: TagInfo[]; filter: string; loading: boolean } = {
    tags: [],
    filter: '',
    loading: false
  };

  const elements = {
    tbody: document.getElementById('tagTableBody') as HTMLTableSectionElement,
    empty: document.getElementById('emptyState') as HTMLDivElement,
    status: document.getElementById('statusMessage') as HTMLSpanElement,
    searchInput: document.getElementById('searchInput') as HTMLInputElement,
    reloadButton: document.getElementById('reloadButton') as HTMLButtonElement
  };

  if (!elements.tbody || !elements.empty || !elements.status || !elements.searchInput || !elements.reloadButton) {
    throw new Error('タグ編集画面の初期化に失敗しました');
  }

  function formatIso(iso: string | null): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function setStatus(message: string, kind: StatusKind = 'info'): void {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  function render(): void {
    const keyword = state.filter.trim().toLowerCase();
    const filtered = keyword
      ? state.tags.filter(tag => tag.name.toLowerCase().includes(keyword))
      : state.tags;
    elements.tbody.innerHTML = '';
    if (!filtered.length) {
      elements.empty.hidden = false;
      return;
    }
    elements.empty.hidden = true;
    filtered.forEach(tag => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-id">${tag.id}</td>
        <td class="col-name"><span>${tag.name}</span></td>
        <td class="col-updated">${formatIso(tag.updatedAt)}</td>
        <td class="col-actions"><button type="button" data-id="${tag.id}">名前を変更</button></td>
      `;
      const button = tr.querySelector('button');
      if (button) {
        button.addEventListener('click', () => renameTag(tag));
      }
      elements.tbody.appendChild(tr);
    });
  }

  async function renameTag(tag: TagInfo): Promise<void> {
    const input = await window.electronAPI.promptText({
      title: 'タグ名を変更',
      label: `新しいタグ名 (${tag.name})`,
      placeholder: tag.name,
      ok: '更新',
      cancel: 'キャンセル'
    });
    if (input == null) {
      setStatus('変更をキャンセルしました', 'info');
      return;
    }
    const nextName = input.trim();
    if (!nextName) {
      setStatus('タグ名が空です', 'error');
      return;
    }
    if (nextName === tag.name) {
      setStatus('名前に変更はありません', 'info');
      return;
    }
    try {
      setStatus('更新中...', 'info');
      const result = await window.electronAPI.renameTaskTag(tag.id, nextName);
      if (!result?.success) {
        setStatus(result?.message || 'タグ名の更新に失敗しました', 'error');
        return;
      }
      setStatus('タグ名を更新しました', 'success');
      await loadTags();
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : '予期しないエラーが発生しました', 'error');
    }
  }

  async function loadTags(): Promise<void> {
    if (state.loading) return;
    state.loading = true;
    elements.reloadButton.disabled = true;
    setStatus('読み込み中...', 'info');
    try {
      const tags = await window.electronAPI.listTaskTagInfos();
      state.tags = tags;
      render();
      setStatus(`${tags.length}件のタグ`, 'info');
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : 'タグの取得に失敗しました', 'error');
      elements.tbody.innerHTML = '';
      elements.empty.hidden = false;
    } finally {
      state.loading = false;
      elements.reloadButton.disabled = false;
    }
  }

  function setupEvents(): void {
    elements.searchInput.addEventListener('input', () => {
      state.filter = elements.searchInput.value;
      render();
    });
    elements.reloadButton.addEventListener('click', () => {
      loadTags().catch(error => {
        console.error(error);
        setStatus('タグの再読み込みに失敗しました', 'error');
      });
    });
  }

  setupEvents();
  loadTags().catch(error => {
    console.error(error);
    setStatus('タグの初期読込に失敗しました', 'error');
  });
})();
