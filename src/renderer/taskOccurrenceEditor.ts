(() => {
  type OccurrenceRecord = {
    occurrenceId: number;
    taskId: number;
    status: string;
    scheduledDate: string | null;
    scheduledTime: string | null;
    deferredDate: string | null;
    completedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };

  const tableBody = document.getElementById('occurrenceTableBody') as HTMLTableSectionElement;
  const emptyMessage = document.getElementById('emptyMessage') as HTMLDivElement;
  const errorMessage = document.getElementById('errorMessage') as HTMLDivElement;
  const refreshButton = document.getElementById('refreshButton') as HTMLButtonElement;
  const statusMessage = document.getElementById('statusMessage') as HTMLSpanElement;
  const taskTitleEl = document.getElementById('taskTitle') as HTMLDivElement;
  const taskMetaEl = document.getElementById('taskMeta') as HTMLDivElement;

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  let currentTaskId: number | null = null;
  let loading = false;
  let records: OccurrenceRecord[] = [];

  function parseTaskId(): number | null {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('taskId');
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function formatDateOnly(value: string | null): string {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
      if (!Number.isNaN(dt.getTime())) {
        return `${value} (${weekdays[dt.getDay()]})`;
      }
      return value;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d} (${weekdays[parsed.getDay()]})`;
  }

  function formatDateTime(value: string | null): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }

  function setLoading(isLoading: boolean): void {
    loading = isLoading;
    refreshButton.disabled = isLoading;
    if (isLoading) statusMessage.textContent = '読み込み中...';
  }

  function showError(message: string): void {
    errorMessage.style.display = 'block';
    errorMessage.textContent = message;
  }

  function clearError(): void {
    errorMessage.style.display = 'none';
    errorMessage.textContent = '';
  }

  function renderTaskMeta(task: any | null): void {
    if (!task) {
      taskTitleEl.textContent = 'タスクが見つかりません';
      taskMetaEl.textContent = '';
      return;
    }
    const title = typeof task.TITLE === 'string' && task.TITLE.trim().length > 0 ? task.TITLE.trim() : '(無題)';
    taskTitleEl.textContent = title;
    const meta: string[] = [];
    meta.push(`ID: ${task.ID}`);
    const start = typeof task.START_DATE === 'string' ? formatDateOnly(task.START_DATE) : '';
    if (start) meta.push(`開始日: ${start}`);
    const due = typeof task.DUE_AT === 'string' ? formatDateOnly(task.DUE_AT) : '';
    if (due) meta.push(`期日: ${due}`);
    const recurring = Number(task.IS_RECURRING || 0) === 1;
    meta.push(recurring ? '繰り返しタスク' : '単発タスク');
    taskMetaEl.textContent = meta.join(' / ');
  }

  function renderTable(): void {
    tableBody.innerHTML = '';
    const total = records.length;
    const doneCount = records.filter(r => r.status === 'done').length;
    const pendingCount = total - doneCount;
    statusMessage.textContent = `件数: ${total} / 未完了: ${pendingCount} / 完了: ${doneCount}`;
    if (!records.length) {
      emptyMessage.style.display = 'block';
      return;
    }
    emptyMessage.style.display = 'none';
    records.forEach(record => {
      const tr = document.createElement('tr');
      const idTd = document.createElement('td');
      idTd.textContent = String(record.occurrenceId);
      tr.appendChild(idTd);

      const scheduledDateTd = document.createElement('td');
      scheduledDateTd.textContent = formatDateOnly(record.scheduledDate);
      tr.appendChild(scheduledDateTd);

      const scheduledTimeTd = document.createElement('td');
      scheduledTimeTd.textContent = record.scheduledTime ? record.scheduledTime : '';
      tr.appendChild(scheduledTimeTd);

      const deferredTd = document.createElement('td');
      deferredTd.textContent = formatDateOnly(record.deferredDate);
      tr.appendChild(deferredTd);

      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'status-badge ' + (record.status === 'done' ? 'status-done' : 'status-pending');
      badge.textContent = record.status === 'done' ? '完了' : '未完了';
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      const completedTd = document.createElement('td');
      completedTd.textContent = formatDateTime(record.completedAt);
      tr.appendChild(completedTd);

      const createdTd = document.createElement('td');
      createdTd.textContent = formatDateTime(record.createdAt);
      tr.appendChild(createdTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = formatDateTime(record.updatedAt);
      tr.appendChild(updatedTd);

      const actionTd = document.createElement('td');
      const toggleBtn = document.createElement('button');
      const willBe = record.status === 'done' ? 'pending' : 'done';
      toggleBtn.textContent = record.status === 'done' ? '未完了に戻す' : '完了にする';
      toggleBtn.onclick = async () => {
        if (loading) return;
        const confirmText = record.status === 'done'
          ? `オカレンス(ID: ${record.occurrenceId}) を未完了に戻します。よろしいですか？`
          : `オカレンス(ID: ${record.occurrenceId}) を完了にします。よろしいですか？`;
        if (!window.confirm(confirmText)) return;
        toggleBtn.disabled = true;
        try {
          const result = await window.electronAPI.setOccurrenceStatus(record.occurrenceId, willBe as 'pending' | 'done');
          if (!result || !result.success) {
            throw new Error(result?.message || '更新に失敗しました');
          }
          await loadOccurrences();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          window.alert(`ステータスの更新に失敗しました: ${message}`);
          toggleBtn.disabled = false;
        }
      };
      actionTd.appendChild(toggleBtn);
      tr.appendChild(actionTd);
      tableBody.appendChild(tr);
    });
  }

  async function loadTask(): Promise<void> {
    if (currentTaskId == null) return;
    try {
      const task = await window.electronAPI.getTask(currentTaskId);
      renderTaskMeta(task);
    } catch (err) {
      renderTaskMeta(null);
      const message = err instanceof Error ? err.message : String(err);
      showError(`タスク情報の取得に失敗しました: ${message}`);
    }
  }

  async function loadOccurrences(): Promise<void> {
    if (currentTaskId == null) return;
    setLoading(true);
    clearError();
    try {
      const result = await window.electronAPI.listOccurrencesByTask(currentTaskId);
      if (!result || !result.success) {
        throw new Error(result?.message || 'オカレンスの取得に失敗しました');
      }
      records = Array.isArray(result.records) ? result.records : [];
      renderTable();
    } catch (err) {
      records = [];
      renderTable();
      const message = err instanceof Error ? err.message : String(err);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    currentTaskId = parseTaskId();
    if (!currentTaskId) {
      taskTitleEl.textContent = 'タスクIDが指定されていません';
      refreshButton.disabled = true;
      return;
    }
    refreshButton.addEventListener('click', () => {
      if (!loading) void loadOccurrences();
    });
    await loadTask();
    await loadOccurrences();
  });
})();
