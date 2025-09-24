import { TaskRow, RecurrenceUIMode, formatDateInput, inferRecurrenceModeFromDb, weeklyArrayFromMask, weeklyMaskFromArray } from './sharedTaskEditor.js';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEFAULT_DIFF_RANGE = '8w';

let allTagNames: string[] = [];
let selectedTags: string[] = [];
let recurrenceCountTouched = false;
let initialRecurrenceMode: RecurrenceUIMode = 'once';

type OccurrenceView = { date: string; time?: string | null; status?: string; };

function clampMonthlyDate(year: number, monthIndex0: number, day: number): string {
  const last = new Date(year, monthIndex0 + 1, 0).getDate();
  const d = Math.min(Math.max(day, 1), last);
  const dt = new Date(year, monthIndex0, d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function nthWeekdayOfMonth(year: number, monthIndex0: number, nth: number, dow: number): string {
  const first = new Date(year, monthIndex0, 1);
  const firstDow = first.getDay();
  if (nth === -1) {
    const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
    const lastDate = new Date(year, monthIndex0, lastDay);
    const lastDow = lastDate.getDay();
    const diff = (lastDow - dow + 7) % 7;
    const day = lastDay - diff;
    const dt = new Date(year, monthIndex0, day);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const da = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }
  const offset = (dow - firstDow + 7) % 7;
  let day = 1 + offset + (nth - 1) * 7;
  const last = new Date(year, monthIndex0 + 1, 0).getDate();
  if (day > last) day -= 7;
  const dt = new Date(year, monthIndex0, day);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function getPreviewWindow(range: string): { from?: string; to?: string; weeksAhead?: number; monthsAhead?: number; yearsAhead?: number } {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const res: any = { from: todayStr };
  if (range === '8w') {
    const d = new Date(today); d.setDate(d.getDate() + 7*8);
    res.to = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    res.weeksAhead = 8;
  } else if (range === '6m') {
    const d = new Date(today); d.setMonth(d.getMonth() + 6);
    res.to = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    res.monthsAhead = 6;
  } else if (range === '12m') {
    const d = new Date(today); d.setMonth(d.getMonth() + 12);
    res.to = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    res.monthsAhead = 12;
  } else if (range === '2y') {
    const d = new Date(today); d.setFullYear(d.getFullYear() + 2);
    res.to = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    res.yearsAhead = 2;
  }
  return res;
}

function buildRecurrenceFromUI(): any {
  const mode = (el<HTMLSelectElement>('isRecurring').value as RecurrenceUIMode);
  const rcStr = (el<HTMLInputElement>('recurrenceCount').value || '').trim();
  let count = rcStr ? Number(rcStr) : 0; if (!isFinite(count) || count < 0) count = 0;
  if (mode === 'daily') {
    const dhStr = (el<HTMLInputElement>('dailyHorizonDays').value || '').trim();
    let horizonDays = dhStr ? Number(dhStr) : 14; if (!isFinite(horizonDays) || horizonDays <= 0) horizonDays = 14; if (horizonDays > 365) horizonDays = 365;
    return { freq: 'daily', count, horizonDays, interval: 1, anchor: 'scheduled' };
  }
  if (mode === 'everyNScheduled' || mode === 'everyNCompleted') {
    const ivStr = (el<HTMLInputElement>('intervalDays').value || '').trim();
    let interval = ivStr ? Number(ivStr) : 2; if (!isFinite(interval) || interval < 1) interval = 1; if (interval > 365) interval = 365;
    let horizonDays: number | undefined = undefined;
    if (mode === 'everyNScheduled') {
      const dhStr = (el<HTMLInputElement>('dailyHorizonDays').value || '').trim();
      let h = dhStr ? Number(dhStr) : 14; if (!isFinite(h) || h <= 0) h = 14; if (h > 365) h = 365; horizonDays = h;
    }
    return { freq: 'daily', count, interval, anchor: (mode === 'everyNCompleted' ? 'completed' : 'scheduled'), horizonDays };
  }
  if (mode === 'weekly') {
    const boxes = Array.from(el<HTMLDivElement>('weeklyDows').querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const dows: number[] = [];
    boxes.forEach(b => { if (b.checked) dows.push(Number(b.value)); });
    const weeklyDows = weeklyMaskFromArray(dows);
    return { freq: 'weekly', weeklyDows, interval: 1, count };
  }
  if (mode === 'monthly') {
    let mdNum: number | null = null;
    const mdStr = (el<HTMLInputElement>('monthlyDay').value || '').trim();
    if (mdStr) { const n = Number(mdStr); if (!isNaN(n) && n >= 1 && n <= 31) mdNum = n; }
    if (mdNum == null) {
      const sd = (el<HTMLInputElement>('startDate').value || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) { const n = Number(sd.slice(8,10)); if (!isNaN(n) && n >= 1 && n <= 31) mdNum = n; }
    }
    return { freq: 'monthly', monthlyDay: mdNum ?? 1, count };
  }
  if (mode === 'monthlyNth') {
    const nth = Number((el<HTMLSelectElement>('monthlyNth').value || '1'));
    const dow = Number((el<HTMLSelectElement>('monthlyNthDow').value || '0'));
    return { freq: 'monthlyNth', monthlyNth: nth, monthlyNthDow: dow, count };
  }
  if (mode === 'yearly') {
    const month = Number((el<HTMLSelectElement>('yearlyMonth').value || '1'));
    const day = Number((el<HTMLInputElement>('yearlyDay').value || '1'));
    return { freq: 'yearly', yearlyMonth: month, yearlyDay: day, count };
  }
  return null;
}

function normalizeTagName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

function mergeTagNames(candidates: string[]): void {
  const set = new Set<string>();
  allTagNames.forEach(tag => {
    const n = normalizeTagName(tag);
    if (n) set.add(n);
  });
  candidates.forEach(tag => {
    const n = normalizeTagName(tag);
    if (n) set.add(n);
  });
  selectedTags.forEach(tag => {
    const n = normalizeTagName(tag);
    if (n) set.add(n);
  });
  allTagNames = Array.from(set).sort((a, b) => a.localeCompare(b));
}

function maybeApplyMonthlyRecurrenceCountDefault(mode: RecurrenceUIMode): void {
  if (mode !== 'monthly') return;
  if (recurrenceCountTouched) return;
  if (initialRecurrenceMode === 'monthly' && currentTask && currentTask.ID) return;
  const rc = document.getElementById('recurrenceCount') as HTMLInputElement | null;
  if (!rc) return;
  const trimmed = (rc.value || '').trim();
  if (trimmed === '' || trimmed === '1') {
    rc.value = '0';
  }
}

async function refreshAllTagNames(): Promise<void> {
  try {
    const fetched = await window.electronAPI.listTaskTags();
    if (Array.isArray(fetched)) mergeTagNames(fetched);
  } catch {
    mergeTagNames([]);
  }
}

function renderTagChips(): void {
  const wrap = document.getElementById('tagChips') as HTMLDivElement | null;
  if (!wrap) return;
  wrap.innerHTML = '';
  const names = Array.from(new Set<string>([...allTagNames, ...selectedTags])).sort((a, b) => a.localeCompare(b));
  if (!names.length) {
    const span = document.createElement('span');
    span.className = 'tag-empty';
    span.textContent = 'タグはまだありません。上の入力で追加できます';
    wrap.appendChild(span);
    return;
  }
  names.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    if (selectedTags.includes(name)) chip.classList.add('on');
    chip.textContent = name;
    chip.title = name;
    chip.addEventListener('click', () => toggleTagSelection(name));
    wrap.appendChild(chip);
  });
}

function setSelectedTags(tags: string[], options?: { silent?: boolean }): void {
  const normalized = Array.from(new Set(tags.map(t => normalizeTagName(t)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  selectedTags = normalized;
  mergeTagNames([]);
  const hidden = document.getElementById('tags') as HTMLInputElement | null;
  if (hidden) hidden.value = selectedTags.join(', ');
  renderTagChips();
}

function getSelectedTags(): string[] {
  return selectedTags.slice();
}

function toggleTagSelection(name: string): void {
  const n = normalizeTagName(name);
  if (!n) return;
  if (selectedTags.includes(n)) setSelectedTags(selectedTags.filter(t => t !== n));
  else setSelectedTags([...selectedTags, n]);
}

function addTagFromInput(): void {
  const input = document.getElementById('tagAddInput') as HTMLInputElement | null;
  if (!input) return;
  const value = normalizeTagName(input.value || '');
  if (!value) return;
  mergeTagNames([value]);
  setSelectedTags([...selectedTags, value]);
  input.value = '';
}

async function initializeTagControls(): Promise<void> {
  await refreshAllTagNames();
  renderTagChips();
  const addBtn = document.getElementById('tagAddBtn') as HTMLButtonElement | null;
  const addInput = document.getElementById('tagAddInput') as HTMLInputElement | null;
  addBtn?.addEventListener('click', addTagFromInput);
  addInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      addTagFromInput();
    }
  });
}

function captureFormSnapshot(): TaskRow {
  const mode = (el<HTMLSelectElement>('isRecurring').value as RecurrenceUIMode);
  const recurrence = buildRecurrenceFromUI();
  const tags = getSelectedTags();
  const requireCommentEl = document.getElementById('requireCompleteComment') as HTMLInputElement | null;
  const snapshot: any = {
    TITLE: el<HTMLInputElement>('title').value.trim(),
    DESCRIPTION: el<HTMLTextAreaElement>('description').value.trim() || null,
    TAGS: tags,
    DUE_AT: el<HTMLInputElement>('dueAt').value || null,
    START_DATE: el<HTMLInputElement>('startDate').value || null,
    START_TIME: el<HTMLInputElement>('startTime').value || null,
    IS_RECURRING: mode === 'once' ? 0 : 1,
    REQUIRE_COMPLETE_COMMENT: requireCommentEl && requireCommentEl.checked ? 1 : 0
  };

  if (!snapshot.START_DATE) snapshot.START_DATE = null;
  if (!snapshot.DUE_AT) snapshot.DUE_AT = null;
  if (!snapshot.START_TIME) snapshot.START_TIME = null;

  if (!snapshot.IS_RECURRING) {
    snapshot.FREQ = null;
    snapshot.COUNT = 1;
    snapshot.INTERVAL = null;
    snapshot.INTERVAL_ANCHOR = null;
    snapshot.HORIZON_DAYS = null;
    snapshot.MONTHLY_DAY = null;
    snapshot.MONTHLY_NTH = null;
    snapshot.MONTHLY_NTH_DOW = null;
    snapshot.YEARLY_MONTH = null;
    snapshot.WEEKLY_DOWS = null;
  } else if (recurrence) {
    let count = Number((recurrence as any).count || 0);
    if (!Number.isFinite(count) || count < 0) count = 0;
    snapshot.COUNT = count;
    const freq = String((recurrence as any).freq || '').toLowerCase();
    if (freq === 'daily') {
      snapshot.FREQ = 'daily';
      snapshot.INTERVAL = Math.max(1, Number((recurrence as any).interval || 1));
      snapshot.INTERVAL_ANCHOR = String((recurrence as any).anchor || 'scheduled');
      snapshot.HORIZON_DAYS = (recurrence as any).horizonDays != null ? Number((recurrence as any).horizonDays) : null;
      snapshot.MONTHLY_DAY = null;
      snapshot.MONTHLY_NTH = null;
      snapshot.MONTHLY_NTH_DOW = null;
      snapshot.YEARLY_MONTH = null;
      snapshot.WEEKLY_DOWS = null;
    } else if (freq === 'weekly') {
      snapshot.FREQ = 'weekly';
      snapshot.WEEKLY_DOWS = Math.max(0, Number((recurrence as any).weeklyDows || 0));
      snapshot.INTERVAL = Math.max(1, Number((recurrence as any).interval || 1));
      snapshot.INTERVAL_ANCHOR = 'scheduled';
      snapshot.HORIZON_DAYS = null;
      snapshot.MONTHLY_DAY = null;
      snapshot.MONTHLY_NTH = null;
      snapshot.MONTHLY_NTH_DOW = null;
      snapshot.YEARLY_MONTH = null;
    } else if (freq === 'monthly') {
      snapshot.FREQ = 'monthly';
      snapshot.MONTHLY_DAY = Number((recurrence as any).monthlyDay || 1);
      snapshot.MONTHLY_NTH = null;
      snapshot.MONTHLY_NTH_DOW = null;
      snapshot.YEARLY_MONTH = null;
      snapshot.INTERVAL = null;
      snapshot.INTERVAL_ANCHOR = null;
      snapshot.HORIZON_DAYS = null;
      snapshot.WEEKLY_DOWS = null;
    } else if (freq === 'monthlynth') {
      snapshot.FREQ = 'monthly';
      snapshot.MONTHLY_DAY = null;
      snapshot.MONTHLY_NTH = Number((recurrence as any).monthlyNth);
      snapshot.MONTHLY_NTH_DOW = Number((recurrence as any).monthlyNthDow);
      snapshot.INTERVAL = null;
      snapshot.INTERVAL_ANCHOR = null;
      snapshot.HORIZON_DAYS = null;
      snapshot.YEARLY_MONTH = null;
      snapshot.WEEKLY_DOWS = null;
    } else if (freq === 'yearly') {
      snapshot.FREQ = 'yearly';
      const month = Number((recurrence as any).yearlyMonth || (recurrence as any).month || 1);
      const day = Number((recurrence as any).yearlyDay || (recurrence as any).monthlyDay || 1);
      snapshot.YEARLY_MONTH = month;
      snapshot.MONTHLY_DAY = day;
      snapshot.INTERVAL = null;
      snapshot.INTERVAL_ANCHOR = null;
      snapshot.HORIZON_DAYS = null;
      snapshot.MONTHLY_NTH = null;
      snapshot.MONTHLY_NTH_DOW = null;
      snapshot.WEEKLY_DOWS = null;
    } else {
      snapshot.FREQ = freq || null;
      snapshot.INTERVAL = null;
      snapshot.INTERVAL_ANCHOR = null;
      snapshot.HORIZON_DAYS = null;
      snapshot.MONTHLY_DAY = null;
      snapshot.MONTHLY_NTH = null;
      snapshot.MONTHLY_NTH_DOW = null;
      snapshot.YEARLY_MONTH = null;
      snapshot.WEEKLY_DOWS = null;
    }
  } else {
    snapshot.IS_RECURRING = 0;
    snapshot.FREQ = null;
    snapshot.COUNT = 1;
    snapshot.INTERVAL = null;
    snapshot.INTERVAL_ANCHOR = null;
    snapshot.HORIZON_DAYS = null;
    snapshot.MONTHLY_DAY = null;
    snapshot.MONTHLY_NTH = null;
    snapshot.MONTHLY_NTH_DOW = null;
    snapshot.YEARLY_MONTH = null;
    snapshot.WEEKLY_DOWS = null;
  }

  return snapshot as TaskRow;
}

function computeTargetDates(rec: any, startDateStr: string | null, options: { range: string; isNew?: boolean }): string[] {
  const today = new Date();
  const res: string[] = [];
  const startDate = startDateStr ? new Date(startDateStr) : new Date(today);
  const rangeInfo = getPreviewWindow(options.range);
  const addIfInRange = (d: Date) => {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (rangeInfo.from && ds < rangeInfo.from!) return;
    if (rangeInfo.to && ds > rangeInfo.to!) return;
    res.push(ds);
  };

  if (!rec || rec.freq === 'once') {
    if (startDateStr) addIfInRange(startDate);
    return res;
  }

  if (rec.freq === 'daily') {
    const interval = Math.max(1, Number(rec.interval || 1));
    const anchor = String(rec.anchor || 'scheduled');
    const count = Number(rec.count || 0);
    if (count >= 1 && anchor !== 'completed') {
      for (let i = 0; i < count; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i * interval);
        addIfInRange(d);
      }
      return res;
    }
    if (anchor === 'completed') {
      // 新規作成（まだオカレンスが存在しない）場合は開始日で1件を想定
      if (options.isNew) {
        if (startDateStr) addIfInRange(startDate);
        return res;
      }
      // 既存の場合は次回想定（概算）を1件だけ表示（完了基準）
      const d = new Date(today); d.setDate(d.getDate() + interval);
      addIfInRange(d);
      return res;
    }
    // infinite windowed
    const horizon = Math.min(365, Math.max(1, Number(rec.horizonDays || 14)));
    for (let i = 0; i < horizon; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const diffDays = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime())/(1000*60*60*24));
      if (diffDays >= 0 && diffDays % interval === 0) addIfInRange(d);
    }
    return res;
  }

  if (rec.freq === 'weekly') {
    const mask = Number(rec.weeklyDows || 0);
    const count = Number(rec.count || 0);
    const interval = Math.max(1, Number(rec.interval || 1));
    const start0 = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const startSunday = new Date(start0); startSunday.setDate(start0.getDate() - start0.getDay());
    if (count >= 1) {
      let produced = 0;
      for (let w = 0; w < 520 && produced < count; w += interval) {
        const weekStart = new Date(startSunday); weekStart.setDate(startSunday.getDate() + w*7);
        for (let dow = 0; dow <= 6 && produced < count; dow++) {
          if (!(mask & (1 << dow))) continue;
          const d = new Date(weekStart); d.setDate(weekStart.getDate() + dow);
          if (d < start0) continue;
          addIfInRange(d); produced++;
        }
      }
      return res;
    }
    // infinite windowed (weeksAhead)
    const weeksAhead = getPreviewWindow(options.range).weeksAhead ?? 8;
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const sunday = new Date(today0); sunday.setDate(today0.getDate() - today0.getDay());
    for (let w = 0; w < weeksAhead; w++) {
      const weekStart = new Date(sunday); weekStart.setDate(sunday.getDate() + w*7);
      for (let dow = 0; dow <= 6; dow++) {
        if (!(mask & (1 << dow))) continue;
        const d = new Date(weekStart); d.setDate(weekStart.getDate() + dow);
        // interval alignment by week index relative to startSunday
        const relWeeks = Math.floor((weekStart.getTime() - startSunday.getTime())/(1000*60*60*24*7));
        if (relWeeks % interval !== 0) continue;
        if (d < start0) continue;
        addIfInRange(d);
      }
    }
    return res;
  }

  if (rec.freq === 'monthly') {
    const count = Number(rec.count || 0);
    const md = Math.max(1, Math.min(31, Number(rec.monthlyDay || 1)));
    if (count >= 1) {
      let i = 0; while (res.length < count) {
        const m0 = (startDate.getMonth() + i) % 12;
        const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i)/12);
        const dStr = clampMonthlyDate(y, m0, md);
        const d = new Date(dStr);
        if (d >= startDate) addIfInRange(d);
        i++;
      }
      return res;
    }
    const monthsAhead = getPreviewWindow(options.range).monthsAhead ?? 6;
    const now = new Date(); const startYear = now.getFullYear(); const startMonth0 = now.getMonth();
    for (let i = 0; i < monthsAhead; i++) {
      const m0 = (startMonth0 + i) % 12; const y = startYear + Math.floor((startMonth0 + i)/12);
      const dStr = clampMonthlyDate(y, m0, md); addIfInRange(new Date(dStr));
    }
    return res;
  }

  if (rec.freq === 'monthlyNth') {
    const nth = Number(rec.monthlyNth); const dow = Number(rec.monthlyNthDow);
    const count = Number(rec.count || 0);
    if (count >= 1) {
      let i = 0; while (res.length < count) {
        const m0 = (startDate.getMonth() + i) % 12; const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i)/12);
        const dStr = nthWeekdayOfMonth(y, m0, nth, dow); const d = new Date(dStr);
        if (d >= startDate) addIfInRange(d); i++;
      }
      return res;
    }
    const monthsAhead = getPreviewWindow(options.range).monthsAhead ?? 6;
    const now = new Date(); const startYear = now.getFullYear(); const startMonth0 = now.getMonth();
    for (let i = 0; i < monthsAhead; i++) {
      const m0 = (startMonth0 + i) % 12; const y = startYear + Math.floor((startMonth0 + i)/12);
      const dStr = nthWeekdayOfMonth(y, m0, nth, dow); addIfInRange(new Date(dStr));
    }
    return res;
  }

  if (rec.freq === 'yearly') {
    const month = Math.max(1, Math.min(12, Number(rec.yearlyMonth || 1)));
    const day = Math.max(1, Math.min(31, Number(rec.yearlyDay || 1)));
    const count = Number(rec.count || 0);
    if (count >= 1) {
      let y = startDate.getFullYear();
      let dStr = clampMonthlyDate(y, month-1, day);
      if (new Date(dStr) < startDate) { y += 1; dStr = clampMonthlyDate(y, month-1, day); }
      while (res.length < count) {
        res.push(dStr); y += 1; dStr = clampMonthlyDate(y, month-1, day);
      }
      // filter by range
      return res.filter(s => {
        const d = new Date(s); const r = getPreviewWindow(options.range);
        return (!r.from || s >= r.from) && (!r.to || s <= r.to);
      });
    }
    const yearsAhead = getPreviewWindow(options.range).yearsAhead ?? 2;
    const now = new Date(); const startYear = now.getFullYear();
    for (let i = 0; i < yearsAhead; i++) {
      const y = startYear + i; const dStr = clampMonthlyDate(y, month-1, day); addIfInRange(new Date(dStr));
    }
    return res;
  }

  return res;
}

