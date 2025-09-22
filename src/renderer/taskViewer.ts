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

let deferDialog: HTMLDialogElement | null = null;
let deferDateInput: HTMLInputElement | null = null;
let deferApplyButton: HTMLButtonElement | null = null;
let deferClearButton: HTMLButtonElement | null = null;
let deferDialogDescription: HTMLDivElement | null = null;
let currentDeferOccurrence: any | null = null;
let deferDialogSubmitting = false;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function getEffectiveDate(row: any): string {
  const deferred = typeof row?.DEFERRED_DATE === 'string' ? row.DEFERRED_DATE.trim() : '';
  if (deferred) return deferred;
  return row?.SCHEDULED_DATE ?? '';
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

function setDeferDialogBusy(busy: boolean): void {
  if (deferDateInput) deferDateInput.disabled = busy;
  if (deferApplyButton) deferApplyButton.disabled = busy;
  if (deferClearButton) deferClearButton.disabled = busy;
}

async function confirmAndSubmitDefer(newDate: string | null): Promise<void> {
  if (!currentDeferOccurrence || !currentDeferOccurrence.OCCURRENCE_ID) return;
  if (deferDialogSubmitting) return;
  deferDialogSubmitting = true;
  setDeferDialogBusy(true);
  try {
    await window.electronAPI.deferOccurrence(currentDeferOccurrence.OCCURRENCE_ID, newDate);
    if (deferDialog && deferDialog.open) deferDialog.close();
    currentDeferOccurrence = null;
    await loadTasks();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    window.alert(`延期処理に失敗しました: ${message}`);
  } finally {
    deferDialogSubmitting = false;
    setDeferDialogBusy(false);
  }
}

function ensureDeferDialog(): void {
  if (deferDialog) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'defer-dialog';

  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'defer-dialog-form';

  const title = document.createElement('div');
  title.className = 'defer-dialog-title';
  title.textContent = '延期する日付';
  form.appendChild(title);

  const description = document.createElement('div');
  description.className = 'defer-dialog-description';
  description.textContent = '延期後の日付を選択してください。';
  form.appendChild(description);
  deferDialogDescription = description;

  const fieldWrapper = document.createElement('div');
  fieldWrapper.className = 'defer-dialog-field';
  const label = document.createElement('label');
  label.htmlFor = 'deferDateInput';
  label.textContent = '延期後の日付';
  fieldWrapper.appendChild(label);
  const input = document.createElement('input');
  input.type = 'date';
  input.id = 'deferDateInput';
  input.name = 'deferDate';
  fieldWrapper.appendChild(input);
  form.appendChild(fieldWrapper);

  const note = document.createElement('div');
  note.className = 'defer-dialog-note';
  note.textContent = '空欄で延期を解除できます。';
  form.appendChild(note);

  const buttons = document.createElement('div');
  buttons.className = 'defer-dialog-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => {
    dialog.close();
  });
  buttons.appendChild(cancelBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = '延期解除';
  clearBtn.addEventListener('click', () => {
    if (deferDateInput) deferDateInput.value = '';
    void confirmAndSubmitDefer(null);
  });
  buttons.appendChild(clearBtn);
  deferClearButton = clearBtn;

  const applyBtn = document.createElement('button');
  applyBtn.type = 'submit';
  applyBtn.textContent = '延期';
  buttons.appendChild(applyBtn);
  deferApplyButton = applyBtn;

  form.appendChild(buttons);

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!deferDateInput) return;
    const value = deferDateInput.value.trim();
    void confirmAndSubmitDefer(value ? value : null);
  });

  dialog.addEventListener('close', () => {
    currentDeferOccurrence = null;
    deferDialogSubmitting = false;
    setDeferDialogBusy(false);
    if (deferDateInput) deferDateInput.value = '';
  });

  dialog.appendChild(form);
  document.body.appendChild(dialog);

  deferDialog = dialog;
  deferDateInput = input;
}

