export {};

type Task = {
  ID?: number;
  TITLE: string;
  DESCRIPTION?: string | null;
  TAGS?: string[];
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
let selectedTags: string[] = [];
let allTagNames: string[] = [];
function updateMonthlyDayState() {
  const mode = el<HTMLSelectElement>('isRecurring').value; // once | daily | monthly
  const md = document.getElementById('monthlyDay') as HTMLInputElement | null;
  const rc = document.getElementById('recurrenceCount') as HTMLInputElement | null;
  const sdRow = (document.getElementById('startDate')?.parentElement as HTMLElement | null);
  const stRow = (document.getElementById('startTime')?.parentElement as HTMLElement | null);
  const mdRow = (document.getElementById('monthlyDay')?.parentElement as HTMLElement | null);
  const rcRow = (document.getElementById('recurrenceCount')?.parentElement as HTMLElement | null);
  if (md) {
    const monthly = mode === 'monthly';
    md.disabled = !monthly;
    md.placeholder = monthly ? '1..31' : '「毎月」で編集可';
    // 毎月選択時に未入力なら「今日」の日付で補完
    if (monthly && !md.value) {
      const d = new Date();
      const day = d.getDate();
      if (day >= 1 && day <= 31) md.value = String(day);
    }
  }
  if (rc) {
    const recurring = mode !== 'once';
    rc.disabled = !recurring;
    if (!recurring) rc.value = '1'; // 単発タスクは1固定
    if (mode === 'daily') rc.value = '0'; // 毎日は0=無限を強制セット
    if (recurring && !rc.value) rc.value = '0'; // デフォルト0=無限
  }
  // 「毎月」選択時は開始日/開始時刻の行を非表示
  if (sdRow) sdRow.style.display = (mode === 'monthly') ? 'none' : '';
  if (stRow) stRow.style.display = (mode === 'monthly') ? 'none' : '';
  // 「１回のみ」選択時は「毎月の開始日」「繰り返し回数」の行を非表示
  if (mdRow) mdRow.style.display = (mode === 'once') ? 'none' : '';
  if (rcRow) rcRow.style.display = (mode === 'once') ? 'none' : '';
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
    const tags = (t.TAGS || []).slice(0, 3).join(', ');
    const parts: string[] = [];
    if (tags) parts.push(`タグ: ${tags}`);
    if (t.DUE_AT) parts.push(`期日: ${formatDateInput(t.DUE_AT)}`);
    if (t.IS_RECURRING) parts.push('繰り返し');
    div.innerHTML = `<div>${t.TITLE || '(無題)'}</div>` +
      `<div class=\"meta\">${parts.join(' ・ ')}</div>`;
    div.onclick = () => selectTask(t.ID!);
    list.appendChild(div);
  });
}