function diffOccurrences(current: OccurrenceView[], target: string[], excludeDoneDeletes: boolean) {
  const currentSet = new Map<string, OccurrenceView>();
  current.forEach(o => currentSet.set(o.date, o));
  const targetSet = new Set<string>(target);
  const add: string[] = []; const del: OccurrenceView[] = []; const same: OccurrenceView[] = [];
  for (const t of target) {
    if (!currentSet.has(t)) add.push(t); else same.push(currentSet.get(t)!);
  }
  for (const c of current) {
    if (!targetSet.has(c.date)) {
      if (excludeDoneDeletes && c.status === 'done') continue;
      del.push(c);
    }
  }
  return { add, del, same };
}

let currentTask: TaskRow | null = null;

function setRowVisibleById(id: string, show: boolean): void {
  const r = document.getElementById(id);
  if (r) r.style.display = show ? '' : 'none';
}

function setRowVisibleByInput(inputId: string, show: boolean): void {
  const i = document.getElementById(inputId);
  const row = i?.parentElement;
  if (row && row.classList.contains('row')) row.style.display = show ? '' : 'none';
}

function updateRecurrenceVisibility(mode: RecurrenceUIMode): void {
  const showOnce = mode === 'once';
  const showDaily = mode === 'daily';
  const showEveryNScheduled = mode === 'everyNScheduled';
  const showEveryNCompleted = mode === 'everyNCompleted';
  const showWeekly = mode === 'weekly';
  const showMonthly = mode === 'monthly';
  const showMonthlyNth = mode === 'monthlyNth';
  const showYearly = mode === 'yearly';

  // Single occurrence vs recurring basics
  setRowVisibleByInput('dueAt', showOnce);
  setRowVisibleByInput('startDate', !showOnce);
  setRowVisibleByInput('startTime', !showOnce);

  // Daily and interval related
  setRowVisibleById('rowHorizon', showDaily || showEveryNScheduled);
  setRowVisibleById('rowInterval', showEveryNScheduled || showEveryNCompleted);

  // Weekly/Monthly/Yearly groups
  setRowVisibleById('rowWeekly', showWeekly);
  setRowVisibleById('rowMonthlyDay', showMonthly);
  setRowVisibleById('rowMonthlyNth', showMonthlyNth);
  setRowVisibleById('rowYearlyMonth', showYearly);
  setRowVisibleById('rowYearlyDay', showYearly);

  // Recurrence count: visible for any recurring pattern except 'once'
  setRowVisibleByInput('recurrenceCount', !showOnce);

  // Required flags
  const dueAtEl = el<HTMLInputElement>('dueAt');
  if (dueAtEl) dueAtEl.required = showOnce;
}