function openDeferDialog(occurrence: any): void {
  if (!occurrence || !occurrence.OCCURRENCE_ID) return;
  ensureDeferDialog();
  currentDeferOccurrence = occurrence;
  setDeferDialogBusy(false);
  const initialDate = formatDateInput(occurrence.DEFERRED_DATE) || formatDateInput(occurrence.SCHEDULED_DATE) || formatDateInput(getEffectiveDate(occurrence));
  if (deferDialogDescription) {
    const currentLabel = formatDateWithWeekday(getEffectiveDate(occurrence)) || '-';
    const originalLabel = occurrence.DEFERRED_DATE && occurrence.DEFERRED_DATE !== occurrence.SCHEDULED_DATE
      ? formatDateWithWeekday(occurrence.SCHEDULED_DATE) || '-'
      : null;
    deferDialogDescription.textContent = originalLabel
      ? `延期後の日付を選択してください。（現在: ${currentLabel}／元: ${originalLabel}）`
      : `延期後の日付を選択してください。（現在: ${currentLabel}）`;
  }
  if (deferDateInput) {
    deferDateInput.value = initialDate || '';
    deferDateInput.disabled = false;
  }
  if (deferDialog && !deferDialog.open) {
    deferDialog.returnValue = '';
    deferDialog.showModal();
    window.requestAnimationFrame(() => {
      deferDateInput?.focus();
    });
  }
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

function turnAllTagFiltersOn(): void {
  showUntaggedOnly = false;
  activeTagFilters.clear();
  allTagFilters.forEach(tag => activeTagFilters.add(tag));
  renderTagFilterChips();
  loadTasks();
}

function turnAllTagFiltersOff(): void {
  showUntaggedOnly = false;
  activeTagFilters.clear();
  renderTagFilterChips();
  loadTasks();
}

function renderTagFilterChips(): void {
  const wrap = el<HTMLDivElement>('tagFilterBar');
  if (!wrap) return;
  wrap.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const chipRow = document.createElement('div');
  chipRow.className = 'tag-filter-chip-row';

  if (allTagFilters.length === 0) {
    const placeholder = document.createElement('span');
    placeholder.className = 'tag-chip disabled';
    placeholder.textContent = 'タグはまだありません';
    placeholder.title = 'タスクにタグが追加されるとここに表示されます';
    chipRow.appendChild(placeholder);
  } else {
    allTagFilters.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip' + (activeTagFilters.has(tag) ? ' active' : '');
      chip.textContent = tag;
      chip.title = activeTagFilters.has(tag) ? `タグ「${tag}」をフィルタから外します` : `タグ「${tag}」のタスクを表示します`;
      chip.addEventListener('click', () => toggleTagFilter(tag));
      chipRow.appendChild(chip);
    });
  }

  const untaggedChip = document.createElement('span');
  untaggedChip.className = 'tag-chip' + (showUntaggedOnly ? ' active' : '');
  untaggedChip.textContent = 'タグなし';
  untaggedChip.title = showUntaggedOnly ? 'タグなしフィルタを解除します' : 'タグが設定されていないタスクのみ表示します';
  untaggedChip.addEventListener('click', toggleUntaggedFilter);
  chipRow.appendChild(untaggedChip);

  fragment.appendChild(chipRow);

  const actions = document.createElement('div');
  actions.className = 'tag-filter-actions';
  const allOnBtn = document.createElement('button');
  allOnBtn.type = 'button';
  allOnBtn.textContent = 'ALL ON';
  allOnBtn.title = 'すべてのタグを有効にします（「タグなし」は除外）';
  allOnBtn.addEventListener('click', turnAllTagFiltersOn);
  const allOffBtn = document.createElement('button');
  allOffBtn.type = 'button';
  allOffBtn.textContent = 'ALL OFF';
  allOffBtn.title = 'すべてのタグフィルタを解除します';
  allOffBtn.addEventListener('click', turnAllTagFiltersOff);
  actions.appendChild(allOnBtn);
  actions.appendChild(allOffBtn);
  fragment.appendChild(actions);

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
  const occStatus = el<HTMLSelectElement>('statusFilter').value.trim();
  const params: any = {};
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
    { key: 'overdueOnce', label: '期限超過', order: 0 },
    { key: 'pastOrToday', label: '今日', order: 1 },
    { key: 'tomorrow', label: '明日', order: 2 },
    { key: 'byWeekend', label: '週末まで', order: 3 },
    { key: 'within7', label: '7日以内', order: 4 },
    { key: 'thisMonth', label: '今月中', order: 5 },
    { key: 'within31', label: '31日以内', order: 6 },
    { key: 'thisYear', label: '今年中', order: 7 },
    { key: 'within12m', label: '12か月以内', order: 8 },
    { key: 'gt12m', label: '1年以上あと', order: 9 }
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
    const effectiveDateStr = getEffectiveDate(o);
    if (!effectiveDateStr) continue;
    const d = toDate(effectiveDateStr);
    if (o.OCC_STATUS === 'done' && d < todayStart) {
      continue;
    }
    (o as any).__overdueDays = undefined;
    (o as any).__overdueDueDate = undefined;
    const deferredDateStr = formatDateInput(o.DEFERRED_DATE);
    const dueBase = deferredDateStr || formatDateInput((o as any).DUE_AT) || formatDateInput(o.SCHEDULED_DATE) || effectiveDateStr;
    if (o.OCC_STATUS !== 'done' && dueBase) {
      const dueDate = toDate(dueBase);
      const overdueDays = Math.floor((todayStart.getTime() - dueDate.getTime()) / MS_PER_DAY);
      if (overdueDays > 0) {
        (o as any).__overdueDays = overdueDays;
        (o as any).__overdueDueDate = dueBase;
        groups.get('overdueOnce')!.push(o);
        continue;
      }
    }
    let key: string;
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
    const bucketKey = b.key;
    items.sort((itemA, itemB) => {
      if (bucketKey === 'overdueOnce') {
        const dueA = String((itemA as any).__overdueDueDate || getEffectiveDate(itemA) || '');
        const dueB = String((itemB as any).__overdueDueDate || getEffectiveDate(itemB) || '');
        const cmpDue = dueA.localeCompare(dueB);
        if (cmpDue !== 0) return cmpDue;
        return (itemA.SCHEDULED_TIME || '').localeCompare(itemB.SCHEDULED_TIME || '');
      }
      const dateA = getEffectiveDate(itemA);
      const dateB = getEffectiveDate(itemB);
      const cmpDate = String(dateA || '').localeCompare(String(dateB || ''));
      if (cmpDate !== 0) return cmpDate;
      return (itemA.SCHEDULED_TIME || '').localeCompare(itemB.SCHEDULED_TIME || '');
    });
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
      const overdueDays = Number((o as any).__overdueDays || 0);
      if (overdueDays > 0) {
        const overdueRow = document.createElement('div');
        overdueRow.className = 'overdue-info';
        const badge = document.createElement('span');
        badge.className = 'overdue-badge';
        badge.textContent = overdueDays === 1 ? '1日前' : `${overdueDays}日前`;
        overdueRow.appendChild(badge);
        const dueLabel = formatDateWithWeekday((o as any).__overdueDueDate);
        if (dueLabel) {
          const dueSpan = document.createElement('span');
          dueSpan.textContent = `（期日: ${dueLabel}）`;
          dueSpan.style.marginLeft = '6px';
          overdueRow.appendChild(dueSpan);
        }
        left.appendChild(overdueRow);
      }
      const metaRow = document.createElement('div');
      metaRow.className = 'meta';
      const effectiveDateStr = getEffectiveDate(o);
      let metaText = `予定日: ${formatDateWithWeekday(effectiveDateStr) || '-'}`;
      if (o.DEFERRED_DATE && o.DEFERRED_DATE !== o.SCHEDULED_DATE) {
        metaText += `（元: ${formatDateWithWeekday(o.SCHEDULED_DATE) || '-'}）`;
      }
      metaText += ` ・ タスク: ${o.TASK_ID} ・ 状態: ${o.OCC_STATUS}`;
      metaRow.textContent = metaText;
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
          actions.appendChild(btn);

          const deferBtn = document.createElement('button');
          deferBtn.textContent = '延期する';
          deferBtn.style.marginLeft = '8px';
          deferBtn.onclick = () => {
            openDeferDialog(o);
          };
          actions.appendChild(deferBtn);
        } else {
          btn.textContent = '完了済み';
          btn.disabled = true;
          actions.appendChild(btn);
        }
      } else {
        btn.textContent = '単発タスク';
        btn.disabled = true;
        actions.appendChild(btn);
      }
      div.appendChild(left);
      div.appendChild(actions);
      list.appendChild(div);
    });
  }
}

