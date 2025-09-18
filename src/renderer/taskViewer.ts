export {};

type Task = {
  ID?: number;
  TITLE: string;
  DESCRIPTION?: string | null;
  // status/priority removed in new schema
  DUE_AT?: string | null;
  START_DATE?: string | null;
  START_TIME?: string | null;
  IS_RECURRING?: number;
  FREQ?: string | null;
  MONTHLY_DAY?: number | null;
};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let allTagFilters: string[] = [];
const activeTagFilters = new Set<string>();
let showUntaggedOnly = false;

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

function formatDateWithWeekday(dateStr?: string | null): string {
  const base = formatDateInput(dateStr);
  if (!base) return '';
  // Compute weekday using local date to avoid TZ issues
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(base)) {
    const [yy, mm, dd] = base.split('-').map(Number);
    d = new Date(yy, mm - 1, dd);
  } else {
    d = new Date(base);
  }
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const w = weekdays[d.getDay()];
  return `${base} (${w})`;
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

function normalizeTags(value: any): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function matchesTagFilters(row: any): boolean {
  const tags = normalizeTags(row.TAGS);
  if (showUntaggedOnly) return tags.length === 0;
  if (activeTagFilters.size === 0) return true;
  return tags.some(tag => activeTagFilters.has(tag));
}

function toggleTagFilter(name: string): void {
  if (showUntaggedOnly) {
    showUntaggedOnly = false;
  }
  if (activeTagFilters.has(name)) activeTagFilters.delete(name);
  else activeTagFilters.add(name);
  renderTagFilterChips();
  loadTasks();
}

function toggleUntaggedFilter(): void {
  showUntaggedOnly = !showUntaggedOnly;
  if (showUntaggedOnly) {
    activeTagFilters.clear();
  }
  renderTagFilterChips();
  loadTasks();
}

function renderTagFilterChips(): void {
  const wrap = el<HTMLDivElement>('tagFilterBar');
  if (!wrap) return;
  wrap.innerHTML = '';
  const fragment = document.createDocumentFragment();

  if (allTagFilters.length === 0) {
    const placeholder = document.createElement('span');
    placeholder.className = 'tag-chip disabled';
    placeholder.textContent = 'タグはまだありません';
    placeholder.title = 'タスクにタグが追加されるとここに表示されます';
    fragment.appendChild(placeholder);
  } else {
    allTagFilters.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip' + (activeTagFilters.has(tag) ? ' active' : '');
      chip.textContent = tag;
      chip.title = activeTagFilters.has(tag) ? `タグ「${tag}」をフィルタから外します` : `タグ「${tag}」のタスクを表示します`;
      chip.addEventListener('click', () => toggleTagFilter(tag));
      fragment.appendChild(chip);
    });
  }

  const untaggedChip = document.createElement('span');
  untaggedChip.className = 'tag-chip' + (showUntaggedOnly ? ' active' : '');
  untaggedChip.textContent = 'タグなし';
  untaggedChip.title = showUntaggedOnly ? 'タグなしフィルタを解除します' : 'タグが設定されていないタスクのみ表示します';
  untaggedChip.addEventListener('click', toggleUntaggedFilter);
  fragment.appendChild(untaggedChip);

  wrap.appendChild(fragment);
}

async function refreshTagFilters(options: { preserveSelection?: boolean } = {}): Promise<void> {
  try {
    const fetched = await window.electronAPI.listTaskTags();
    const nextSet = new Set<string>((fetched || []).map((name: string) => name.trim()).filter((name: string) => name.length > 0));
    const next = Array.from(nextSet).sort((a, b) => a.localeCompare(b));
    if (options.preserveSelection !== false) {
      for (const tag of Array.from(activeTagFilters)) {
        if (!next.includes(tag)) activeTagFilters.delete(tag);
      }
    } else {
      activeTagFilters.clear();
    }
    allTagFilters = next;
  } catch {
    allTagFilters = [];
    activeTagFilters.clear();
  }
  renderTagFilterChips();
}