async function loadInitial(): Promise<void> {
  // parse query
  const params = new URLSearchParams(window.location.search);
  const copyMode = params.get('copy');
  const idStr = params.get('id');
  if (copyMode === '1') {
    let copyData: TaskRow | null = null;
    try {
      const raw = sessionStorage.getItem('taskEditorCopy');
      if (raw) copyData = JSON.parse(raw) as TaskRow;
      sessionStorage.removeItem('taskEditorCopy');
    } catch {
      copyData = null;
    }
    if (copyData) {
      (copyData as any).ID = undefined;
      const normalizedStart = formatDateInput(copyData.START_DATE);
      if (normalizedStart) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        copyData.START_DATE = normalizedStart < todayStr ? todayStr : normalizedStart;
      } else {
        copyData.START_DATE = null;
      }
      currentTask = null;
      populateForm(copyData);
    } else if (idStr) {
      const id = Number(idStr);
      currentTask = await window.electronAPI.getTask(id);
      if (currentTask) populateForm(currentTask);
      else populateForm({ TITLE: '', IS_RECURRING: 0 } as any);
    } else {
      populateForm({ TITLE: '', IS_RECURRING: 0 } as any);
    }
  } else if (idStr) {
    const id = Number(idStr);
    currentTask = await window.electronAPI.getTask(id);
    if (currentTask) populateForm(currentTask);
  } else {
    // new mode
    populateForm({ TITLE: '', IS_RECURRING: 0 } as any);
  }
  // 初期表示の可視性を同期
  updateRecurrenceVisibility(el<HTMLSelectElement>('isRecurring').value as RecurrenceUIMode);
  await refreshLogs();
}

