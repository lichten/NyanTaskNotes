(() => {
  type TaskRow = {
    ID?: number;
    TITLE: string;
    DESCRIPTION?: string | null;
    TAGS?: string[];
    DUE_AT?: string | null;
    START_DATE?: string | null;
    START_TIME?: string | null;
    IS_RECURRING?: number | null;
    FREQ?: string | null;
    INTERVAL?: number | null;
    INTERVAL_ANCHOR?: string | null;
    MONTHLY_DAY?: number | null;
    MONTHLY_NTH?: number | null;
    MONTHLY_NTH_DOW?: number | null;
    YEARLY_MONTH?: number | null;
    COUNT?: number | null;
   HORIZON_DAYS?: number | null;
    WEEKLY_DOWS?: number | null;
    MANUAL_NEXT_DUE?: number | null;
    REQUIRE_COMPLETE_COMMENT?: number | null;
    OCCURRENCE_OFFSET_DAYS?: number | null;
  };

  type Filters = {
    keyword: string;
    recurrence: string;
    tags: string[];
    startFrom?: string;
    startTo?: string;
    dueFrom?: string;
    dueTo?: string;
    onlyRequireComment: boolean;
    onlyHasCount: boolean;
    onlyHasHorizon: boolean;
  };

  const state: {
    allTasks: TaskRow[];
    filtered: TaskRow[];
    tags: string[];
    filters: Filters;
  } = {
    allTasks: [],
    filtered: [],
    tags: [],
    filters: {
      keyword: '',
      recurrence: 'all',
      tags: [],
      startFrom: undefined,
      startTo: undefined,
      dueFrom: undefined,
      dueTo: undefined,
      onlyRequireComment: false,
      onlyHasCount: false,
      onlyHasHorizon: false
    }
  };

  function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  function normalizeDateStr(dateStr?: string | null): string | undefined {
    if (!dateStr) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const match = /^\d{4}-\d{2}-\d{2}/.exec(dateStr);
    if (match) return match[0];
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  function getRecurrenceCategory(task: TaskRow): string {
    if (!task.IS_RECURRING) return 'once';
    if (Number(task.MANUAL_NEXT_DUE || 0) === 1) return 'manualNext';
    const freq = (task.FREQ || '').toLowerCase();
    if (freq === 'daily') {
      const anchor = (task.INTERVAL_ANCHOR || 'scheduled').toLowerCase();
      if (anchor === 'completed') return 'dailyCompleted';
      return 'dailyScheduled';
    }
    if (freq === 'weekly') return 'weekly';
    if (freq === 'monthly') {
      if (task.MONTHLY_NTH != null && task.MONTHLY_NTH_DOW != null) return 'monthlyNth';
      return 'monthlyDay';
    }
    if (freq === 'yearly') return 'yearly';
    return 'other';
  }

  function formatFrequencyDetail(task: TaskRow): string {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const freq = (task.FREQ || '').toLowerCase();
    if (!task.IS_RECURRING) return '単発';
    if (Number(task.MANUAL_NEXT_DUE || 0) === 1) {
      return '完了時に期日を指定';
    }
    if (freq === 'daily') {
      const interval = Number(task.INTERVAL || 1);
      const anchor = (task.INTERVAL_ANCHOR || 'scheduled');
      if (anchor === 'completed') {
        return `完了から${interval}日ごと`;
      }
      if (interval <= 1) return '毎日 (予定基準)';
      return `毎${interval}日 (予定基準)`;
    }
    if (freq === 'weekly') {
      const mask = Number(task.WEEKLY_DOWS || 0);
      const days: string[] = [];
      for (let i = 0; i <= 6; i++) if (mask & (1 << i)) days.push(weekdays[i]);
      if (!days.length && task.START_DATE) {
        const d = new Date(task.START_DATE);
        if (!Number.isNaN(d.getTime())) days.push(weekdays[d.getDay()]);
      }
      return days.length ? `毎週(${days.join('/')})` : '毎週';
    }
    if (freq === 'monthly') {
      if (task.MONTHLY_NTH != null && task.MONTHLY_NTH_DOW != null) {
        const nth = Number(task.MONTHLY_NTH);
        const dow = Number(task.MONTHLY_NTH_DOW);
        const label = weekdays[dow] ?? '';
        return `毎月 第${nth}${label}`;
      }
      const day = Number(task.MONTHLY_DAY || 1);
      return `毎月${day}日`;
    }
    if (freq === 'yearly') {
      const month = Number(task.YEARLY_MONTH || 1);
      const day = Number(task.MONTHLY_DAY || 1);
      return `毎年 ${month}月${day}日`;
    }
    return freq ? `頻度: ${freq}` : '頻度: 不明';
  }

  function renderTagOptions(): void {
    const dataList = el<HTMLDataListElement>('tagOptions');
    dataList.innerHTML = '';
    state.tags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag;
      dataList.appendChild(option);
    });
  }

  function renderSelectedTags(): void {
    const container = el<HTMLDivElement>('selectedTags');
    container.innerHTML = '';
    if (!state.filters.tags.length) {
      const span = document.createElement('span');
      span.style.color = '#777';
      span.style.fontSize = '12px';
      span.textContent = '未選択';
      container.appendChild(span);
      return;
    }
    state.filters.tags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      const name = document.createElement('span');
      name.textContent = tag;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.ariaLabel = `${tag} を削除`;
      removeBtn.onclick = () => {
        state.filters.tags = state.filters.tags.filter(t => t !== tag);
        applyFilters();
      };
      chip.appendChild(name);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  function addTagFromInput(): void {
    const input = el<HTMLInputElement>('tagInput');
    const value = input.value.trim();
    if (!value) return;
    const matched = state.tags.find(tag => tag.toLowerCase() === value.toLowerCase());
    if (!matched) {
      input.value = '';
      input.placeholder = '存在するタグ名を入力してください';
      setTimeout(() => { input.placeholder = 'タグを追加'; }, 2000);
      return;
    }
    if (!state.filters.tags.includes(matched)) {
      state.filters.tags.push(matched);
      applyFilters();
    }
    input.value = '';
  }

  function matchesDateRange(value: string | undefined, from?: string, to?: string): boolean {
    if (!from && !to) return true;
    if (!value) return false;
    if (from && value < from) return false;
    if (to && value > to) return false;
    return true;
  }

  function matchesFilters(task: TaskRow): boolean {
    const { filters } = state;
    if (filters.keyword) {
      const key = filters.keyword.toLowerCase();
      const title = (task.TITLE || '').toLowerCase();
      const desc = (task.DESCRIPTION || '').toLowerCase();
      if (!title.includes(key) && !desc.includes(key)) return false;
    }

    if (filters.recurrence !== 'all') {
      const cat = getRecurrenceCategory(task);
      if (cat !== filters.recurrence) return false;
    }

    if (filters.tags.length) {
      const tags = task.TAGS || [];
      const hasAll = filters.tags.every(tag => tags.includes(tag));
      if (!hasAll) return false;
    }

    const startDate = normalizeDateStr(task.START_DATE);
    if (!matchesDateRange(startDate, filters.startFrom, filters.startTo)) return false;

    const dueDate = normalizeDateStr(task.DUE_AT);
    if (!matchesDateRange(dueDate, filters.dueFrom, filters.dueTo)) return false;

    if (filters.onlyRequireComment) {
      if (!task.REQUIRE_COMPLETE_COMMENT) return false;
    }

    if (filters.onlyHasCount) {
      if (!(Number(task.COUNT || 0) > 0)) return false;
    }

    if (filters.onlyHasHorizon) {
      if (task.HORIZON_DAYS == null) return false;
    }

    return true;
  }

  function renderList(): void {
    const list = el<HTMLDivElement>('taskList');
    list.innerHTML = '';
    const meta = el<HTMLSpanElement>('resultsMeta');
    meta.textContent = `${state.filtered.length}件`;
    if (!state.filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '該当するタスクはありません。';
      list.appendChild(empty);
      return;
    }
    const sorted = [...state.filtered].sort((a, b) => {
      const titleCmp = (a.TITLE || '').localeCompare(b.TITLE || '', 'ja');
      if (titleCmp !== 0) return titleCmp;
      return Number(a.ID || 0) - Number(b.ID || 0);
    });
    for (const task of sorted) {
      const card = document.createElement('div');
      card.className = 'task-card';
      const header = document.createElement('h3');
      const idPart = typeof task.ID === 'number' ? ` (ID: ${task.ID})` : '';
      header.textContent = `${task.TITLE || '(無題)'}${idPart}`;
      card.appendChild(header);

      const metaRow = document.createElement('div');
      metaRow.className = 'task-meta';
      const freqSpan = document.createElement('span');
      freqSpan.textContent = formatFrequencyDetail(task);
      metaRow.appendChild(freqSpan);

      const startSpan = document.createElement('span');
      startSpan.textContent = `開始日: ${normalizeDateStr(task.START_DATE) || '未設定'}`;
      metaRow.appendChild(startSpan);

      if (task.START_TIME) {
        const timeSpan = document.createElement('span');
        timeSpan.textContent = `開始時刻: ${task.START_TIME}`;
        metaRow.appendChild(timeSpan);
      }

      if (task.DUE_AT) {
        const dueSpan = document.createElement('span');
        dueSpan.textContent = `期限: ${normalizeDateStr(task.DUE_AT)}`;
        metaRow.appendChild(dueSpan);
      }

      if (Number(task.COUNT || 0) > 0) {
        const countSpan = document.createElement('span');
        countSpan.textContent = `回数制限: ${task.COUNT}`;
        metaRow.appendChild(countSpan);
      }

      if (task.HORIZON_DAYS != null) {
        const hzSpan = document.createElement('span');
        hzSpan.textContent = `ホライズン: ${task.HORIZON_DAYS}日`;
        metaRow.appendChild(hzSpan);
      }

      if (task.REQUIRE_COMPLETE_COMMENT) {
        const commentSpan = document.createElement('span');
        commentSpan.textContent = '完了時コメント必須';
        metaRow.appendChild(commentSpan);
      }

      card.appendChild(metaRow);

      if (task.TAGS && task.TAGS.length) {
        const tagRow = document.createElement('div');
        tagRow.className = 'task-tags';
        task.TAGS.forEach(tag => {
          const tagSpan = document.createElement('span');
          tagSpan.textContent = tag;
          tagRow.appendChild(tagSpan);
        });
        card.appendChild(tagRow);
      }

      if (task.DESCRIPTION) {
        const desc = document.createElement('div');
        desc.style.marginTop = '6px';
        desc.style.fontSize = '13px';
        desc.style.whiteSpace = 'pre-line';
        desc.style.color = '#333';
        desc.textContent = task.DESCRIPTION || '';
        card.appendChild(desc);
      }

      if (task.ID != null) {
        const actions = document.createElement('div');
        actions.className = 'task-actions';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'タスク編集（新）';
        editBtn.title = 'タスク編集（新）画面を開く';
        editBtn.onclick = () => {
          window.location.href = `task-editor2.html?id=${task.ID}`;
        };
        actions.appendChild(editBtn);
        card.appendChild(actions);
      }

      list.appendChild(card);
    }
  }

  function applyFilters(): void {
    state.filters.keyword = el<HTMLInputElement>('searchInput').value.trim();
    state.filters.recurrence = el<HTMLSelectElement>('recurrenceSelect').value;
    state.filters.startFrom = el<HTMLInputElement>('startFrom').value || undefined;
    state.filters.startTo = el<HTMLInputElement>('startTo').value || undefined;
    state.filters.dueFrom = el<HTMLInputElement>('dueFrom').value || undefined;
    state.filters.dueTo = el<HTMLInputElement>('dueTo').value || undefined;
    state.filters.onlyRequireComment = el<HTMLInputElement>('onlyRequireComment').checked;
    state.filters.onlyHasCount = el<HTMLInputElement>('onlyHasCount').checked;
    state.filters.onlyHasHorizon = el<HTMLInputElement>('onlyHasHorizon').checked;

    state.filtered = state.allTasks.filter(matchesFilters);
    renderSelectedTags();
    renderList();
  }

  function resetFilters(): void {
    el<HTMLInputElement>('searchInput').value = '';
    el<HTMLSelectElement>('recurrenceSelect').value = 'all';
    el<HTMLInputElement>('tagInput').value = '';
    el<HTMLInputElement>('startFrom').value = '';
    el<HTMLInputElement>('startTo').value = '';
    el<HTMLInputElement>('dueFrom').value = '';
    el<HTMLInputElement>('dueTo').value = '';
    el<HTMLInputElement>('onlyRequireComment').checked = false;
    el<HTMLInputElement>('onlyHasCount').checked = false;
    el<HTMLInputElement>('onlyHasHorizon').checked = false;
    state.filters = {
      keyword: '',
      recurrence: 'all',
      tags: [],
      startFrom: undefined,
      startTo: undefined,
      dueFrom: undefined,
      dueTo: undefined,
      onlyRequireComment: false,
      onlyHasCount: false,
      onlyHasHorizon: false
    };
    renderSelectedTags();
    state.filtered = state.allTasks.slice();
    renderList();
  }

  async function loadData(): Promise<void> {
    const [tasks, tags] = await Promise.all([
      window.electronAPI.listTasks(),
      window.electronAPI.listTaskTags()
    ]);
    state.allTasks = (tasks as TaskRow[]) || [];
    state.filtered = state.allTasks.slice();
    state.tags = (tags as string[]) || [];
    renderTagOptions();
    renderSelectedTags();
    renderList();
  }

  function initEvents(): void {
    el<HTMLButtonElement>('addTagButton').addEventListener('click', () => { addTagFromInput(); });
    el<HTMLInputElement>('tagInput').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addTagFromInput();
      }
    });
    const autoApply = (): void => { applyFilters(); };
    el<HTMLSelectElement>('recurrenceSelect').addEventListener('change', autoApply);
    ['startFrom', 'startTo', 'dueFrom', 'dueTo'].forEach(id => {
      el<HTMLInputElement>(id).addEventListener('input', autoApply);
    });
    ['onlyRequireComment', 'onlyHasCount', 'onlyHasHorizon'].forEach(id => {
      el<HTMLInputElement>(id).addEventListener('change', autoApply);
    });
    el<HTMLButtonElement>('applyFilters').addEventListener('click', () => { applyFilters(); });
    el<HTMLButtonElement>('resetFilters').addEventListener('click', () => { resetFilters(); });
    el<HTMLInputElement>('searchInput').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        applyFilters();
      }
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadData().catch(err => {
      const list = el<HTMLDivElement>('taskList');
      list.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'empty';
      errDiv.textContent = `タスクの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      list.appendChild(errDiv);
      el<HTMLSpanElement>('resultsMeta').textContent = '';
    });
  });
})();