async function loadTasks(): Promise<void> {
  const query = el<HTMLInputElement>('search').value.trim();
  const occStatus = el<HTMLSelectElement>('statusFilter').value.trim();
  const params: any = {};
  if (query) params.query = query;
  if (occStatus) params.status = occStatus;
  // 範囲: 過去12か月〜24か月後（上部に「今日」を表示するため過去も取得）
  const today = new Date();
  const oneYearAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 365);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  to.setMonth(to.getMonth() + 24);
  params.from = ymd(oneYearAgo);
  params.to = ymd(to);

  const occs = await window.electronAPI.listOccurrences(params);
  const filteredOccs = occs.filter((o: any) => matchesTagFilters(o));
  const list = el<HTMLDivElement>('taskList');
  list.innerHTML = '';
  if (!filteredOccs.length) {
    list.innerHTML = '<div style="color:#666;">該当するオカレンスはありません。</div>';
    return;
  }

  const endOfWeek = (() => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dow = d.getDay(); // 0=Sun..6=Sat
    const daysToSunday = (7 - dow) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToSunday);
  })();
  const plusDays = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  const plusMonths = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth() + n, base.getDate());
  const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  const sameYear = (a: Date, b: Date) => a.getFullYear() === b.getFullYear();

  type Bucket = { key: string; label: string; order: number };
  const buckets: Bucket[] = [
    { key: 'pastOrToday', label: '今日', order: 0 },
    { key: 'tomorrow', label: '明日', order: 1 },
    { key: 'byWeekend', label: '週末まで', order: 2 },
    { key: 'within7', label: '7日以内', order: 3 },
    { key: 'thisMonth', label: '今月中', order: 4 },
    { key: 'within31', label: '31日以内', order: 5 },
    { key: 'thisYear', label: '今年中', order: 6 },
    { key: 'within12m', label: '12か月以内', order: 7 },
    { key: 'gt12m', label: '1年以上あと', order: 8 }
  ];
  const groups = new Map<string, any[]>();
  buckets.forEach(b => groups.set(b.key, []));
  const toDate = (s: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [yy, mm, dd] = s.split('-').map(Number);
      return new Date(yy, mm - 1, dd);
    }
    const d = new Date(s);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  for (const o of filteredOccs) {
    const d = toDate(o.SCHEDULED_DATE);
    let key: string;
    if (o.OCC_STATUS === 'done' && d < todayStart) {
      continue;
    }
    if (d <= todayStart) key = 'pastOrToday';
    else if (d.getTime() === tomorrow.getTime()) key = 'tomorrow';
    else if (d <= endOfWeek) key = 'byWeekend';
    else if (d <= plusDays(today, 7)) key = 'within7';
    else if (sameMonth(d, today)) key = 'thisMonth';
    else if (d <= plusDays(today, 31)) key = 'within31';
    else if (sameYear(d, today)) key = 'thisYear';
    else if (d <= plusMonths(today, 12)) key = 'within12m';
    else key = 'gt12m';
    groups.get(key)!.push(o);
  }

  for (const b of buckets) {
    const items = groups.get(b.key)!;
    if (!items.length) continue;
    const h = document.createElement('div');
    h.style.margin = '12px 0 6px';
    h.style.fontWeight = '600';
    h.textContent = `${b.label} (${items.length})`;
    list.appendChild(h);
    items.sort((a, b) => (a.SCHEDULED_DATE as string).localeCompare(b.SCHEDULED_DATE as string) || (a.SCHEDULED_TIME || '').localeCompare(b.SCHEDULED_TIME || ''));
    items.forEach((o: any) => {
      const div = document.createElement('div');
      div.className = 'task' + (o.OCC_STATUS === 'done' ? ' done' : '');
      const left = document.createElement('div');
      // タイトル + 編集アイコン
      const titleRow = document.createElement('div');
      titleRow.className = 'title';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = o.TITLE || '(無題)';
      const editBtn = document.createElement('span');
      editBtn.textContent = '✎';
      editBtn.title = '編集';
      editBtn.style.cursor = 'pointer';
      editBtn.style.marginLeft = '8px';
      editBtn.style.fontSize = '12px';
      editBtn.onclick = () => { window.location.href = `task-editor2.html?id=${o.TASK_ID}`; };
      titleRow.appendChild(titleSpan);
      titleRow.appendChild(editBtn);
      left.appendChild(titleRow);
      const description = typeof o.DESCRIPTION === 'string' ? o.DESCRIPTION.trim() : '';
      if (description.length > 0) {
        const descRow = document.createElement('div');
        descRow.className = 'description';
        descRow.textContent = description;
        left.appendChild(descRow);
      }
      const metaRow = document.createElement('div');
      metaRow.className = 'meta';
      metaRow.textContent = `予定日: ${formatDateWithWeekday(o.SCHEDULED_DATE)} ・ タスク: ${o.TASK_ID} ・ 状態: ${o.OCC_STATUS}`;
      left.appendChild(metaRow);
      const actions = document.createElement('div');
      actions.className = 'actions';
      const btn = document.createElement('button');
      if (o.OCCURRENCE_ID) {
        if (o.OCC_STATUS !== 'done') {
          btn.textContent = '完了にする';
          btn.onclick = async () => {
            let options: any = {};
            if (o.REQUIRE_COMPLETE_COMMENT) {
              const input = await window.electronAPI.promptText({
                title: '完了コメント',
                label: 'コメントを入力',
                placeholder: '',
                ok: 'OK',
                cancel: 'キャンセル'
              });
              if (input === null) return; // ユーザーがキャンセル
              options.comment = String(input);
            }
            await window.electronAPI.completeOccurrence(o.OCCURRENCE_ID, options);
            await loadTasks();
          };
        } else {
          btn.textContent = '完了済み';
          btn.disabled = true;
        }
      } else {
        btn.textContent = '単発タスク';
        btn.disabled = true;
      }
      actions.appendChild(btn);
      div.appendChild(left);
      div.appendChild(actions);
      list.appendChild(div);
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  el<HTMLInputElement>('search').addEventListener('input', () => loadTasks());
  el<HTMLSelectElement>('statusFilter').addEventListener('change', () => loadTasks());
  el<HTMLButtonElement>('refreshBtn').addEventListener('click', async () => {
    await refreshTagFilters({ preserveSelection: true });
    await loadTasks();
  });
  await refreshTagFilters({ preserveSelection: true });
  await loadTasks();
});
