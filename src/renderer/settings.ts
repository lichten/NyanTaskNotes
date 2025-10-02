(() => {
  function byId<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

  type TaskRow = {
    ID?: number;
    TITLE: string;
    DESCRIPTION?: string | null;
    TAGS?: string[];
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
    OCCURRENCE_OFFSET_DAYS?: number | null;
  };

  async function loadSettings() {
    const s = await window.electronAPI.getSettings();
    byId<HTMLInputElement>('filedb').value = s.fileDbPath || '';
    byId<HTMLInputElement>('taskdb').value = s.taskDbPath || '';
    const autoTag = typeof s.taskFileAutoTagName === 'string' && s.taskFileAutoTagName.trim()
      ? s.taskFileAutoTagName.trim()
      : 'タスク';
    byId<HTMLInputElement>('filedbAutoTag').value = autoTag;
  }

  async function onBrowseDb() {
    const res = await window.electronAPI.selectFileDbPath();
    if (!res.canceled && res.filePath) {
      byId<HTMLInputElement>('filedb').value = res.filePath;
    }
  }

  async function onBrowseTaskDb() {
    const api: any = (window as any).electronAPI;
    const res: any = await api.showFileDialog({
      title: 'タスクDBのSQLiteファイルを選択',
      properties: ['openFile', 'createDirectory'],
      filters: [
        { name: 'SQLite Database', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      byId<HTMLInputElement>('taskdb').value = res.filePaths[0];
    }
  }

  async function onSaveDb() {
    const path = byId<HTMLInputElement>('filedb').value.trim();
    const autoTag = byId<HTMLInputElement>('filedbAutoTag').value.trim() || 'タスク';
    const { success } = await window.electronAPI.saveSettings({ fileDbPath: path, taskFileAutoTagName: autoTag });
    const status = byId<HTMLDivElement>('status');
    status.textContent = success ? '保存しました。アプリを再起動するとDBが初期化されます。' : '保存に失敗しました';
  }

  async function onSaveTaskDb() {
    const path = byId<HTMLInputElement>('taskdb').value.trim();
    const { success } = await window.electronAPI.saveSettings({ taskDbPath: path });
    const status = byId<HTMLDivElement>('status');
    status.textContent = success ? '保存しました。アプリを再起動するとDBが初期化されます。' : '保存に失敗しました';
  }

  function weeklyArrayFromMask(mask: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= 6; i++) if (mask & (1 << i)) out.push(i);
    return out;
  }

  function formatFrequencyDetail(task: TaskRow): string {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const freq = (task.FREQ || '').toLowerCase();
    if (freq === 'daily') {
      const interval = Number(task.INTERVAL || 1);
      const anchor = (task.INTERVAL_ANCHOR || 'scheduled');
      if (anchor === 'completed') {
        return `完了から${interval}日ごと`;
      }
      if (interval <= 1) return '毎日';
      return `毎${interval}日 (予定基準)`;
    }
    if (freq === 'weekly') {
      const mask = Number(task.WEEKLY_DOWS || 0);
      let days: string[] = weeklyArrayFromMask(mask).map(i => weekdays[i] || '');
      if (!days.length) {
        if (task.START_DATE) {
          const d = new Date(task.START_DATE);
          if (!Number.isNaN(d.getTime())) days = [weekdays[d.getDay()] ?? ''];
        }
      }
      days = days.filter(Boolean);
      return days.length ? `毎週(${days.join('/')})` : '毎週';
    }
    if (freq === 'monthly') {
      if (task.MONTHLY_NTH != null && task.MONTHLY_NTH_DOW != null) {
        const nth = Number(task.MONTHLY_NTH);
        const dow = Number(task.MONTHLY_NTH_DOW);
        const dowLabel = weekdays[dow] ?? '';
        return `毎月 第${nth}${dowLabel}`;
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

  type CategoryInfo = { key: string; heading: string };

  function getCategory(task: TaskRow): CategoryInfo {
    const freq = (task.FREQ || '').toLowerCase();
    if (freq === 'daily') return { key: 'daily', heading: '## 毎日' };
    if (freq === 'weekly') return { key: 'weekly', heading: '## 毎週' };
    if (freq === 'monthly' && task.MONTHLY_NTH != null && task.MONTHLY_NTH_DOW != null) {
      return { key: 'monthlyNth', heading: '## 毎月（第N曜日）' };
    }
    if (freq === 'monthly') return { key: 'monthlyDay', heading: '## 毎月（日付指定）' };
    if (freq === 'yearly') return { key: 'yearly', heading: '## 毎年' };
    return { key: `other:${freq || 'unknown'}`, heading: `## その他 (${freq || '不明'})` };
  }

  function sortTasks(a: TaskRow, b: TaskRow): number {
    const titleA = a.TITLE || '';
    const titleB = b.TITLE || '';
    const cmp = titleA.localeCompare(titleB, 'ja');
    if (cmp !== 0) return cmp;
    return Number(a.ID || 0) - Number(b.ID || 0);
  }

  function formatTimestamp(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  async function generateRecurringMarkdown(): Promise<void> {
    const generateBtn = byId<HTMLButtonElement>('generateRecurring');
    const copyBtn = byId<HTMLButtonElement>('copyRecurring');
    const textarea = byId<HTMLTextAreaElement>('recurringMarkdown');
    const statusEl = byId<HTMLSpanElement>('exportStatus');
    generateBtn.disabled = true;
    copyBtn.disabled = true;
    statusEl.textContent = '生成中...';
    textarea.value = '';
    try {
      const rawTasks = await window.electronAPI.listTasks();
      const tasks = (rawTasks as TaskRow[]).filter(t => Number(t.IS_RECURRING || 0) === 1);
      const lines: string[] = ['# 繰り返しタスク一覧'];
      lines.push('');
      if (!tasks.length) {
        lines.push('（該当なし）');
      } else {
        const groups = new Map<string, { heading: string; tasks: TaskRow[] }>();
        for (const task of tasks) {
          const cat = getCategory(task);
          if (!groups.has(cat.key)) groups.set(cat.key, { heading: cat.heading, tasks: [] });
          groups.get(cat.key)!.tasks.push(task);
        }
        const orderKeys = ['daily', 'weekly', 'monthlyDay', 'monthlyNth', 'yearly'];
        const dynamicKeys = Array.from(groups.keys()).filter(k => !orderKeys.includes(k));
        const catKeys = [...orderKeys, ...dynamicKeys];
        for (const key of catKeys) {
          const group = groups.get(key);
          if (!group || group.tasks.length === 0) continue;
          lines.push(group.heading);
          lines.push('');
          const sorted = [...group.tasks].sort(sortTasks);
          for (const task of sorted) {
            const title = task.TITLE || '(無題)';
            const idPart = typeof task.ID === 'number' ? ` (ID: ${task.ID})` : '';
            lines.push(`### ${title}${idPart}`);
            lines.push(`- 開始日: ${task.START_DATE || '未設定'}`);
            if (task.START_TIME) lines.push(`- 開始時刻: ${task.START_TIME}`);
            lines.push(`- 頻度詳細: ${formatFrequencyDetail(task)}`);
            const count = Number(task.COUNT || 0);
            if (Number.isFinite(count) && count > 0) lines.push(`- 回数制限: ${count}回`);
            if (task.HORIZON_DAYS != null) lines.push(`- 作成間隔のホライズン: ${task.HORIZON_DAYS}日`);
            if (task.TAGS && task.TAGS.length) {
              const tagLine = task.TAGS.map(tag => `\`${tag}\``).join(', ');
              lines.push(`- タグ: ${tagLine}`);
            }
            if (task.DESCRIPTION) {
              lines.push('');
              const descLines = String(task.DESCRIPTION || '').split(/\r?\n/);
              lines.push(...descLines);
            }
            lines.push('');
          }
        }
      }
      textarea.value = lines.join('\n');
      textarea.scrollTop = 0;
      const hasClipboard = !!navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
      copyBtn.disabled = !hasClipboard || textarea.value.trim().length === 0;
      if (!hasClipboard) copyBtn.title = 'この環境ではコピー機能を利用できません';
      statusEl.textContent = `生成しました（${formatTimestamp()}）`;
    } catch (e) {
      textarea.value = '';
      copyBtn.disabled = true;
      const message = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `生成に失敗しました: ${message}`;
    } finally {
      generateBtn.disabled = false;
    }
  }

  async function copyRecurringMarkdown(): Promise<void> {
    const textarea = byId<HTMLTextAreaElement>('recurringMarkdown');
    const statusEl = byId<HTMLSpanElement>('exportStatus');
    const text = textarea.value;
    if (!text.trim()) {
      statusEl.textContent = 'コピー対象がありません';
      return;
    }
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      statusEl.textContent = 'クリップボードAPIが使用できません';
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = 'コピーしました';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `コピーに失敗しました: ${message}`;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    byId<HTMLButtonElement>('browseDb').addEventListener('click', onBrowseDb);
    byId<HTMLButtonElement>('saveDb').addEventListener('click', onSaveDb);
    byId<HTMLButtonElement>('browseTaskDb').addEventListener('click', onBrowseTaskDb);
    byId<HTMLButtonElement>('saveTaskDb').addEventListener('click', onSaveTaskDb);
    byId<HTMLButtonElement>('generateRecurring').addEventListener('click', () => { void generateRecurringMarkdown(); });
    const copyBtn = byId<HTMLButtonElement>('copyRecurring');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      copyBtn.addEventListener('click', () => { void copyRecurringMarkdown(); });
      copyBtn.disabled = true;
    } else {
      copyBtn.disabled = true;
      copyBtn.title = 'この環境ではコピー機能を利用できません';
    }
    loadSettings();
  });
})();