async function addOneTimeTask(): Promise<void> {
  const input = el<HTMLInputElement>('onceTitle');
  const button = el<HTMLButtonElement>('onceAddBtn');
  const title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }
  input.disabled = true;
  button.disabled = true;
  try {
    const todayStr = ymd(new Date());
    const result = await window.electronAPI.createTask({
      title,
      description: null,
      startDate: todayStr,
      startTime: null,
      dueAt: null,
      isRecurring: false,
      requireCompleteComment: false,
      recurrence: null,
      tags: ['Only Once']
    });
    if (!result || !result.success) {
      throw new Error('タスクの作成に失敗しました');
    }
    input.value = '';
    await refreshTagFilters({ preserveSelection: true });
    await loadTasks();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (typeof window.alert === 'function') {
      window.alert(`単発タスクの追加に失敗しました: ${message}`);
    }
    console.error('addOneTimeTask error', e);
  } finally {
    input.disabled = false;
    button.disabled = false;
    input.focus();
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  ensureDeferDialog();
  el<HTMLButtonElement>('onceAddBtn').addEventListener('click', () => { void addOneTimeTask(); });
  el<HTMLInputElement>('onceTitle').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addOneTimeTask();
    }
  });
  el<HTMLSelectElement>('statusFilter').addEventListener('change', () => loadTasks());
  el<HTMLButtonElement>('refreshBtn').addEventListener('click', async () => {
    await refreshTagFilters({ preserveSelection: true });
    await loadTasks();
  });
  await refreshTagFilters({ preserveSelection: true });
  await loadTasks();
});
