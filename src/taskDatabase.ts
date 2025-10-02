import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export class TaskDatabase {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
      this.db = new sqlite3.Database(this.dbPath, mode, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    await this.createTables();
  }

  private resolveSchemaPath(): string {
    // ビルド成果物の近く: dist/../db/task_schema.sql
    const nearby = path.resolve(__dirname, '..', 'db', 'task_schema.sql');
    if (fs.existsSync(nearby)) return nearby;
    // 開発時のCWD配下
    const cwdPath = path.resolve(process.cwd(), 'db', 'task_schema.sql');
    return cwdPath;
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const schemaPath = this.resolveSchemaPath();
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    await new Promise<void>((resolve, reject) => {
      this.db!.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
    // Lightweight migrations for added columns
    await this.migrateSchema();
  }

  private async migrateSchema(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    // RECURRENCE_RULES: add HORIZON_DAYS if missing
    const cols: Array<{ name: string }> = await this.all<any>("PRAGMA table_info('RECURRENCE_RULES')");
    const hasHorizon = cols.some(c => String(c.name).toUpperCase() === 'HORIZON_DAYS');
    if (!hasHorizon) {
      await this.run("ALTER TABLE RECURRENCE_RULES ADD COLUMN HORIZON_DAYS INTEGER DEFAULT 14");
    }
    const hasIntervalAnchor = cols.some(c => String(c.name).toUpperCase() === 'INTERVAL_ANCHOR');
    if (!hasIntervalAnchor) {
      await this.run("ALTER TABLE RECURRENCE_RULES ADD COLUMN INTERVAL_ANCHOR TEXT NOT NULL DEFAULT 'scheduled'");
    }
    const hasWeeklyDows = cols.some(c => String(c.name).toUpperCase() === 'WEEKLY_DOWS');
    if (!hasWeeklyDows) {
      await this.run("ALTER TABLE RECURRENCE_RULES ADD COLUMN WEEKLY_DOWS INTEGER DEFAULT 0");
    }
    const hasManualNextDue = cols.some(c => String(c.name).toUpperCase() === 'MANUAL_NEXT_DUE');
    if (!hasManualNextDue) {
      await this.run("ALTER TABLE RECURRENCE_RULES ADD COLUMN MANUAL_NEXT_DUE INTEGER NOT NULL DEFAULT 0");
    }
    const hasOffset = cols.some(c => String(c.name).toUpperCase() === 'OCCURRENCE_OFFSET_DAYS');
    if (!hasOffset) {
      await this.run("ALTER TABLE RECURRENCE_RULES ADD COLUMN OCCURRENCE_OFFSET_DAYS INTEGER NOT NULL DEFAULT 0");
    }
    const hasYearlyMonth = cols.some(c => String(c.name).toUpperCase() === 'YEARLY_MONTH');
    if (!hasYearlyMonth) {
      await this.run("ALTER TABLE RECURRENCE_RULES ADD COLUMN YEARLY_MONTH INTEGER");
    }
    // TASK_EVENTS: ensure table and indexes exist
    await this.run(
      `CREATE TABLE IF NOT EXISTS TASK_EVENTS (
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        CREATED_AT TEXT NOT NULL,
        KIND TEXT NOT NULL,
        SOURCE TEXT NOT NULL CHECK(SOURCE IN ('user','system')),
        TASK_ID INTEGER,
        OCCURRENCE_ID INTEGER,
        DETAILS TEXT,
        FOREIGN KEY (TASK_ID) REFERENCES TASKS(ID) ON DELETE SET NULL,
        FOREIGN KEY (OCCURRENCE_ID) REFERENCES TASK_OCCURRENCES(ID) ON DELETE SET NULL
      )`
    );
    await this.run(`CREATE INDEX IF NOT EXISTS IDX_TASK_EVENTS_TASK_CREATED ON TASK_EVENTS (TASK_ID, CREATED_AT)`);
    await this.run(`CREATE INDEX IF NOT EXISTS IDX_TASK_EVENTS_OCC ON TASK_EVENTS (OCCURRENCE_ID)`);
    await this.run(`CREATE INDEX IF NOT EXISTS IDX_TASK_EVENTS_KIND_CREATED ON TASK_EVENTS (KIND, CREATED_AT)`);

    // TASKS: REQUIRE_COMPLETE_COMMENT
    const tcols: Array<{ name: string }> = await this.all<any>("PRAGMA table_info('TASKS')");
    const hasReqComment = tcols.some(c => String(c.name).toUpperCase() === 'REQUIRE_COMPLETE_COMMENT');
    if (!hasReqComment) {
      await this.run("ALTER TABLE TASKS ADD COLUMN REQUIRE_COMPLETE_COMMENT INTEGER NOT NULL DEFAULT 0");
    }

    const ocols: Array<{ name: string }> = await this.all<any>("PRAGMA table_info('TASK_OCCURRENCES')");
    const hasDeferred = ocols.some(c => String(c.name).toUpperCase() === 'DEFERRED_DATE');
    if (!hasDeferred) {
      await this.run("ALTER TABLE TASK_OCCURRENCES ADD COLUMN DEFERRED_DATE TEXT");
    }

    await this.run(
      `CREATE TABLE IF NOT EXISTS TASK_FILE_LINKS (
        TASK_ID INTEGER NOT NULL REFERENCES TASKS(ID) ON DELETE CASCADE,
        FILE_SHA256 TEXT NOT NULL,
        CREATED_AT TEXT,
        UPDATED_AT TEXT,
        PRIMARY KEY (TASK_ID, FILE_SHA256)
      )`
    );
    await this.run('CREATE INDEX IF NOT EXISTS IDX_TASK_FILE_LINKS_SHA ON TASK_FILE_LINKS (FILE_SHA256)');
  }

  private async logEvent(kind: string, source: 'user' | 'system', taskId?: number | null, occurrenceId?: number | null, details?: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const now = this.nowIso();
    let detailsStr: string | null = null;
    try {
      if (typeof details !== 'undefined') detailsStr = JSON.stringify(details);
    } catch {
      detailsStr = null;
    }
    await this.run(
      `INSERT INTO TASK_EVENTS (CREATED_AT, KIND, SOURCE, TASK_ID, OCCURRENCE_ID, DETAILS) VALUES (?, ?, ?, ?, ?, ?)`,
      [now, kind, source, taskId ?? null, occurrenceId ?? null, detailsStr]
    );
  }

  getDb(): sqlite3.Database | null {
    return this.db;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
    this.db = null;
  }

  // ===== Tasks CRUD (minimum) =====
  private run(sql: string, params: any[] = []): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.run(sql, params, function (this: sqlite3.RunResult, err) {
        if (err) reject(err); else resolve(this.lastID || this.changes || 0);
      });
    });
  }

  // ===== Occurrences (recurring instances) =====
  private clampMonthlyDate(year: number, monthIndex0: number, day: number): string {
    const last = new Date(year, monthIndex0 + 1, 0).getDate();
    const d = Math.min(Math.max(day, 1), last);
    const dt = new Date(year, monthIndex0, d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const da = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  private nthWeekdayOfMonth(year: number, monthIndex0: number, nth: number, dow: number): string {
    // nth: 1..5 or -1=last; dow: 0..6 (Sun..Sat)
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
    if (day > last) day -= 7; // clamp to previous week if 5th doesn't exist
    const dt = new Date(year, monthIndex0, day);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const da = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  private normalizeDateOnly(value?: string | null): string {
    const raw = (value ?? '').trim();
    if (!raw) throw new Error('延期日付が指定されていません');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`延期日付の形式が不正です: ${raw}`);
    }
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private dateToYmd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  private parseDateOnlyStrict(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
    const [yy, mm, dd] = value.split('-').map(Number);
    return new Date(yy, (mm ?? 1) - 1, dd ?? 1);
  }

  private applyOccurrenceOffset(baseDateStr: string, offsetDays: number): string {
    if (!offsetDays) return baseDateStr;
    const baseDate = this.parseDateOnlyStrict(baseDateStr);
    const shifted = new Date(baseDate);
    shifted.setDate(baseDate.getDate() + offsetDays);
    return this.dateToYmd(shifted);
  }

  private occurrenceAnchorDate(startDateStr: string | null | undefined, offsetDays: number): string | null {
    if (!startDateStr) return null;
    const start = this.parseDateOnlyStrict(startDateStr);
    const actual = this.parseDateOnlyStrict(this.applyOccurrenceOffset(startDateStr, offsetDays));
    const anchor = actual < start ? actual : start;
    return this.dateToYmd(anchor);
  }

  private normalizeOccurrenceOffset(value: any): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const rounded = Math.round(n);
    if (rounded > 365) return 365;
    if (rounded < -365) return -365;
    return rounded;
  }

  private async ensureRecurringMonthlyOccurrences(monthsAhead: number = 2): Promise<void> {
    // COUNT=0: 現在月〜先N-1ヶ月を生成。COUNT>=1: START_DATE から回数分の月次日付を生成（不足のみ追加）。
    const now = new Date();
    const startYear = now.getFullYear();
    const startMonth0 = now.getMonth();
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, R.MONTHLY_DAY, R.COUNT,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'monthly'
       WHERE T.IS_RECURRING = 1 AND COALESCE(R.MANUAL_NEXT_DUE,0) = 0`
    );
    for (const t of tasks) {
      const monthlyDay = Number(t.MONTHLY_DAY);
      if (!monthlyDay || isNaN(monthlyDay)) continue;
      const count = Number(t.COUNT || 0);
      const offsetDays = Number(t.OCCURRENCE_OFFSET_DAYS || 0);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const anchorDateStr = this.occurrenceAnchorDate(t.START_DATE ?? null, offsetDays) ?? (t.START_DATE ?? null);
        const startDate = new Date(t.START_DATE as string);
        let i = 0;
        while (i < count * 2 && i < 240) { // safety cap
          const m0 = (startDate.getMonth() + i) % 12;
          const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
          const baseDateStr = this.clampMonthlyDate(y, m0, monthlyDay);
          i++;
          if (new Date(baseDateStr) < startDate) continue;
          const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'monthly.ensure.count', date: scheduledDate }); } catch {}
          }
          // Stop once we ensured up to COUNT future dates exist (we don't delete here)
          const ensuredLowerBound = anchorDateStr ?? t.START_DATE;
          const ensured = await this.get<any>(`SELECT COUNT(1) AS C FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE >= ?`, [t.TASK_ID, ensuredLowerBound]);
          if (ensured && Number(ensured.C) >= count) break;
        }
      } else {
        for (let i = 0; i < monthsAhead; i++) {
          const m0 = (startMonth0 + i) % 12;
          const y = startYear + Math.floor((startMonth0 + i) / 12);
          const baseDateStr = this.clampMonthlyDate(y, m0, monthlyDay);
          if (t.START_DATE && new Date(baseDateStr) < new Date(t.START_DATE)) continue;
          const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'monthly.ensure.window', date: scheduledDate }); } catch {}
          }
        }
      }
    }
    // Handle monthly by nth weekday
    const nthTasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, R.MONTHLY_NTH, R.MONTHLY_NTH_DOW, R.COUNT,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'monthly'
       WHERE T.IS_RECURRING = 1 AND COALESCE(R.MANUAL_NEXT_DUE,0) = 0 AND R.MONTHLY_NTH IS NOT NULL AND R.MONTHLY_NTH_DOW IS NOT NULL`
    );
    for (const t of nthTasks) {
      const nth = Number(t.MONTHLY_NTH);
      const dow = Number(t.MONTHLY_NTH_DOW);
      if (isNaN(nth) || isNaN(dow)) continue;
      const count = Number(t.COUNT || 0);
      const offsetDays = Number(t.OCCURRENCE_OFFSET_DAYS || 0);
      const anchorDateStr = this.occurrenceAnchorDate(t.START_DATE ?? null, offsetDays) ?? (t.START_DATE ?? null);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const startDate = new Date(t.START_DATE as string);
        let i = 0;
        while (i < count * 2 && i < 240) {
          const m0 = (startDate.getMonth() + i) % 12;
          const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
          const baseDateStr = this.nthWeekdayOfMonth(y, m0, nth, dow);
          i++;
          if (new Date(baseDateStr) < startDate) continue;
          const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
          const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [t.TASK_ID, scheduledDate]);
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
               [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
              );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'monthlyNth.ensure.count', date: scheduledDate }); } catch {}
          }
          const ensuredLowerBound = anchorDateStr ?? t.START_DATE;
          const ensured = await this.get<any>(`SELECT COUNT(1) AS C FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE >= ?`, [t.TASK_ID, ensuredLowerBound]);
          if (ensured && Number(ensured.C) >= count) break;
        }
      } else {
        for (let i = 0; i < monthsAhead; i++) {
          const m0 = (startMonth0 + i) % 12;
          const y = startYear + Math.floor((startMonth0 + i) / 12);
          const baseDateStr = this.nthWeekdayOfMonth(y, m0, nth, dow);
          if (t.START_DATE && new Date(baseDateStr) < new Date(t.START_DATE)) continue;
          const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
          const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [t.TASK_ID, scheduledDate]);
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'monthlyNth.ensure.count', date: scheduledDate }); } catch {}
          }
        }
      }
    }
  }

  private async ensureRecurringYearlyOccurrences(yearsAhead: number = 2): Promise<void> {
    // COUNT=0: 今年〜先N-1年の対象月日を生成。COUNT>=1: START_DATE以降でCOUNT件生成。
    const now = new Date();
    const startYear = now.getFullYear();
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME,
              R.YEARLY_MONTH, R.MONTHLY_DAY, R.COUNT,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'yearly'
       WHERE T.IS_RECURRING = 1 AND COALESCE(R.MANUAL_NEXT_DUE,0) = 0`
    );
    for (const t of tasks) {
      const month = Number(t.YEARLY_MONTH || 0);
      const day = Number(t.MONTHLY_DAY || 0);
      if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) continue;
      const count = Number(t.COUNT || 0);
      const offsetDays = Number(t.OCCURRENCE_OFFSET_DAYS || 0);
      const anchorDateStr = this.occurrenceAnchorDate(t.START_DATE ?? null, offsetDays) ?? (t.START_DATE ?? null);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const startDate = new Date(t.START_DATE as string);
        // first target on or after START_DATE
        let y = startDate.getFullYear();
        let baseScheduled = this.clampMonthlyDate(y, month - 1, day);
        if (new Date(baseScheduled) < startDate) {
          y += 1;
          baseScheduled = this.clampMonthlyDate(y, month - 1, day);
        }
        let produced = 0;
        while (produced < count && produced < 200) {
          const base = produced === 0 ? baseScheduled : this.clampMonthlyDate(y + produced, month - 1, day);
          const scheduled = this.applyOccurrenceOffset(base, offsetDays);
          const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [t.TASK_ID, scheduled]);
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduled, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'yearly.ensure.count', date: scheduled }); } catch {}
          }
          produced++;
        }
      } else {
        for (let i = 0; i < yearsAhead; i++) {
          const y = startYear + i;
          const base = this.clampMonthlyDate(y, month - 1, day);
          if (t.START_DATE && new Date(base) < new Date(t.START_DATE)) continue;
          const scheduled = this.applyOccurrenceOffset(base, offsetDays);
          const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [t.TASK_ID, scheduled]);
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduled, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'yearly.ensure.window', date: scheduled }); } catch {}
          }
        }
      }
    }
  }

  private async ensureRecurringDailyOccurrences(defaultDaysAhead: number = 14): Promise<void> {
    // For COUNT=0 (infinite): create today..today+N-1 days.
    // For COUNT>=1 (finite): ensure exactly COUNT dates from START_DATE exist (add missing only).
    const today = new Date();
    const startDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${da}`;
    };
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, R.COUNT,
              COALESCE(R.HORIZON_DAYS, ?) AS HORIZON_DAYS,
              COALESCE(R.INTERVAL, 1) AS INTERVAL,
              COALESCE(R.INTERVAL_ANCHOR, 'scheduled') AS INTERVAL_ANCHOR,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'daily'
       WHERE T.IS_RECURRING = 1 AND COALESCE(R.MANUAL_NEXT_DUE,0) = 0`, [defaultDaysAhead]
    );
    for (const t of tasks) {
      const interval = Math.max(1, Number(t.INTERVAL || 1));
      const anchor = String(t.INTERVAL_ANCHOR || 'scheduled');
      if (anchor === 'completed') continue; // 完了基準は先出ししない
      const count = Number(t.COUNT || 0);
      const offsetDays = Number(t.OCCURRENCE_OFFSET_DAYS || 0);
      const anchorDateStr = this.occurrenceAnchorDate(t.START_DATE ?? null, offsetDays) ?? (t.START_DATE ?? null);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const start = new Date(t.START_DATE as string);
        for (let i = 0; i < count; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i * interval);
          const baseDateStr = startDateStr(d);
          const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'monthlyNth.ensure.window', date: scheduledDate }); } catch {}
          }
        }
      } else {
        let horizon = Number(t.HORIZON_DAYS || defaultDaysAhead);
        if (!isFinite(horizon) || horizon <= 0) horizon = defaultDaysAhead;
        if (horizon > 365) horizon = 365; // safety upper bound
        // generate only dates aligned with interval from START_DATE
        const start = t.START_DATE ? new Date(t.START_DATE as string) : new Date(today);
        for (let i = 0; i < horizon; i++) {
          const d = new Date(today);
          d.setDate(today.getDate() + i);
          const daysDiff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / (1000*60*60*24));
          if (daysDiff < 0) continue;
          if (daysDiff % interval !== 0) continue;
          const baseDateStr = startDateStr(d);
          const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            const newId = await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
            try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'daily.ensure.count', date: scheduledDate }); } catch {}
          }
        }
      }
    }
  }

  private async ensureRecurringWeeklyOccurrences(_: number = 8): Promise<void> {
    // COUNT>=1: START_DATE以降で対象曜日の発生日をCOUNT件生成。
    // COUNT=0: 「次に発生する１件」のみを保持し、それ以降のオカレンスは削除する。
    const today = new Date();
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME,
              COALESCE(R.WEEKLY_DOWS,0) AS WEEKLY_DOWS,
              COALESCE(R.INTERVAL,1) AS INTERVAL,
              COALESCE(R.COUNT,0) AS COUNT,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'weekly'
       WHERE T.IS_RECURRING = 1 AND COALESCE(R.MANUAL_NEXT_DUE,0) = 0`
    );
    for (const t of tasks) {
      const dowsMask = Number(t.WEEKLY_DOWS || 0);
      if (!dowsMask) continue;
      const interval = Math.max(1, Number(t.INTERVAL || 1));
      const count = Number(t.COUNT || 0);
      const offsetDays = Number(t.OCCURRENCE_OFFSET_DAYS || 0);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const start = new Date(t.START_DATE as string);
        const start0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const startSunday = new Date(start0);
        startSunday.setDate(start0.getDate() - start0.getDay());
        let produced = 0;
        for (let w = 0; w < 520 && produced < count; w += interval) {
          const weekStart = new Date(startSunday);
          weekStart.setDate(startSunday.getDate() + w * 7);
          for (let dow = 0; dow <= 6 && produced < count; dow++) {
            if (!(dowsMask & (1 << dow))) continue;
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + dow);
            if (d < start0) continue;
            const baseDateStr = dateStr(d);
            const scheduledDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
            const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [t.TASK_ID, scheduledDate]);
            if (!exists) {
              const nowIso = this.nowIso();
              const newId = await this.run(
                `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
                 VALUES (?, ?, ?, 'pending', ?, ?)`,
                [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
              );
              try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'weekly.ensure.window', date: scheduledDate }); } catch {}
            }
            produced++;
          }
        }
      } else {
        const start = t.START_DATE ? new Date(t.START_DATE as string) : today0;
        const start0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const startSunday = new Date(start0);
        startSunday.setDate(start0.getDate() - start0.getDay());
        const findNextDate = (): string | null => {
          for (let w = 0; w < 520; w++) {
            const weekStart = new Date(startSunday);
            weekStart.setDate(startSunday.getDate() + w * 7);
            const weeksDiff = Math.floor((weekStart.getTime() - startSunday.getTime()) / (1000 * 60 * 60 * 24 * 7));
            if (weeksDiff < 0) continue;
            if (weeksDiff % interval !== 0) continue;
            for (let dow = 0; dow <= 6; dow++) {
              if (!(dowsMask & (1 << dow))) continue;
              const candidate = new Date(weekStart);
              candidate.setDate(weekStart.getDate() + dow);
              if (candidate < start0) continue;
              const baseDateStr = dateStr(candidate);
              const actualDate = this.applyOccurrenceOffset(baseDateStr, offsetDays);
              const actual = this.parseDateOnlyStrict(actualDate);
              if (actual < today0) continue;
              return actualDate;
            }
          }
          return null;
        };

        const nextDate = findNextDate();
        if (!nextDate) continue;

        const futureOccs = await this.all<any>(
          `SELECT ID, SCHEDULED_DATE FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE >= ? ORDER BY SCHEDULED_DATE ASC`,
          [t.TASK_ID, dateStr(today0)]
        );
        let hasTarget = false;
        for (const occ of futureOccs) {
          if (occ.SCHEDULED_DATE === nextDate) {
            if (!hasTarget) { hasTarget = true; continue; }
          }
          if (occ.SCHEDULED_DATE > nextDate || occ.SCHEDULED_DATE === nextDate) {
            await this.run(`DELETE FROM TASK_OCCURRENCES WHERE ID = ?`, [occ.ID]);
            try { await this.logEvent('occ.delete', 'system', t.TASK_ID, occ.ID, { reason: 'weekly.prune.window', date: occ.SCHEDULED_DATE }); } catch {}
          }
        }

        if (!hasTarget) {
          const nowIso = this.nowIso();
          const newId = await this.run(
            `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [t.TASK_ID, nextDate, t.START_TIME || null, nowIso, nowIso]
          );
          try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'weekly.ensure.nextOnly', date: nextDate }); } catch {}
        }
      }
    }
  }

  private async ensureDailyCompletedAnchorOccurrences(): Promise<void> {
    // 保証: 完了基準のタスクは pending を最大1件に保つ。必要なら1件だけ生成。
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME,
              COALESCE(R.INTERVAL, 1) AS INTERVAL,
              COALESCE(R.COUNT, 0) AS COUNT,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'daily' AND COALESCE(R.INTERVAL_ANCHOR,'scheduled') = 'completed'
       WHERE T.IS_RECURRING = 1 AND COALESCE(R.MANUAL_NEXT_DUE,0) = 0`
    );
    const dateOnly = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    for (const t of tasks) {
      const interval = Math.max(1, Number(t.INTERVAL || 1));
      const start = t.START_DATE ? new Date(t.START_DATE as string) : new Date();
      const offsetDays = Number(t.OCCURRENCE_OFFSET_DAYS || 0);
      // 現在の pending を確認
      const pendings = await this.all<any>(`SELECT ID, SCHEDULED_DATE FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND STATUS = 'pending' ORDER BY SCHEDULED_DATE ASC`, [t.TASK_ID]);
      if (pendings.length > 1) {
        // 先頭を残し、他を削除
        for (let i = 1; i < pendings.length; i++) {
          await this.run(`DELETE FROM TASK_OCCURRENCES WHERE ID = ?`, [pendings[i].ID]);
        }
      }
      // 停止条件（COUNT）
      const doneCountRow = await this.get<any>(`SELECT COUNT(1) AS C FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND STATUS = 'done'`, [t.TASK_ID]);
      const doneCount = Number((doneCountRow && doneCountRow.C) || 0);
      const finite = Number(t.COUNT || 0) >= 1;
      if (finite && doneCount >= Number(t.COUNT)) {
        // もう生成しない。余剰pendingがあれば削除
        if (pendings.length === 1) await this.run(`DELETE FROM TASK_OCCURRENCES WHERE ID = ?`, [pendings[0].ID]);
        continue;
      }
      if (pendings.length === 1) continue; // 1件あればOK
      // 初回（過去含め発生履歴が0件）の場合は START_DATE で1件生成（INTERVALを足さない）
      const totalCountRow = await this.get<any>(`SELECT COUNT(1) AS C FROM TASK_OCCURRENCES WHERE TASK_ID = ?`, [t.TASK_ID]);
      const totalCount = Number((totalCountRow && totalCountRow.C) || 0);
      let nextDate: string;
      if (totalCount === 0) {
        const baseStart = dateOnly(start);
        nextDate = this.applyOccurrenceOffset(baseStart, offsetDays);
      } else {
        // 基準日: 直近の完了日 or START_DATE
        const lastDone = await this.get<any>(`SELECT COMPLETED_AT FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND STATUS = 'done' ORDER BY DATE(COALESCE(COMPLETED_AT, UPDATED_AT)) DESC LIMIT 1`, [t.TASK_ID]);
        let base = start;
        if (lastDone && lastDone.COMPLETED_AT) {
          const d = new Date(lastDone.COMPLETED_AT as string);
          base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
        const next = new Date(base);
        next.setDate(base.getDate() + interval);
        nextDate = this.applyOccurrenceOffset(dateOnly(next), offsetDays);
      }
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [t.TASK_ID, nextDate]);
      if (!exists) {
        const nowIso = this.nowIso();
        const newId = await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [t.TASK_ID, nextDate, t.START_TIME || null, nowIso, nowIso]
        );
        try { await this.logEvent('occ.autocreate', 'system', t.TASK_ID, newId, { reason: 'daily.completed.ensure', date: nextDate }); } catch {}
      }
    }
  }

  private async reconcileOccurrencesForTask(taskId: number): Promise<void> {
    // Align TASK_OCCURRENCES to the finite COUNT for the task's recurrence rule (daily/weekly/monthly).
    const task = await this.get<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, T.IS_RECURRING,
              R.FREQ, R.MONTHLY_DAY, R.MONTHLY_NTH, R.MONTHLY_NTH_DOW, R.COUNT,
              COALESCE(R.WEEKLY_DOWS,0) AS WEEKLY_DOWS,
              COALESCE(R.INTERVAL,1) AS INTERVAL,
              COALESCE(R.INTERVAL_ANCHOR,'scheduled') AS INTERVAL_ANCHOR,
              COALESCE(R.MANUAL_NEXT_DUE,0) AS MANUAL_NEXT_DUE,
              COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
       FROM TASKS T
       LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
       WHERE T.ID = ?`, [taskId]
    );
    if (!task || !task.IS_RECURRING) return;
    if (Number((task as any).MANUAL_NEXT_DUE || 0) === 1) return;
    const count = Number(task.COUNT || 0);
    if (!task.START_DATE || !(count >= 1)) return; // only finite counts
    const startDate = new Date(task.START_DATE as string);
    const startDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const offsetDays = Number((task as any).OCCURRENCE_OFFSET_DAYS || 0);
    const anchorDateStr = this.occurrenceAnchorDate(task.START_DATE as string, offsetDays) ?? startDateStr(startDate);

    const targetDates: string[] = [];
    if (task.FREQ === 'daily') {
      const interval = Math.max(1, Number((task as any).INTERVAL || 1));
      const anchor = String((task as any).INTERVAL_ANCHOR || 'scheduled');
      if (anchor === 'completed') {
        return; // 完了基準はここで正規化しない（pending=1件維持のポリシー）
      }
      for (let i = 0; i < count; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i * interval);
        const baseDateStr = startDateStr(d);
        targetDates.push(this.applyOccurrenceOffset(baseDateStr, offsetDays));
      }
    } else if (task.FREQ === 'weekly') {
      const mask = Number((task as any).WEEKLY_DOWS || 0);
      if (!mask) return;
      const interval = Math.max(1, Number((task as any).INTERVAL || 1));
      const start0 = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const startSunday = new Date(start0);
      startSunday.setDate(start0.getDate() - start0.getDay());
      for (let w = 0; targetDates.length < count && w < 520; w += interval) {
        const weekStart = new Date(startSunday);
        weekStart.setDate(startSunday.getDate() + w * 7);
        for (let dow = 0; dow <= 6 && targetDates.length < count; dow++) {
          if (!(mask & (1 << dow))) continue;
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + dow);
          if (d < start0) continue;
          targetDates.push(this.applyOccurrenceOffset(startDateStr(d), offsetDays));
        }
      }
    } else if (task.FREQ === 'monthly' && task.MONTHLY_DAY) {
      const monthlyDay = Number(task.MONTHLY_DAY);
      let i = 0;
      while (targetDates.length < count) {
        const m0 = (startDate.getMonth() + i) % 12;
        const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
        const base = this.clampMonthlyDate(y, m0, monthlyDay);
        if (new Date(base) >= startDate) targetDates.push(this.applyOccurrenceOffset(base, offsetDays));
        i++;
      }
    } else if (task.FREQ === 'monthly' && task.MONTHLY_NTH != null && task.MONTHLY_NTH_DOW != null) {
      const nth = Number(task.MONTHLY_NTH);
      const dow = Number(task.MONTHLY_NTH_DOW);
      let i = 0;
      while (targetDates.length < count) {
        const m0 = (startDate.getMonth() + i) % 12;
        const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
        const base = this.nthWeekdayOfMonth(y, m0, nth, dow);
        if (new Date(base) >= startDate) targetDates.push(this.applyOccurrenceOffset(base, offsetDays));
        i++;
      }
    } else if (task.FREQ === 'yearly' && (task as any).YEARLY_MONTH && task.MONTHLY_DAY) {
      const month = Number((task as any).YEARLY_MONTH);
      const day = Number(task.MONTHLY_DAY);
      let y = startDate.getFullYear();
      // first occurrence on/after start
      let base = this.clampMonthlyDate(y, month - 1, day);
      if (new Date(base) < startDate) {
        y += 1;
        base = this.clampMonthlyDate(y, month - 1, day);
      }
      while (targetDates.length < count) {
        targetDates.push(this.applyOccurrenceOffset(base, offsetDays));
        y += 1;
        base = this.clampMonthlyDate(y, month - 1, day);
      }
    } else {
      return; // unsupported freq for reconciliation
    }

    const existing = await this.all<any>(
      `SELECT ID, SCHEDULED_DATE, STATUS FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE >= ?`,
      [taskId, anchorDateStr]
    );
    const existingByDate = new Map<string, { id: number; status: string }>();
    for (const e of existing) existingByDate.set(e.SCHEDULED_DATE, { id: e.ID, status: e.STATUS });

    // Delete occurrences not in target set (all statuses含む)
    for (const e of existing) {
      if (!targetDates.includes(e.SCHEDULED_DATE)) {
        await this.run(`DELETE FROM TASK_OCCURRENCES WHERE ID = ?`, [e.ID]);
        try { await this.logEvent('occ.delete', 'system', taskId, e.ID, { reason: 'reconcile.remove', date: e.SCHEDULED_DATE, status: e.STATUS }); } catch {}
      }
    }

    // Add missing occurrences
    const nowIso = this.nowIso();
    for (const d of targetDates) {
      if (!existingByDate.has(d)) {
        const newId = await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [taskId, d, task.START_TIME || null, nowIso, nowIso]
        );
        try { await this.logEvent('occ.autocreate', 'system', taskId, newId, { reason: 'reconcile.add', date: d }); } catch {}
      }
    }
  }

  private async ensureSingleOccurrences(): Promise<void> {
    // Ensure a single occurrence exists for non-recurring tasks with a scheduled date.
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, DATE(COALESCE(T.DUE_AT, T.START_DATE)) AS S_DATE, T.START_TIME
       FROM TASKS T
       WHERE T.IS_RECURRING = 0
         AND DATE(COALESCE(T.DUE_AT, T.START_DATE)) IS NOT NULL`
    );
    const nowIso = this.nowIso();
    for (const t of tasks) {
      const rule = await this.get<any>('SELECT ID FROM RECURRENCE_RULES WHERE TASK_ID = ?', [t.TASK_ID]);
      if (!rule) {
        await this.run(
          `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?)`,
          [t.TASK_ID, 'monthly', null, 1, nowIso, nowIso]
        );
      }
      const scheduledDate = t.S_DATE as string;
      const exists = await this.get<any>(
        `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
        [t.TASK_ID, scheduledDate]
      );
      if (!exists) {
        await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
        );
      }
    }
  }

  private async ensureManualNextOccurrence(taskId: number, scheduledDate: string | null, startTime: string | null): Promise<void> {
    const normalizedDate = scheduledDate ? String(scheduledDate).split('T')[0] : null;
    const nowIso = this.nowIso();
    const pendings = await this.all<any>(
      `SELECT ID, SCHEDULED_DATE, SCHEDULED_TIME FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND STATUS = 'pending' ORDER BY ID ASC`,
      [taskId]
    );

    if (!normalizedDate) {
      for (const occ of pendings) {
        await this.run('DELETE FROM TASK_OCCURRENCES WHERE ID = ?', [occ.ID]);
        try { await this.logEvent('occ.delete', 'system', taskId, occ.ID, { reason: 'manual.prune.noDate', previousDate: occ.SCHEDULED_DATE }); } catch {}
      }
      return;
    }

    let primary = pendings.find((o: any) => o.SCHEDULED_DATE === normalizedDate) || null;
    if (!primary && pendings.length > 0) {
      primary = pendings[0];
    }

    if (primary) {
      const needsUpdate = primary.SCHEDULED_DATE !== normalizedDate || (primary.SCHEDULED_TIME ?? null) !== (startTime ?? null);
      if (needsUpdate) {
        await this.run(
          `UPDATE TASK_OCCURRENCES SET SCHEDULED_DATE = ?, SCHEDULED_TIME = ?, UPDATED_AT = ? WHERE ID = ?`,
          [normalizedDate, startTime || null, nowIso, primary.ID]
        );
        try {
          await this.logEvent('occ.reschedule', 'system', taskId, primary.ID, {
            reason: 'manual.realign',
            previousDate: primary.SCHEDULED_DATE,
            previousTime: primary.SCHEDULED_TIME ?? null,
            newDate: normalizedDate,
            newTime: startTime || null
          });
        } catch {}
      }
    } else {
      const newId = await this.run(
        `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
        [taskId, normalizedDate, startTime || null, nowIso, nowIso]
      );
      try { await this.logEvent('occ.autocreate', 'system', taskId, newId, { reason: 'manual.ensure', date: normalizedDate }); } catch {}
      primary = { ID: newId, SCHEDULED_DATE: normalizedDate, SCHEDULED_TIME: startTime || null };
    }

    for (const occ of pendings) {
      if (primary && occ.ID === primary.ID) continue;
      await this.run('DELETE FROM TASK_OCCURRENCES WHERE ID = ?', [occ.ID]);
      try { await this.logEvent('occ.delete', 'system', taskId, occ.ID, { reason: 'manual.prune', previousDate: occ.SCHEDULED_DATE }); } catch {}
    }
  }

  async listOccurrences(params: { from?: string; to?: string; query?: string; status?: string } = {}): Promise<any[]> {
    // Ensure occurrences exist for both recurring and single tasks
    await this.ensureSingleOccurrences();
    await this.ensureRecurringMonthlyOccurrences(2);
    await this.ensureRecurringYearlyOccurrences(2);
    await this.ensureRecurringWeeklyOccurrences(8);
    await this.ensureRecurringDailyOccurrences(14);
    await this.ensureDailyCompletedAnchorOccurrences();

    const where: string[] = [];
    const binds: any[] = [];
    if (params.from) { where.push('O.SCHEDULED_DATE >= ?'); binds.push(params.from); }
    if (params.to) { where.push('O.SCHEDULED_DATE <= ?'); binds.push(params.to); }
    if (params.status) { where.push('O.STATUS = ?'); binds.push(params.status); }
    if (params.query) { where.push('(T.TITLE LIKE ? OR T.DESCRIPTION LIKE ?)'); binds.push(`%${params.query}%`, `%${params.query}%`); }
    const sql = `SELECT O.ID AS OCCURRENCE_ID, O.SCHEDULED_DATE, O.SCHEDULED_TIME, O.DEFERRED_DATE, O.STATUS AS OCC_STATUS, O.COMPLETED_AT,
                        T.ID AS TASK_ID, T.TITLE, T.DESCRIPTION, T.DUE_AT,
                        T.START_DATE, T.START_TIME, T.IS_RECURRING, T.REQUIRE_COMPLETE_COMMENT,
                        R.FREQ, R.MONTHLY_DAY, R.COUNT, R.MANUAL_NEXT_DUE, COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
                 FROM TASK_OCCURRENCES O
                 JOIN TASKS T ON T.ID = O.TASK_ID
                 LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY O.SCHEDULED_DATE ASC, O.ID ASC`;
    const rows = await this.all<any>(sql, binds);
    if (!rows.length) return rows;
    const cache = new Map<number, string[]>();
    const uniqueTaskIds = Array.from(new Set(rows.map(r => Number(r.TASK_ID))));
    for (const taskId of uniqueTaskIds) {
      cache.set(taskId, await this.getTagsForTask(taskId));
    }
    for (const row of rows) {
      const taskId = Number(row.TASK_ID);
      row.TAGS = cache.get(taskId) || [];
    }
    return rows;
  }

  async completeOccurrence(occurrenceId: number, options: { comment?: string; completedAt?: string; manualNextDue?: string } = {}): Promise<void> {
    const now = this.nowIso();
    const completedAtIso = this.normalizeCompletedAtInput(options?.completedAt) ?? now;
    const occ = await this.get<any>(
      `SELECT O.ID, O.TASK_ID, O.SCHEDULED_DATE, T.START_DATE, T.START_TIME,
              R.FREQ, R.MONTHLY_DAY, R.MONTHLY_NTH, R.MONTHLY_NTH_DOW, R.COUNT, R.YEARLY_MONTH,
              COALESCE(R.INTERVAL,1) AS INTERVAL,
              COALESCE(R.INTERVAL_ANCHOR,'scheduled') AS INTERVAL_ANCHOR,
              COALESCE(R.MANUAL_NEXT_DUE,0) AS MANUAL_NEXT_DUE
       FROM TASK_OCCURRENCES O
       JOIN TASKS T ON T.ID = O.TASK_ID
       LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
       WHERE O.ID = ?`, [occurrenceId]
    );
    if (!occ) return;
    const prevStatus = 'pending';
    await this.run(`UPDATE TASK_OCCURRENCES SET STATUS = 'done', COMPLETED_AT = ?, UPDATED_AT = ? WHERE ID = ?`, [completedAtIso, now, occurrenceId]);
    // Log: occ.complete (user)
    try {
      const details: any = { from: prevStatus, to: 'done', completedAt: completedAtIso };
      if (options && typeof options.comment !== 'undefined') details.comment = options.comment;
      await this.logEvent('occ.complete', 'user', Number(occ.TASK_ID), occurrenceId, details);
    } catch {}
    // Generate next occurrence for recurring tasks
    const manualNextDue = Number((occ as any).MANUAL_NEXT_DUE || 0) === 1;
    if (manualNextDue) {
      const nextDueRaw = options && typeof options.manualNextDue === 'string' ? options.manualNextDue : undefined;
      if (!nextDueRaw) {
        throw new Error('次の期日が指定されていません');
      }
      const nextDate = this.normalizeDateOnly(nextDueRaw);
      if (typeof occ.SCHEDULED_DATE === 'string' && nextDate < occ.SCHEDULED_DATE) {
        throw new Error('次の期日は現在の期日以降を指定してください');
      }
      const scheduledTime = occ.START_TIME || null;
      await this.run('UPDATE TASKS SET DUE_AT = ?, START_DATE = ?, UPDATED_AT = ? WHERE ID = ?', [nextDate, nextDate, now, occ.TASK_ID]);
      await this.ensureManualNextOccurrence(occ.TASK_ID, nextDate, scheduledTime);
      try {
        await this.logEvent('task.manual.nextDue', 'user', Number(occ.TASK_ID), occurrenceId, { previousDate: occ.SCHEDULED_DATE, nextDate });
      } catch {}
      return;
    }

    if (occ.FREQ === 'monthly' && occ.MONTHLY_DAY && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const d = new Date(occ.SCHEDULED_DATE as string);
      const nextMonth0 = (d.getMonth() + 1) % 12;
      const nextYear = d.getFullYear() + (d.getMonth() === 11 ? 1 : 0);
      const nextDate = this.clampMonthlyDate(nextYear, nextMonth0, Number(occ.MONTHLY_DAY));
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
      if (!exists) {
        const newId = await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
        );
        try { await this.logEvent('occ.autocreate', 'system', Number(occ.TASK_ID), newId, { reason: 'complete.next.monthlyDay', date: nextDate }); } catch {}
      }
    } else if (occ.FREQ === 'monthly' && occ.MONTHLY_NTH != null && occ.MONTHLY_NTH_DOW != null && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const d = new Date(occ.SCHEDULED_DATE as string);
      const nextMonth0 = (d.getMonth() + 1) % 12;
      const nextYear = d.getFullYear() + (d.getMonth() === 11 ? 1 : 0);
      const nextDate = this.nthWeekdayOfMonth(nextYear, nextMonth0, Number(occ.MONTHLY_NTH), Number(occ.MONTHLY_NTH_DOW));
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
      if (!exists) {
        const newId = await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
        );
        try { await this.logEvent('occ.autocreate', 'system', Number(occ.TASK_ID), newId, { reason: 'complete.next.monthlyNth', date: nextDate }); } catch {}
      }
    } else if (occ.FREQ === 'weekly' && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const interval = Math.max(1, Number((occ as any).INTERVAL || 1));
      const d = new Date(occ.SCHEDULED_DATE as string);
      d.setDate(d.getDate() + 7 * interval);
      const nextDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
      if (!exists) {
        const newId = await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
        );
        try { await this.logEvent('occ.autocreate', 'system', Number(occ.TASK_ID), newId, { reason: 'complete.next.weekly', date: nextDate }); } catch {}
      }
    } else if (occ.FREQ === 'yearly' && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const month = Math.max(1, Math.min(12, Number((occ as any).YEARLY_MONTH || 0)));
      const day = Math.max(1, Math.min(31, Number((occ as any).MONTHLY_DAY || 0)));
      if (month >= 1 && day >= 1) {
        const d = new Date(occ.SCHEDULED_DATE as string);
        const nextDate = this.clampMonthlyDate(d.getFullYear() + 1, month - 1, day);
        const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
        if (!exists) {
          const newId = await this.run(
            `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
          );
          try { await this.logEvent('occ.autocreate', 'system', Number(occ.TASK_ID), newId, { reason: 'complete.next.yearly', date: nextDate }); } catch {}
        }
      }
    } else if (occ.FREQ === 'daily' && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const interval = Math.max(1, Number((occ as any).INTERVAL || 1));
      let nextDate: string;
      const anchor = String((occ as any).INTERVAL_ANCHOR || 'scheduled');
      if (anchor === 'completed') {
        const cd = new Date(completedAtIso);
        const base = new Date(cd.getFullYear(), cd.getMonth(), cd.getDate());
        base.setDate(base.getDate() + interval);
        nextDate = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
      } else {
        const d = new Date(occ.SCHEDULED_DATE as string);
        d.setDate(d.getDate() + interval);
        nextDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
      if (!exists) {
        const newId = await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
        );
        try { await this.logEvent('occ.autocreate', 'system', Number(occ.TASK_ID), newId, { reason: 'complete.next.daily', date: nextDate, anchor: (occ as any).INTERVAL_ANCHOR }); } catch {}
      }
    }
  }

  async deferOccurrence(occurrenceId: number, newDate: string | null): Promise<void> {
    const occ = await this.get<any>(
      `SELECT ID, TASK_ID, SCHEDULED_DATE, DEFERRED_DATE FROM TASK_OCCURRENCES WHERE ID = ?`,
      [occurrenceId]
    );
    if (!occ) throw new Error('指定された発生が見つかりません');
    const normalized = (newDate == null || String(newDate).trim() === '')
      ? null
      : this.normalizeDateOnly(newDate);
    const now = this.nowIso();
    await this.run(
      `UPDATE TASK_OCCURRENCES SET DEFERRED_DATE = ?, UPDATED_AT = ? WHERE ID = ?`,
      [normalized, now, occurrenceId]
    );
    try {
      await this.logEvent('occ.defer', 'user', Number(occ.TASK_ID), occurrenceId, {
        scheduled: occ.SCHEDULED_DATE,
        previousDeferred: occ.DEFERRED_DATE ?? null,
        deferred: normalized
      });
    } catch {}
  }

  private get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row as T));
    });
  }

  private normalizeCompletedAtInput(value?: string | null): string | null {
    if (typeof value === 'undefined' || value === null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  private all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.all(sql, params, (err, rows) => err ? reject(err) : resolve((rows || []) as T[]));
    });
  }

  private async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      try { await this.run('ROLLBACK'); } catch {}
      throw error;
    }
  }

  private nowIso(): string { return new Date().toISOString(); }

  async listTaskFileLinks(taskId: number): Promise<Array<{ fileSha256: string; createdAt: string | null; updatedAt: string | null }>> {
    if (!Number.isFinite(taskId) || taskId <= 0) return [];
    const rows = await this.all<{ FILE_SHA256: string; CREATED_AT: string | null; UPDATED_AT: string | null }>(
      'SELECT FILE_SHA256, CREATED_AT, UPDATED_AT FROM TASK_FILE_LINKS WHERE TASK_ID = ? ORDER BY CREATED_AT ASC',
      [taskId]
    );
    return rows.map(row => ({
      fileSha256: (row.FILE_SHA256 || '').toUpperCase(),
      createdAt: row.CREATED_AT ?? null,
      updatedAt: row.UPDATED_AT ?? null
    }));
  }

  async setTaskFileLinks(taskId: number, shaList: string[]): Promise<void> {
    if (!Number.isFinite(taskId) || taskId <= 0) throw new Error('Invalid task ID');
    const normalized = Array.from(new Set((shaList || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean)));
    const now = this.nowIso();
    await this.withTransaction(async () => {
      const existing = await this.all<{ FILE_SHA256: string }>(
        'SELECT FILE_SHA256 FROM TASK_FILE_LINKS WHERE TASK_ID = ?',
        [taskId]
      );
      const existingSet = new Set(existing.map(r => (r.FILE_SHA256 || '').toUpperCase()));
      const desiredSet = new Set(normalized);

      const toDelete: string[] = [];
      existingSet.forEach(sha => { if (!desiredSet.has(sha)) toDelete.push(sha); });
      if (toDelete.length) {
        const placeholders = toDelete.map(() => '?').join(',');
        await this.run(
          `DELETE FROM TASK_FILE_LINKS WHERE TASK_ID = ? AND UPPER(FILE_SHA256) IN (${placeholders})`,
          [taskId, ...toDelete]
        );
      }

      for (const sha of normalized) {
        await this.run(
          `INSERT INTO TASK_FILE_LINKS (TASK_ID, FILE_SHA256, CREATED_AT, UPDATED_AT)
           VALUES (?, UPPER(?), ?, ?)
           ON CONFLICT(TASK_ID, FILE_SHA256) DO UPDATE SET UPDATED_AT = excluded.UPDATED_AT`,
          [taskId, sha, now, now]
        );
      }
    });
  }

  async listTasks(params: { query?: string } = {}): Promise<any[]> {
    const where: string[] = [];
    const binds: any[] = [];
    if (params.query) { where.push('(TITLE LIKE ? OR DESCRIPTION LIKE ?)'); binds.push(`%${params.query}%`, `%${params.query}%`); }
    const sql = `SELECT T.ID, T.TITLE, T.DESCRIPTION, T.DUE_AT, T.START_DATE, T.START_TIME, T.IS_RECURRING,
                        T.REQUIRE_COMPLETE_COMMENT,
                        T.CREATED_AT, T.UPDATED_AT,
                        R.FREQ, R.MONTHLY_DAY, R.MONTHLY_NTH, R.MONTHLY_NTH_DOW, R.COUNT, R.HORIZON_DAYS,
                        R.INTERVAL, COALESCE(R.INTERVAL_ANCHOR,'scheduled') AS INTERVAL_ANCHOR,
                        COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS,
                        R.YEARLY_MONTH,
                        COALESCE(R.WEEKLY_DOWS,0) AS WEEKLY_DOWS,
                        COALESCE(R.MANUAL_NEXT_DUE,0) AS MANUAL_NEXT_DUE
                 FROM TASKS T
                 LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY COALESCE(T.UPDATED_AT, T.CREATED_AT) DESC, T.ID DESC`;
    const rows = await this.all<any>(sql, binds);
    for (const r of rows) {
      r.TAGS = await this.getTagsForTask(r.ID);
    }
    return rows;
  }

  async getTask(id: number): Promise<any | undefined> {
    const sql = `SELECT T.*, R.FREQ, R.MONTHLY_DAY, R.MONTHLY_NTH, R.MONTHLY_NTH_DOW, R.COUNT, R.HORIZON_DAYS, R.INTERVAL, R.INTERVAL_ANCHOR, R.YEARLY_MONTH, COALESCE(R.WEEKLY_DOWS,0) AS WEEKLY_DOWS, COALESCE(R.MANUAL_NEXT_DUE,0) AS MANUAL_NEXT_DUE, COALESCE(R.OCCURRENCE_OFFSET_DAYS,0) AS OCCURRENCE_OFFSET_DAYS
                 FROM TASKS T
                 LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
                 WHERE T.ID = ?`;
    const row = await this.get<any>(sql, [id]);
    if (row) row.TAGS = await this.getTagsForTask(row.ID);
    return row;
  }

  private async upsertTagNames(names: string[]): Promise<number[]> {
    const now = this.nowIso();
    const ids: number[] = [];
    for (const raw of names || []) {
      const name = String(raw || '').trim();
      if (!name) continue;
      const existed = await this.get<any>('SELECT ID FROM TAG_INFOS WHERE NAME = ?', [name]);
      if (existed && existed.ID) {
        ids.push(existed.ID);
      } else {
        const id = await this.run('INSERT INTO TAG_INFOS (NAME, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?)', [name, now, now]);
        ids.push(id);
      }
    }
    return ids;
  }

  private async setTagsForTask(taskId: number, names: string[]): Promise<void> {
    const now = this.nowIso();
    const tagIds = await this.upsertTagNames(names || []);
    const existing = await this.all<any>('SELECT TAG_ID FROM TASK_TAGS WHERE TASK_ID = ?', [taskId]);
    const existingSet = new Set<number>(existing.map(e => Number(e.TAG_ID)));
    const nextSet = new Set<number>(tagIds);
    // Delete removed
    for (const tid of existingSet) {
      if (!nextSet.has(tid)) await this.run('DELETE FROM TASK_TAGS WHERE TASK_ID = ? AND TAG_ID = ?', [taskId, tid]);
    }
    // Add new
    for (const tid of nextSet) {
      if (!existingSet.has(tid)) await this.run('INSERT OR IGNORE INTO TASK_TAGS (TASK_ID, TAG_ID, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?)', [taskId, tid, now, now]);
    }
  }

  private async getTagsForTask(taskId: number): Promise<string[]> {
    const rows = await this.all<any>(`SELECT I.NAME FROM TASK_TAGS M JOIN TAG_INFOS I ON I.ID = M.TAG_ID WHERE M.TASK_ID = ? ORDER BY I.NAME`, [taskId]);
    return rows.map(r => r.NAME as string);
  }

  async listAllTags(): Promise<string[]> {
    const rows = await this.all<any>(`SELECT NAME FROM TAG_INFOS ORDER BY NAME ASC`);
    return rows.map(r => r.NAME as string);
  }

  async listTagInfos(): Promise<Array<{ id: number; name: string; createdAt: string | null; updatedAt: string | null }>> {
    const rows = await this.all<any>(`SELECT ID, NAME, CREATED_AT, UPDATED_AT FROM TAG_INFOS ORDER BY NAME ASC`);
    return rows.map(row => ({
      id: Number(row.ID),
      name: String(row.NAME ?? ''),
      createdAt: row.CREATED_AT ?? null,
      updatedAt: row.UPDATED_AT ?? null
    }));
  }

  async renameTag(tagId: number, newName: string): Promise<void> {
    const id = Number(tagId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('タグIDが不正です');
    const name = String(newName ?? '').trim();
    if (!name) throw new Error('タグ名を入力してください');
    const tag = await this.get<any>('SELECT ID, NAME FROM TAG_INFOS WHERE ID = ?', [id]);
    if (!tag) throw new Error('タグが見つかりません');
    if (String(tag.NAME ?? '').trim() === name) return;
    const dup = await this.get<any>('SELECT ID FROM TAG_INFOS WHERE NAME = ? AND ID != ?', [name, id]);
    if (dup) throw new Error('同名のタグが既に存在します');
    const now = this.nowIso();
    await this.run('UPDATE TAG_INFOS SET NAME = ?, UPDATED_AT = ? WHERE ID = ?', [name, now, id]);
  }

  async listTaskEvents(params: { taskId: number; limit?: number }): Promise<any[]> {
    const taskId = Number(params.taskId);
    const limit = Math.max(1, Math.min(100, Number(params.limit ?? 10)));
    const rows = await this.all<any>(
      `SELECT ID, CREATED_AT, KIND, SOURCE, TASK_ID, OCCURRENCE_ID, DETAILS
       FROM TASK_EVENTS
       WHERE TASK_ID = ?
       ORDER BY CREATED_AT DESC, ID DESC
       LIMIT ?`,
      [taskId, limit]
    );
    // Optionally parse JSON DETAILS here; keep as text for flexibility in renderer
    return rows;
  }

  async createTask(payload: any): Promise<number> {
    const now = this.nowIso();
    const p = {
      title: payload.title || '',
      description: payload.description || null,
      due_at: payload.dueAt || null,
      start_date: payload.startDate || null,
      start_time: payload.startTime || null,
      is_recurring: payload.isRecurring ? 1 : 0,
      require_complete_comment: payload.requireCompleteComment ? 1 : 0
    };
    const rec = payload.recurrence;
    const manualNextDue = !!(rec && (rec.manualNextDue || rec.freq === 'manualNext'));
    const occurrenceOffsetDays = rec ? this.normalizeOccurrenceOffset((rec as any).occurrenceOffsetDays) : 0;
    if (manualNextDue) p.is_recurring = 1;
    // Default start_date/time if unspecified
    if (!p.start_date) {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      p.start_date = `${y}-${m}-${da}`;
    }
    if (!p.start_time) {
      p.start_time = '00:00';
    }
    if (manualNextDue && p.due_at) {
      p.start_date = p.due_at.split('T')[0];
    }
    const sql = `INSERT INTO TASKS (TITLE, DESCRIPTION, DUE_AT, START_DATE, START_TIME, IS_RECURRING, REQUIRE_COMPLETE_COMMENT, CREATED_AT, UPDATED_AT)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const id = await this.run(sql, [p.title, p.description, p.due_at, p.start_date, p.start_time, p.is_recurring, p.require_complete_comment, now, now]);
    // Insert recurrence rule: for recurring, from payload; for single, COUNT=1
    if (p.is_recurring && manualNextDue) {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await this.run(rsql, [id, 'monthly', null, null, null, 0, 1, 0, now, now]);
    } else if (p.is_recurring && rec && rec.freq === 'monthly' && rec.monthlyDay && rec.monthlyDay >= 1 && rec.monthlyDay <= 31) {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0); // 0=無限
      await this.run(rsql, [id, 'monthly', rec.monthlyDay, null, null, count, 0, occurrenceOffsetDays, now, now]);
    } else if (p.is_recurring && rec && rec.freq === 'monthlyNth' && typeof rec.monthlyNth === 'number' && typeof rec.monthlyNthDow === 'number') {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      await this.run(rsql, [id, 'monthly', null, rec.monthlyNth, rec.monthlyNthDow, count, 0, occurrenceOffsetDays, now, now]);
    } else if (p.is_recurring && rec && rec.freq === 'yearly') {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, YEARLY_MONTH, MONTHLY_DAY, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      const month = Math.max(1, Math.min(12, Number((rec as any).yearlyMonth || (rec as any).month || 0)));
      const day = Math.max(1, Math.min(31, Number((rec as any).yearlyDay || (rec as any).monthlyDay || 0)));
      await this.run(rsql, [id, 'yearly', month, day, count, 0, occurrenceOffsetDays, now, now]);
    } else if (p.is_recurring && rec && rec.freq === 'weekly') {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, WEEKLY_DOWS, INTERVAL, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      const dows = Math.max(0, Number((rec as any).weeklyDows || 0));
      const interval = Math.max(1, Number((rec as any).interval || 1));
      await this.run(rsql, [id, 'weekly', dows, interval, count, 0, occurrenceOffsetDays, now, now]);
    } else if (p.is_recurring && rec && rec.freq === 'daily') {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, HORIZON_DAYS, INTERVAL, INTERVAL_ANCHOR, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      let horizon = Number((rec as any).horizonDays || 14);
      if (!isFinite(horizon) || horizon <= 0) horizon = 14;
      if (horizon > 365) horizon = 365;
      const interval = Math.max(1, Number((rec as any).interval || 1));
      const anchor = String((rec as any).anchor || 'scheduled');
      await this.run(rsql, [id, 'daily', null, count, horizon, interval, anchor, 0, occurrenceOffsetDays, now, now]);
    } else {
      // Non-recurring: create a rule row with COUNT=1
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await this.run(rsql, [id, 'monthly', null, null, null, 1, 0, 0, now, now]);
    }

    // For single tasks, ensure one occurrence exists immediately
    if (!p.is_recurring) {
      const scheduledDate = p.due_at ? (p.due_at.split('T')[0]) : p.start_date;
      if (scheduledDate) {
        const exists = await this.get<any>('SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?', [id, scheduledDate]);
        if (!exists) {
          const newId = await this.run(
            `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [id, scheduledDate, p.start_time || null, now, now]
          );
          try { await this.logEvent('occ.autocreate', 'system', id, newId, { reason: 'single.ensure', date: scheduledDate }); } catch {}
        }
      }
    } else if (manualNextDue) {
      const scheduledDateRaw = p.due_at ? String(p.due_at) : (p.start_date ?? null);
      const scheduledDate = scheduledDateRaw ? scheduledDateRaw.split('T')[0] : null;
      await this.ensureManualNextOccurrence(id, scheduledDate, p.start_time || null);
    } else {
      // Finite count: reconcile occurrences to match count
      const count = Number((rec && rec.count) || 0);
      if (count >= 1) {
        if (rec && rec.freq === 'daily' && String((rec as any).anchor || 'scheduled') === 'completed') {
          // 完了基準: pendingは1件のみ（ここでは不要な余剰を削除し、必要時は後段でensure）
          // 直後のensureで1件が用意される
        } else {
          await this.reconcileOccurrencesForTask(id);
        }
      }
    }
    // Tags
    if (Array.isArray(payload.tags)) {
      await this.setTagsForTask(id, payload.tags.map((s: any) => String(s || '').trim()).filter(Boolean));
    }
    // Log: task.create (user)
    try {
      const after = await this.getTask(id);
      await this.logEvent('task.create', 'user', id, null, { after, payload });
    } catch {}
    return id;
  }

  async updateTask(id: number, payload: any): Promise<void> {
    const now = this.nowIso();
    // Snapshot before
    let before: any = null;
    try { before = await this.getTask(id); } catch {}
    const sql = `UPDATE TASKS SET TITLE = ?, DESCRIPTION = ?, DUE_AT = ?, START_DATE = ?, START_TIME = ?, IS_RECURRING = ?, REQUIRE_COMPLETE_COMMENT = ?, UPDATED_AT = ? WHERE ID = ?`;
    const rec = payload.recurrence;
    const manualNextDue = !!(rec && (rec.manualNextDue || rec.freq === 'manualNext'));
    const occurrenceOffsetDays = rec ? this.normalizeOccurrenceOffset((rec as any).occurrenceOffsetDays) : 0;
    const p = {
      title: payload.title || '',
      description: payload.description || null,
      due_at: payload.dueAt || null,
      start_date: payload.startDate || null,
      start_time: payload.startTime || null,
      is_recurring: payload.isRecurring ? 1 : 0,
      require_complete_comment: payload.requireCompleteComment ? 1 : 0
    };
    if (manualNextDue) p.is_recurring = 1;
    if (manualNextDue && p.due_at) {
      p.start_date = p.due_at.split('T')[0];
    }
    await this.run(sql, [p.title, p.description, p.due_at, p.start_date, p.start_time, p.is_recurring, p.require_complete_comment, now, id]);
    // Upsert/delete recurrence rule based on payload
    const existing = await this.get<any>('SELECT ID FROM RECURRENCE_RULES WHERE TASK_ID = ?', [id]);
    if (p.is_recurring && manualNextDue) {
      if (existing && existing.ID) {
        await this.run(
          `UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = NULL, MONTHLY_NTH = NULL, MONTHLY_NTH_DOW = NULL,
             WEEKLY_DOWS = NULL, YEARLY_MONTH = NULL, HORIZON_DAYS = NULL, INTERVAL = 1,
             INTERVAL_ANCHOR = 'scheduled', COUNT = 0, MANUAL_NEXT_DUE = 1, OCCURRENCE_OFFSET_DAYS = 0, UPDATED_AT = ? WHERE TASK_ID = ?`,
          ['monthly', now, id]
        );
      } else {
        await this.run(
          `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, 'monthly', 0, 1, 0, now, now]
        );
      }
    } else if (p.is_recurring && rec && rec.freq === 'monthly' && rec.monthlyDay && rec.monthlyDay >= 1 && rec.monthlyDay <= 31) {
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      if (existing && existing.ID) {
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = ?, MONTHLY_NTH = NULL, MONTHLY_NTH_DOW = NULL, COUNT = ?, MANUAL_NEXT_DUE = 0, OCCURRENCE_OFFSET_DAYS = ?, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['monthly', rec.monthlyDay, count, occurrenceOffsetDays, now, id]);
      } else {
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, 'monthly', rec.monthlyDay, null, null, count, 0, occurrenceOffsetDays, now, now]);
      }
    } else if (p.is_recurring && rec && rec.freq === 'monthlyNth' && typeof rec.monthlyNth === 'number' && typeof rec.monthlyNthDow === 'number') {
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      if (existing && existing.ID) {
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = NULL, MONTHLY_NTH = ?, MONTHLY_NTH_DOW = ?, COUNT = ?, MANUAL_NEXT_DUE = 0, OCCURRENCE_OFFSET_DAYS = ?, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['monthly', rec.monthlyNth, rec.monthlyNthDow, count, occurrenceOffsetDays, now, id]);
      } else {
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, 'monthly', null, rec.monthlyNth, rec.monthlyNthDow, count, 0, occurrenceOffsetDays, now, now]);
      }
    } else if (p.is_recurring && rec && rec.freq === 'daily') {
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      if (existing && existing.ID) {
        let horizon = Number((rec as any).horizonDays || 14);
        if (!isFinite(horizon) || horizon <= 0) horizon = 14;
        if (horizon > 365) horizon = 365;
        const interval = Math.max(1, Number((rec as any).interval || 1));
        const anchor = String((rec as any).anchor || 'scheduled');
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = NULL, MONTHLY_NTH = NULL, MONTHLY_NTH_DOW = NULL, COUNT = ?, HORIZON_DAYS = ?, INTERVAL = ?, INTERVAL_ANCHOR = ?, MANUAL_NEXT_DUE = 0, OCCURRENCE_OFFSET_DAYS = ?, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['daily', count, horizon, interval, anchor, occurrenceOffsetDays, now, id]);
      } else {
        let horizon = Number((rec as any).horizonDays || 14);
        if (!isFinite(horizon) || horizon <= 0) horizon = 14;
        if (horizon > 365) horizon = 365;
        const interval = Math.max(1, Number((rec as any).interval || 1));
        const anchor = String((rec as any).anchor || 'scheduled');
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, HORIZON_DAYS, INTERVAL, INTERVAL_ANCHOR, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, 'daily', null, null, null, count, horizon, interval, anchor, 0, occurrenceOffsetDays, now, now]);
      }
    } else if (p.is_recurring && rec && rec.freq === 'weekly') {
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      const dows = Math.max(0, Number((rec as any).weeklyDows || 0));
      const interval = Math.max(1, Number((rec as any).interval || 1));
      if (existing && existing.ID) {
        await this.run("UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = NULL, MONTHLY_NTH = NULL, MONTHLY_NTH_DOW = NULL, WEEKLY_DOWS = ?, INTERVAL = ?, COUNT = ?, INTERVAL_ANCHOR = 'scheduled', MANUAL_NEXT_DUE = 0, OCCURRENCE_OFFSET_DAYS = ?, UPDATED_AT = ? WHERE TASK_ID = ?",
          ['weekly', dows, interval, count, occurrenceOffsetDays, now, id]);
      } else {
        await this.run("INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, WEEKLY_DOWS, INTERVAL, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, 'weekly', dows, interval, count, 0, occurrenceOffsetDays, now, now]);
      }
    } else if (p.is_recurring && rec && rec.freq === 'yearly') {
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      const month = Math.max(1, Math.min(12, Number((rec as any).yearlyMonth || (rec as any).month || 0)));
      const day = Math.max(1, Math.min(31, Number((rec as any).yearlyDay || (rec as any).monthlyDay || 0)));
      if (existing && existing.ID) {
        await this.run("UPDATE RECURRENCE_RULES SET FREQ = ?, YEARLY_MONTH = ?, MONTHLY_DAY = ?, MONTHLY_NTH = NULL, MONTHLY_NTH_DOW = NULL, WEEKLY_DOWS = NULL, HORIZON_DAYS = NULL, INTERVAL = 1, INTERVAL_ANCHOR = 'scheduled', COUNT = ?, MANUAL_NEXT_DUE = 0, OCCURRENCE_OFFSET_DAYS = ?, UPDATED_AT = ? WHERE TASK_ID = ?",
          ['yearly', month, day, count, occurrenceOffsetDays, now, id]);
      } else {
        await this.run("INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, YEARLY_MONTH, MONTHLY_DAY, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, 'yearly', month, day, count, 0, occurrenceOffsetDays, now, now]);
      }
    } else {
      // Non-recurring: ensure rule with COUNT=1 exists
      if (existing && existing.ID) {
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = NULL, MONTHLY_NTH = NULL, MONTHLY_NTH_DOW = NULL, COUNT = ?, MANUAL_NEXT_DUE = 0, OCCURRENCE_OFFSET_DAYS = 0, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['monthly', 1, now, id]);
      } else {
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, MONTHLY_NTH, MONTHLY_NTH_DOW, COUNT, MANUAL_NEXT_DUE, OCCURRENCE_OFFSET_DAYS, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, 'monthly', null, null, null, 1, 0, 0, now, now]);
      }
      const scheduledDateRaw = p.due_at ? String(p.due_at) : (p.start_date ?? null);
      const scheduledDate = scheduledDateRaw ? scheduledDateRaw.split('T')[0] : null;
      const scheduledTime = p.start_time || null;
      const occurrences = await this.all<any>(
        `SELECT ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS FROM TASK_OCCURRENCES WHERE TASK_ID = ? ORDER BY ID ASC`,
        [id]
      );

      if (!scheduledDate) {
        for (const occ of occurrences) {
          await this.run('DELETE FROM TASK_OCCURRENCES WHERE ID = ?', [occ.ID]);
          try { await this.logEvent('occ.delete', 'system', id, occ.ID, { reason: 'single.realign.noDate', previousDate: occ.SCHEDULED_DATE, status: occ.STATUS }); } catch {}
        }
      } else {
        let primaryOcc = occurrences.find(o => o.SCHEDULED_DATE === scheduledDate) || null;
        if (!primaryOcc && occurrences.length) primaryOcc = occurrences[0];

        if (primaryOcc) {
          const prevDate = primaryOcc.SCHEDULED_DATE;
          const prevTime = primaryOcc.SCHEDULED_TIME ?? null;
          const needsUpdate = prevDate !== scheduledDate || (prevTime ?? null) !== (scheduledTime ?? null);
          if (needsUpdate) {
            await this.run(
              `UPDATE TASK_OCCURRENCES SET SCHEDULED_DATE = ?, SCHEDULED_TIME = ?, UPDATED_AT = ? WHERE ID = ?`,
              [scheduledDate, scheduledTime, now, primaryOcc.ID]
            );
            try { await this.logEvent('occ.reschedule', 'system', id, primaryOcc.ID, { reason: 'single.realign', previousDate: prevDate, previousTime: prevTime, newDate: scheduledDate, newTime: scheduledTime }); } catch {}
            primaryOcc.SCHEDULED_DATE = scheduledDate;
            primaryOcc.SCHEDULED_TIME = scheduledTime;
          }
        } else {
          const newId = await this.run(
            `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [id, scheduledDate, scheduledTime, now, now]
          );
          primaryOcc = { ID: newId, SCHEDULED_DATE: scheduledDate, SCHEDULED_TIME: scheduledTime, STATUS: 'pending' };
          try { await this.logEvent('occ.autocreate', 'system', id, newId, { reason: 'single.realign.create', date: scheduledDate }); } catch {}
        }

        for (const occ of occurrences) {
          if (primaryOcc && occ.ID === primaryOcc.ID) continue;
          await this.run('DELETE FROM TASK_OCCURRENCES WHERE ID = ?', [occ.ID]);
          try { await this.logEvent('occ.delete', 'system', id, occ.ID, { reason: 'single.realign.remove', previousDate: occ.SCHEDULED_DATE, status: occ.STATUS }); } catch {}
        }
      }
    }

    // If recurring with finite count, reconcile occurrences
    if (p.is_recurring && !manualNextDue && rec && typeof rec.count !== 'undefined' && Number(rec.count) >= 1) {
      if (rec && rec.freq === 'daily' && String((rec as any).anchor || 'scheduled') === 'completed') {
        // 完了基準: pendingはensure側で1件だけ維持
      } else {
        await this.reconcileOccurrencesForTask(id);
      }
    }

    if (manualNextDue) {
      const scheduledDateRaw = p.due_at ? String(p.due_at) : (p.start_date ?? null);
      const scheduledDate = scheduledDateRaw ? scheduledDateRaw.split('T')[0] : null;
      await this.ensureManualNextOccurrence(id, scheduledDate, p.start_time || null);
    }

    // Tags
    if (Array.isArray(payload.tags)) {
      await this.setTagsForTask(id, payload.tags.map((s: any) => String(s || '').trim()).filter(Boolean));
    }
    // Log: task.update (user)
    try {
      const after = await this.getTask(id);
      await this.logEvent('task.update', 'user', id, null, { before, after, payload });
    } catch {}
  }

  async deleteTask(id: number): Promise<void> {
    // Snapshot before delete
    let before: any = null;
    try { before = await this.getTask(id); } catch {}
    await this.run('DELETE FROM TASKS WHERE ID = ?', [id]);
    // Log: task.delete (user)
    try {
      await this.logEvent('task.delete', 'user', id, null, { before });
    } catch {}
  }
}
