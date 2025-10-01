// 共通ユーティリティ（タスク編集画面向け）

export type TaskRow = {
  ID?: number;
  TITLE: string;
  DESCRIPTION?: string | null;
  TAGS?: string[];
  DUE_AT?: string | null;
  START_DATE?: string | null;
  START_TIME?: string | null;
  IS_RECURRING?: number;
  // Recurrence rule (joined columns)
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
};

export type RecurrenceUIMode =
  | 'once'
  | 'daily'
  | 'everyNScheduled'
  | 'everyNCompleted'
  | 'weekly'
  | 'monthly'
  | 'monthlyNth'
  | 'yearly'
  | 'manualNext';

export function formatDateInput(dateStr?: string | null): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// DBの行からUIモードを推定
export function inferRecurrenceModeFromDb(t: TaskRow): RecurrenceUIMode {
  if (!t.IS_RECURRING) return 'once';
  if (Number((t as any).MANUAL_NEXT_DUE || 0) === 1) return 'manualNext';
  if (t.FREQ === 'monthly') {
    if ((t as any).MONTHLY_NTH !== null && typeof (t as any).MONTHLY_NTH !== 'undefined') return 'monthlyNth';
    return 'monthly';
  }
  if (t.FREQ === 'yearly') return 'yearly';
  if (t.FREQ === 'weekly') return 'weekly';
  if (t.FREQ === 'daily') {
    const interval = Number((t as any).INTERVAL || 1);
    const anchor = (t as any).INTERVAL_ANCHOR || 'scheduled';
    if (anchor === 'completed') return 'everyNCompleted';
    if (interval > 1) return 'everyNScheduled';
    return 'daily';
  }
  return 'daily';
}

// 週次: 配列<0..6> からビットマスクへ
export function weeklyMaskFromArray(dows: number[]): number {
  let mask = 0;
  for (const v of dows) {
    if (Number.isInteger(v) && v >= 0 && v <= 6) mask |= (1 << v);
  }
  return mask >>> 0;
}

// 週次: ビットマスクから配列<0..6> へ
export function weeklyArrayFromMask(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 6; i++) if (mask & (1 << i)) out.push(i);
  return out;
}
