export {};

type Task = {
  ID?: number;
  TITLE: string;
  DESCRIPTION?: string | null;
  STATUS: 'todo' | 'doing' | 'done' | 'archived';
  PRIORITY?: number | null;
  DUE_AT?: string | null;
  START_DATE?: string | null;
  START_TIME?: string | null;
  IS_RECURRING?: number;
  FREQ?: string | null;
  MONTHLY_DAY?: number | null;
};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function formatDateInput(dateStr?: string | null): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function clampDay(year: number, monthIndex0: number, day: number): Date {
  // monthIndex0: 0..11
  const last = new Date(year, monthIndex0 + 1, 0).getDate();
  const d = Math.min(Math.max(day, 1), last);
  return new Date(year, monthIndex0, d);
}

function nextMonthlyDate(day: number, from: Date): string {
  // If from day < target day -> this month, else next month
  const y = from.getFullYear();
  const m0 = from.getMonth();
  const thisMonth = clampDay(y, m0, day);
  if (thisMonth >= new Date(y, m0, from.getDate())) {
    return ymd(thisMonth);
  }
  const nextMonth = (m0 + 1) % 12;
  const nextYear = y + (m0 === 11 ? 1 : 0);
  return ymd(clampDay(nextYear, nextMonth, day));
}

async function loadTasks(): Promise<void> {
  const query = el<HTMLInputElement>('search').value.trim();
  const occStatus = el<HTMLSelectElement>('statusFilter').value.trim();
  const params: any = {};
  if (query) params.query = query;
  if (occStatus) params.status = occStatus;
  // Default range: first day of this month to last day of next month
  const now = new Date();
  const y = now.getFullYear();
  const m0 = now.getMonth();
  const from = new Date(y, m0, 1);
  const to = new Date(y, m0 + 2, 0);
  params.from = formatDateInput(from.toISOString());
  params.to = formatDateInput(to.toISOString());

  const occs = await window.electronAPI.listOccurrences(params);
  const list = el<HTMLDivElement>('taskList');
  list.innerHTML = '';
  if (!occs.length) {
    list.innerHTML = '<div style="color:#666;">該当するオカレンスはありません。</div>';
    return;
  }
  occs.forEach((o: any) => {
    const div = document.createElement('div');
    div.className = 'task' + (o.OCC_STATUS === 'done' ? ' done' : '');
    const left = document.createElement('div');
    const meta = `予定日: ${formatDateInput(o.SCHEDULED_DATE)} ・ タスク: ${o.TASK_ID} ・ 状態: ${o.OCC_STATUS}`;
    left.innerHTML = `<div class="title">${o.TITLE || '(無題)'}</div>` +
      `<div class="meta">${meta}</div>`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const btn = document.createElement('button');
    if (o.OCCURRENCE_ID) {
      if (o.OCC_STATUS !== 'done') {
        btn.textContent = '完了にする';
        btn.onclick = async () => {
          await window.electronAPI.completeOccurrence(o.OCCURRENCE_ID);
          await loadTasks();
        };
      } else {
        btn.textContent = '完了済み';
        btn.disabled = true;
      }
    } else {
      // 非繰り返し（単発）タスク表示用: 完了操作は編集画面から行う
      btn.textContent = (o.TASK_STATUS === 'done') ? '完了済み' : '単発タスク';
      btn.disabled = true;
    }
    actions.appendChild(btn);
    div.appendChild(left);
    div.appendChild(actions);
    list.appendChild(div);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  el<HTMLInputElement>('search').addEventListener('input', () => loadTasks());
  el<HTMLSelectElement>('statusFilter').addEventListener('change', () => loadTasks());
  el<HTMLButtonElement>('refreshBtn').addEventListener('click', () => loadTasks());
  await loadTasks();
});