function clearForm() {
  el<HTMLInputElement>('taskId').value = '';
  el<HTMLInputElement>('title').value = '';
  el<HTMLTextAreaElement>('description').value = '';
  selectedTags = [];
  renderTagChips();
  el<HTMLInputElement>('dueAt').value = '';
  el<HTMLSelectElement>('isRecurring').value = 'once';
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
  selectedTags = (t.TAGS || []).slice();
  renderTagChips();
  el<HTMLInputElement>('dueAt').value = formatDateInput(t.DUE_AT);
  // Map DB values to UI mode
  el<HTMLSelectElement>('isRecurring').value = ((): string => {
    if (!t.IS_RECURRING) return 'once';
    if (t.FREQ === 'monthly') return 'monthly';
    if (t.FREQ === 'daily') return 'daily';
    return 'daily';
  })();
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
  const mode = el<HTMLSelectElement>('isRecurring').value; // once | daily | monthly
  const startDateInput = el<HTMLInputElement>('startDate').value || '';
  if (mode === 'daily' && !startDateInput) {
    alert('開始日は必須です（毎日）。開始日を入力してください。');
    return;
  }

  const payload = {
    title: el<HTMLInputElement>('title').value.trim(),
    description: el<HTMLTextAreaElement>('description').value.trim() || null,
    tags: selectedTags.slice(),
    dueAt: el<HTMLInputElement>('dueAt').value || null,
    isRecurring: mode !== 'once',
    startDate: startDateInput || null,
    startTime: el<HTMLInputElement>('startTime').value || null,
    // Recurrence rule (monthly day-of-month)
    recurrence: (() => {
      const rcStr = (document.getElementById('recurrenceCount') as HTMLInputElement | null)?.value || '';
      let count = rcStr ? Number(rcStr) : 0;
      if (isNaN(count) || count < 0) count = 0; // 0=無限
      if (mode === 'daily') {
        return { freq: 'daily', count } as any;
      }
      if (mode === 'monthly') {
        let mdNum: number | null = null;
        const mdEl = (document.getElementById('monthlyDay') as HTMLInputElement | null);
        const mdStr = (mdEl?.value || '').trim();
        if (mdStr) {
          const n = Number(mdStr);
          if (!isNaN(n) && n >= 1 && n <= 31) mdNum = n;
        }
        if (mdNum === null) {
          const sd = (el<HTMLInputElement>('startDate').value || '').trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
            const n = Number(sd.slice(8, 10));
            if (!isNaN(n) && n >= 1 && n <= 31) mdNum = n;
          }
        }
        if (mdNum === null) {
          alert('「毎月」を選択した場合は「毎月の開始日」または「開始日」を入力してください。');
          return null;
        }
        return { freq: 'monthly', monthlyDay: mdNum, count } as any;
      }
      return null;
    })()
  };
  // Safety: if recurrence is invalid, treat as non-recurring
  if (!payload.recurrence) payload.isRecurring = false;
  // 確認ダイアログ: 繰り返し回数が1以上なら予定再生成の確認
  const finiteCount = !!(payload.isRecurring && payload.recurrence && typeof (payload.recurrence as any).count === 'number' && (payload.recurrence as any).count >= 1);
  if (finiteCount) {
    const ok = confirm('繰り返し回数が1以上に設定されています。回数に合わせて予定（TASK_OCCURRENCES）を再生成します。よろしいですか？');
    if (!ok) return;
  }
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
  // 初期タグ読み込みとチップ描画
  try { allTagNames = await (window as any).electronAPI.listTaskTags(); } catch {}
  renderTagChips();
  // クエリに id があれば選択
  try {
    const params = new URLSearchParams(window.location.search);
    const idStr = params.get('id');
    if (idStr) {
      const id = Number(idStr);
      if (!isNaN(id)) await selectTask(id);
    }
  } catch {}
  // タグピッカー
  const openBtn = document.getElementById('openTagPicker');
  openBtn?.addEventListener('click', (ev) => openTagPicker(ev as MouseEvent));

  // インライン追加
  const addInput = document.getElementById('addTagInput') as HTMLInputElement | null;
  const addBtn = document.getElementById('addTagBtn') as HTMLButtonElement | null;
  const doAdd = () => {
    const v = (addInput?.value || '').trim();
    if (!v) return;
    if (!selectedTags.includes(v)) selectedTags.push(v);
    if (!allTagNames.includes(v)) allTagNames.push(v);
    selectedTags = Array.from(new Set(selectedTags)).sort((a,b)=>a.localeCompare(b));
    renderTagChips();
    if (addInput) addInput.value = '';
  };
  addBtn?.addEventListener('click', doAdd);
  addInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdd();
    }
  });
});

function renderTagChips() {
  const wrap = document.getElementById('tagChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const hidden = document.getElementById('tags') as HTMLInputElement | null;
  if (hidden) hidden.value = selectedTags.join(', ');
  if (!selectedTags.length) {
    const span = document.createElement('span');
    span.style.color = '#777';
    span.textContent = '（未選択）';
    wrap.appendChild(span);
    return;
  }
  selectedTags.forEach(name => {
    const chip = document.createElement('span');
    chip.textContent = name;
    chip.style.background = '#f0f0f0';
    chip.style.border = '1px solid #ddd';
    chip.style.borderRadius = '12px';
    chip.style.padding = '2px 8px';
    chip.style.fontSize = '12px';
    wrap.appendChild(chip);
  });
}

async function openTagPicker(ev: MouseEvent) {
  const panel = document.getElementById('tagPicker');
  if (!panel) return;
  const btn = ev.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  panel.style.left = `${Math.max(8, rect.left)}px`;
  panel.style.top = `${rect.bottom + 6}px`;
  try { allTagNames = await (window as any).electronAPI.listTaskTags(); } catch {}
  const names = Array.from(new Set(allTagNames)).sort((a,b)=>a.localeCompare(b));
  const container = document.createElement('div');

  const grid = document.createElement('div');
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.gap = '6px';
  grid.style.maxWidth = '420px';

  function makeChip(name: string): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.textContent = name;
    chip.style.cursor = 'pointer';
    chip.style.userSelect = 'none';
    chip.style.border = '1px solid #ddd';
    chip.style.borderRadius = '12px';
    chip.style.padding = '4px 10px';
    chip.style.fontSize = '12px';
    const setStyle = () => {
      const on = selectedTags.includes(name);
      chip.style.background = on ? '#eef6ff' : '#f8f8f8';
      chip.style.borderColor = on ? '#99c5ff' : '#ddd';
      chip.style.color = on ? '#0b61d8' : '#333';
    };
    setStyle();
    chip.onclick = () => {
      if (selectedTags.includes(name)) {
        selectedTags = selectedTags.filter(t => t !== name);
      } else {
        selectedTags.push(name);
      }
      selectedTags = Array.from(new Set(selectedTags)).sort((a,b)=>a.localeCompare(b));
      setStyle();
      renderTagChips();
    };
    return chip;
  }

  names.forEach(n => grid.appendChild(makeChip(n)));
  container.appendChild(grid);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '8px';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '閉じる';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  actions.appendChild(closeBtn);
  container.appendChild(actions);

  panel.innerHTML = '';
  panel.appendChild(container);
  panel.style.display = 'block';
}
