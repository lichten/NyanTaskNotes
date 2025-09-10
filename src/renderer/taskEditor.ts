export {};

type Task = {
  ID?: number;
  TITLE: string;
  DESCRIPTION?: string | null;
  STATUS: string;
  PRIORITY?: number | null;
  DUE_AT?: string | null;
  START_DATE?: string | null;
  START_TIME?: string | null;
  IS_RECURRING?: number;
  // Recurrence rule (joined)
  FREQ?: string | null;
  MONTHLY_DAY?: number | null;
  COUNT?: number | null;
};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let tasks: Task[] = [];
let selectedId: number | null = null;
function updateMonthlyDayState() {
  const isRec = (el<HTMLSelectElement>('isRecurring').value === '1');
  const md = document.getElementById('monthlyDay') as HTMLInputElement | null;
  const rc = document.getElementById('recurrenceCount') as HTMLInputElement | null;
  if (md) {
    md.disabled = !isRec;
    md.placeholder = isRec ? '1..31' : '繰り返しオンで編集可';
  }
  if (rc) {
    rc.disabled = !isRec;
    if (!isRec) rc.value = '1'; // 単発タスクは1固定
    if (isRec && !rc.value) rc.value = '0'; // デフォルト0=無限
  }
}

function formatDateInput(dateStr?: string | null): string {
  if (!dateStr) return '';
  // Accept YYYY-MM-DD or ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

async function loadTasks(query = '') {
  tasks = await window.electronAPI.listTasks({ query });
  const list = el<HTMLDivElement>('taskList');
  list.innerHTML = '';
  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'item' + (t.ID === selectedId ? ' active' : '');
    div.dataset.id = String(t.ID);
    div.innerHTML = `<div>${t.TITLE || '(無題)'}</div>` +
      `<div class="meta">${t.STATUS}${t.DUE_AT ? ' ・ 期日: ' + formatDateInput(t.DUE_AT) : ''}${t.IS_RECURRING ? ' ・ 繰り返し' : ''}</div>`;
    div.onclick = () => selectTask(t.ID!);
    list.appendChild(div);
  });
}

function clearForm() {
  el<HTMLInputElement>('taskId').value = '';
  el<HTMLInputElement>('title').value = '';
  el<HTMLTextAreaElement>('description').value = '';
  el<HTMLSelectElement>('status').value = 'todo';
  el<HTMLInputElement>('priority').value = '';
  el<HTMLInputElement>('dueAt').value = '';
  el<HTMLSelectElement>('isRecurring').value = '0';
  // 仕様: 開始日/開始時刻のデフォルトを本日/00:00に設定
  (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    el<HTMLInputElement>('startDate').value = `${y}-${m}-${da}`;
  })();
  el<HTMLInputElement>('startTime').value = '00:00';
  const md = el<HTMLInputElement>('monthlyDay');
  if (md) md.value = '';
  const rc = el<HTMLInputElement>('recurrenceCount');
  if (rc) rc.value = '1';
  selectedId = null;
  renderListSelection();
  updateMonthlyDayState();
}

function renderListSelection() {
  const list = el<HTMLDivElement>('taskList');
  Array.from(list.children).forEach((node) => {
    node.classList.toggle('active', (node as HTMLElement).dataset.id === String(selectedId || ''));
  });
}

async function selectTask(id: number) {
  const t: Task = await window.electronAPI.getTask(id);
  selectedId = id;
  el<HTMLInputElement>('taskId').value = String(t.ID || '');
  el<HTMLInputElement>('title').value = t.TITLE || '';
  el<HTMLTextAreaElement>('description').value = (t.DESCRIPTION as any) || '';
  el<HTMLSelectElement>('status').value = t.STATUS || 'todo';
  el<HTMLInputElement>('priority').value = (t.PRIORITY ?? '').toString();
  el<HTMLInputElement>('dueAt').value = formatDateInput(t.DUE_AT);
  el<HTMLSelectElement>('isRecurring').value = String(t.IS_RECURRING ? 1 : 0);
  el<HTMLInputElement>('startDate').value = formatDateInput(t.START_DATE);
  el<HTMLInputElement>('startTime').value = t.START_TIME || '';
  const md = el<HTMLInputElement>('monthlyDay');
  if (md) md.value = t.MONTHLY_DAY ? String(t.MONTHLY_DAY) : '';
  const rc = el<HTMLInputElement>('recurrenceCount');
  if (rc) rc.value = String((t.IS_RECURRING ? (t.COUNT ?? 0) : 1));
  renderListSelection();
  updateMonthlyDayState();
}

async function onSave() {
  const payload = {
    title: el<HTMLInputElement>('title').value.trim(),
    description: el<HTMLTextAreaElement>('description').value.trim() || null,
    status: el<HTMLSelectElement>('status').value,
    priority: el<HTMLInputElement>('priority').value ? Number(el<HTMLInputElement>('priority').value) : null,
    dueAt: el<HTMLInputElement>('dueAt').value || null,
    isRecurring: el<HTMLSelectElement>('isRecurring').value === '1',
    startDate: el<HTMLInputElement>('startDate').value || null,
    startTime: el<HTMLInputElement>('startTime').value || null,
    // Recurrence rule (monthly day-of-month)
    recurrence: (() => {
      const isRec = el<HTMLSelectElement>('isRecurring').value === '1';
      const mdStr = (document.getElementById('monthlyDay') as HTMLInputElement | null)?.value || '';
      const md = mdStr ? Number(mdStr) : null;
      if (!isRec || !md || isNaN(md) || md < 1 || md > 31) return null;
      const rcStr = (document.getElementById('recurrenceCount') as HTMLInputElement | null)?.value || '';
      let count = rcStr ? Number(rcStr) : 0;
      if (isNaN(count) || count < 0) count = 0; // 0=無限
      return { freq: 'monthly', monthlyDay: md, count } as any;
    })()
  };
  const idStr = el<HTMLInputElement>('taskId').value;
  if (idStr) {
    await window.electronAPI.updateTask(Number(idStr), payload);
    await loadTasks(el<HTMLInputElement>('search').value.trim());
    await selectTask(Number(idStr));
  } else {
    const res = await window.electronAPI.createTask(payload);
    if (res.success && res.id) {
      await loadTasks(el<HTMLInputElement>('search').value.trim());
      await selectTask(res.id);
    }
  }
}

async function onDelete() {
  const idStr = el<HTMLInputElement>('taskId').value;
  if (!idStr) return;
  if (!confirm('このタスクを削除しますか？')) return;
  await window.electronAPI.deleteTask(Number(idStr));
  await loadTasks(el<HTMLInputElement>('search').value.trim());
  clearForm();
}

window.addEventListener('DOMContentLoaded', async () => {
  el<HTMLInputElement>('search').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    loadTasks(v);
  });
  el<HTMLButtonElement>('newBtn').addEventListener('click', () => clearForm());
  el<HTMLButtonElement>('saveBtn').addEventListener('click', onSave);
  el<HTMLButtonElement>('deleteBtn').addEventListener('click', onDelete);
  el<HTMLSelectElement>('isRecurring').addEventListener('change', updateMonthlyDayState);
  updateMonthlyDayState();
  await loadTasks('');
});