function populateForm(t: TaskRow): void {
  el<HTMLInputElement>('taskId').value = t.ID ? String(t.ID) : '';
  el<HTMLInputElement>('title').value = t.TITLE || '';
  el<HTMLTextAreaElement>('description').value = (t.DESCRIPTION as any) || '';
  setSelectedTags((t.TAGS || []).slice(), { silent: true });
  el<HTMLInputElement>('dueAt').value = formatDateInput(t.DUE_AT);
  const mode = inferRecurrenceModeFromDb(t);
  initialRecurrenceMode = mode;
  recurrenceCountTouched = false;
  el<HTMLSelectElement>('isRecurring').value = mode;
  el<HTMLInputElement>('startDate').value = formatDateInput(t.START_DATE) || (() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  el<HTMLInputElement>('startTime').value = t.START_TIME || '00:00';
  // interval/horizon
  el<HTMLInputElement>('dailyHorizonDays').value = (mode === 'daily' || mode === 'everyNScheduled') ? String((t as any).HORIZON_DAYS ?? 14) : '14';
  el<HTMLInputElement>('intervalDays').value = String(Math.max(1, Number((t as any).INTERVAL || 1)));
  el<HTMLInputElement>('monthlyDay').value = t.MONTHLY_DAY ? String(t.MONTHLY_DAY) : '';
  el<HTMLSelectElement>('monthlyNth').value = (t as any).MONTHLY_NTH != null ? String((t as any).MONTHLY_NTH) : '1';
  el<HTMLSelectElement>('monthlyNthDow').value = (t as any).MONTHLY_NTH_DOW != null ? String((t as any).MONTHLY_NTH_DOW) : '0';
  el<HTMLSelectElement>('yearlyMonth').value = (t as any).YEARLY_MONTH != null ? String((t as any).YEARLY_MONTH) : String(new Date().getMonth()+1);
  el<HTMLInputElement>('yearlyDay').value = t.MONTHLY_DAY ? String(t.MONTHLY_DAY) : String(new Date().getDate());
  el<HTMLInputElement>('recurrenceCount').value = String((t.IS_RECURRING ? (t.COUNT ?? 0) : 1));
  // 完了時コメント
  const cb = document.getElementById('requireCompleteComment') as HTMLInputElement | null;
  if (cb) cb.checked = !!(t as any).REQUIRE_COMPLETE_COMMENT;
  // weekly
  const wMask = Number((t as any).WEEKLY_DOWS || 0);
  const boxes = Array.from(el<HTMLDivElement>('weeklyDows').querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  boxes.forEach(b => b.checked = false);
  if (wMask > 0) { weeklyArrayFromMask(wMask).forEach(i => { const f = boxes.find(b => Number(b.value)===i); if (f) f.checked = true; }); }
}

async function fetchOccurrencesInRange(taskId: number, range: string): Promise<OccurrenceView[]> {
  const r = getPreviewWindow(range);
  const occ = await window.electronAPI.listOccurrences({ from: r.from, to: r.to });
  return (occ as any[]).filter(o => Number(o.TASK_ID) === taskId).map(o => ({ date: o.SCHEDULED_DATE as string, time: o.SCHEDULED_TIME as string, status: o.OCC_STATUS as string }));
}

function getDiffRange(): string {
  const select = document.getElementById('previewRange') as HTMLSelectElement | null;
  return select?.value || DEFAULT_DIFF_RANGE;
}

async function onSave() {
  const mode = (el<HTMLSelectElement>('isRecurring').value as RecurrenceUIMode);
  const startDate = el<HTMLInputElement>('startDate').value || null;
  const payload = {
    title: el<HTMLInputElement>('title').value.trim(),
    description: el<HTMLTextAreaElement>('description').value.trim() || null,
    tags: getSelectedTags(),
    dueAt: el<HTMLInputElement>('dueAt').value || null,
    isRecurring: mode !== 'once',
    startDate,
    startTime: el<HTMLInputElement>('startTime').value || null,
    recurrence: buildRecurrenceFromUI()
  };
  const requireCommentEl = document.getElementById('requireCompleteComment') as HTMLInputElement | null;
  if (requireCommentEl) (payload as any).requireCompleteComment = requireCommentEl.checked ? 1 : 0;
  if (!payload.recurrence) payload.isRecurring = false;
  // 確認: 削除予定にdoneが含まれる場合は警告
  const range = getDiffRange();
  const current: OccurrenceView[] = (el<HTMLInputElement>('taskId').value) ? await fetchOccurrencesInRange(Number(el<HTMLInputElement>('taskId').value), range) : [];
  const target = computeTargetDates(payload.recurrence, startDate, { range, isNew: !el<HTMLInputElement>('taskId').value });
  const diff = diffOccurrences(current, target, false);
  const doneDel = diff.del.filter(d => d.status === 'done').length;
  if (doneDel > 0) {
    const ok = confirm(`保存により削除予定 ${diff.del.length} 件のうち、完了済み ${doneDel} 件が削除されます。続行しますか？`);
    if (!ok) return;
  }
  const idStr = el<HTMLInputElement>('taskId').value;
  if (idStr) {
    await window.electronAPI.updateTask(Number(idStr), payload);
  } else {
    const res = await window.electronAPI.createTask(payload);
    if (res.success && res.id) el<HTMLInputElement>('taskId').value = String(res.id);
  }
  await refreshLogs();
}

async function onDelete() {
  const idStr = el<HTMLInputElement>('taskId').value;
  if (!idStr) return;
  if (!confirm('このタスクを削除しますか？')) return;
  await window.electronAPI.deleteTask(Number(idStr));
  // クリア
  populateForm({ TITLE: '', IS_RECURRING: 0 } as any);
}

function onDuplicate(): void {
  try {
    const snapshot = captureFormSnapshot();
    sessionStorage.setItem('taskEditorCopy', JSON.stringify(snapshot));
  } catch (e) {
    console.error('Failed to capture task snapshot', e);
    alert('設定のコピーに失敗しました。');
    return;
  }
  const params = new URLSearchParams();
  params.set('copy', '1');
  window.location.href = `task-editor2.html?${params.toString()}`;
}

window.addEventListener('DOMContentLoaded', async () => {
  el<HTMLInputElement>('recurrenceCount').addEventListener('input', () => {
    recurrenceCountTouched = true;
  });

  await initializeTagControls();
  el<HTMLButtonElement>('saveBtn').addEventListener('click', onSave);
  el<HTMLButtonElement>('duplicateBtn').addEventListener('click', onDuplicate);
  el<HTMLButtonElement>('deleteBtn').addEventListener('click', onDelete);

  // Recurrence mode change -> visibility sync
  el<HTMLSelectElement>('isRecurring').addEventListener('change', () => {
    const mode = el<HTMLSelectElement>('isRecurring').value as RecurrenceUIMode;
    updateRecurrenceVisibility(mode);
    maybeApplyMonthlyRecurrenceCountDefault(mode);
  });

  await loadInitial();
});

async function refreshLogs(): Promise<void> {
  const logsWrap = document.getElementById('logs') as HTMLDivElement | null;
  const logsList = document.getElementById('logsList') as HTMLDivElement | null;
  if (!logsWrap || !logsList) return;
  const idStr = el<HTMLInputElement>('taskId').value;
  if (!idStr) { logsWrap.style.display = 'none'; logsList.innerHTML = ''; return; }
  try {
    const rows = await window.electronAPI.listEvents({ taskId: Number(idStr), limit: 10 });
    if (!rows || rows.length === 0) {
      logsWrap.style.display = 'none'; logsList.innerHTML = '';
      return;
    }
    logsWrap.style.display = '';
    logsList.innerHTML = '';
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'occ';
      const when = document.createElement('div');
      const dt = new Date(r.CREATED_AT || r.created_at || r.createdAt || '');
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      when.textContent = `${y}-${m}-${d} ${hh}:${mm}`;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${r.KIND || r.kind} (${r.SOURCE || r.source})`;
      item.appendChild(when);
      item.appendChild(meta);
      // 追加情報: occ.complete(user) のとき DETAILS.comment があれば表示
      const kind = String(r.KIND || r.kind || '');
      const source = String(r.SOURCE || r.source || '');
      const detailsStr = (r.DETAILS || r.details || '') as string;
      if (kind === 'occ.complete' && source === 'user' && detailsStr) {
        try {
          const details = JSON.parse(detailsStr);
          if (details && typeof details.comment === 'string' && details.comment.trim().length > 0) {
            const extra = document.createElement('div');
            extra.className = 'meta';
            extra.textContent = `コメント: ${details.comment}`;
            item.appendChild(extra);
          }
        } catch {
          // ignore JSON parse errors silently
        }
      }
      logsList.appendChild(item);
    }
  } catch {
    logsWrap.style.display = 'none';
  }
}
