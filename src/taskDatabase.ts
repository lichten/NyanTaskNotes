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

  private async ensureRecurringMonthlyOccurrences(monthsAhead: number = 2): Promise<void> {
    // COUNT=0: 現在月〜先N-1ヶ月を生成。COUNT>=1: START_DATE から回数分の月次日付を生成（不足のみ追加）。
    const now = new Date();
    const startYear = now.getFullYear();
    const startMonth0 = now.getMonth();
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, T.STATUS, R.MONTHLY_DAY, R.COUNT
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'monthly'
       WHERE T.IS_RECURRING = 1 AND (T.STATUS IS NULL OR T.STATUS != 'archived')`
    );
    for (const t of tasks) {
      const monthlyDay = Number(t.MONTHLY_DAY);
      if (!monthlyDay || isNaN(monthlyDay)) continue;
      const count = Number(t.COUNT || 0);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const startDate = new Date(t.START_DATE as string);
        let i = 0;
        while (i < count * 2 && i < 240) { // safety cap
          const m0 = (startDate.getMonth() + i) % 12;
          const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
          const scheduledDate = this.clampMonthlyDate(y, m0, monthlyDay);
          i++;
          if (new Date(scheduledDate) < startDate) continue;
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
          }
          // Stop once we ensured up to COUNT future dates exist (we don't delete here)
          const ensured = await this.get<any>(`SELECT COUNT(1) AS C FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE >= ?`, [t.TASK_ID, t.START_DATE]);
          if (ensured && Number(ensured.C) >= count) break;
        }
      } else {
        for (let i = 0; i < monthsAhead; i++) {
          const m0 = (startMonth0 + i) % 12;
          const y = startYear + Math.floor((startMonth0 + i) / 12);
          const scheduledDate = this.clampMonthlyDate(y, m0, monthlyDay);
          // Respect START_DATE if set and after scheduledDate => skip creation
          if (t.START_DATE && new Date(scheduledDate) < new Date(t.START_DATE)) continue;
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
          }
        }
      }
    }
  }

  private async ensureRecurringDailyOccurrences(daysAhead: number = 14): Promise<void> {
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
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, R.COUNT
       FROM TASKS T
       JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID AND R.FREQ = 'daily'
       WHERE T.IS_RECURRING = 1 AND (T.STATUS IS NULL OR T.STATUS != 'archived')`
    );
    for (const t of tasks) {
      const count = Number(t.COUNT || 0);
      if (count >= 1) {
        if (!t.START_DATE) continue;
        const start = new Date(t.START_DATE as string);
        for (let i = 0; i < count; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const scheduledDate = startDateStr(d);
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
          }
        }
      } else {
        for (let i = 0; i < daysAhead; i++) {
          const d = new Date(today);
          d.setDate(today.getDate() + i);
          const scheduledDate = startDateStr(d);
          if (t.START_DATE && new Date(scheduledDate) < new Date(t.START_DATE)) continue;
          const exists = await this.get<any>(
            `SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`,
            [t.TASK_ID, scheduledDate]
          );
          if (!exists) {
            const nowIso = this.nowIso();
            await this.run(
              `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
               VALUES (?, ?, ?, 'pending', ?, ?)`,
              [t.TASK_ID, scheduledDate, t.START_TIME || null, nowIso, nowIso]
            );
          }
        }
      }
    }
  }

  private async reconcileOccurrencesForTask(taskId: number): Promise<void> {
    // Align TASK_OCCURRENCES to the finite COUNT for the task's recurrence rule (daily/monthly).
    const task = await this.get<any>(
      `SELECT T.ID AS TASK_ID, T.START_DATE, T.START_TIME, T.IS_RECURRING,
              R.FREQ, R.MONTHLY_DAY, R.COUNT
       FROM TASKS T
       LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
       WHERE T.ID = ?`, [taskId]
    );
    if (!task || !task.IS_RECURRING) return;
    const count = Number(task.COUNT || 0);
    if (!task.START_DATE || !(count >= 1)) return; // only finite counts
    const startDate = new Date(task.START_DATE as string);
    const startDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const targetDates: string[] = [];
    if (task.FREQ === 'daily') {
      for (let i = 0; i < count; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        targetDates.push(startDateStr(d));
      }
    } else if (task.FREQ === 'monthly' && task.MONTHLY_DAY) {
      const monthlyDay = Number(task.MONTHLY_DAY);
      let i = 0;
      while (targetDates.length < count) {
        const m0 = (startDate.getMonth() + i) % 12;
        const y = startDate.getFullYear() + Math.floor((startDate.getMonth() + i) / 12);
        const dStr = this.clampMonthlyDate(y, m0, monthlyDay);
        if (new Date(dStr) >= startDate) targetDates.push(dStr);
        i++;
      }
    } else {
      return; // unsupported freq for reconciliation
    }

    const existing = await this.all<any>(
      `SELECT ID, SCHEDULED_DATE, STATUS FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE >= ?`,
      [taskId, startDateStr(startDate)]
    );
    const existingByDate = new Map<string, { id: number; status: string }>();
    for (const e of existing) existingByDate.set(e.SCHEDULED_DATE, { id: e.ID, status: e.STATUS });

    // Delete occurrences not in target set (all statuses含む)
    for (const e of existing) {
      if (!targetDates.includes(e.SCHEDULED_DATE)) {
        await this.run(`DELETE FROM TASK_OCCURRENCES WHERE ID = ?`, [e.ID]);
      }
    }

    // Add missing occurrences
    const nowIso = this.nowIso();
    for (const d of targetDates) {
      if (!existingByDate.has(d)) {
        await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [taskId, d, task.START_TIME || null, nowIso, nowIso]
        );
      }
    }
  }

  private async ensureSingleOccurrences(): Promise<void> {
    // Ensure a single occurrence exists for non-recurring tasks with a scheduled date.
    const tasks = await this.all<any>(
      `SELECT T.ID AS TASK_ID, DATE(COALESCE(T.DUE_AT, T.START_DATE)) AS S_DATE, T.START_TIME
       FROM TASKS T
       WHERE T.IS_RECURRING = 0 AND (T.STATUS IS NULL OR T.STATUS != 'archived')
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

  async listOccurrences(params: { from?: string; to?: string; query?: string; status?: string } = {}): Promise<any[]> {
    // Ensure occurrences exist for both recurring and single tasks
    await this.ensureSingleOccurrences();
    await this.ensureRecurringMonthlyOccurrences(2);
    await this.ensureRecurringDailyOccurrences(14);

    const where: string[] = [];
    const binds: any[] = [];
    if (params.from) { where.push('O.SCHEDULED_DATE >= ?'); binds.push(params.from); }
    if (params.to) { where.push('O.SCHEDULED_DATE <= ?'); binds.push(params.to); }
    if (params.status) { where.push('O.STATUS = ?'); binds.push(params.status); }
    if (params.query) { where.push('(T.TITLE LIKE ? OR T.DESCRIPTION LIKE ?)'); binds.push(`%${params.query}%`, `%${params.query}%`); }
    const sql = `SELECT O.ID AS OCCURRENCE_ID, O.SCHEDULED_DATE, O.SCHEDULED_TIME, O.STATUS AS OCC_STATUS, O.COMPLETED_AT,
                        T.ID AS TASK_ID, T.TITLE, T.DESCRIPTION, T.STATUS AS TASK_STATUS, T.PRIORITY,
                        T.START_DATE, T.START_TIME, T.IS_RECURRING,
                        R.FREQ, R.MONTHLY_DAY, R.COUNT
                 FROM TASK_OCCURRENCES O
                 JOIN TASKS T ON T.ID = O.TASK_ID
                 LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY O.SCHEDULED_DATE ASC, O.ID ASC`;
    return this.all<any>(sql, binds);
  }

  async completeOccurrence(occurrenceId: number): Promise<void> {
    const now = this.nowIso();
    const occ = await this.get<any>(
      `SELECT O.ID, O.TASK_ID, O.SCHEDULED_DATE, T.START_DATE, T.START_TIME, R.FREQ, R.MONTHLY_DAY, R.COUNT
       FROM TASK_OCCURRENCES O
       JOIN TASKS T ON T.ID = O.TASK_ID
       LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
       WHERE O.ID = ?`, [occurrenceId]
    );
    if (!occ) return;
    await this.run(`UPDATE TASK_OCCURRENCES SET STATUS = 'done', COMPLETED_AT = ?, UPDATED_AT = ? WHERE ID = ?`, [now, now, occurrenceId]);
    // Generate next occurrence for recurring tasks
    if (occ.FREQ === 'monthly' && occ.MONTHLY_DAY && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const d = new Date(occ.SCHEDULED_DATE as string);
      const nextMonth0 = (d.getMonth() + 1) % 12;
      const nextYear = d.getFullYear() + (d.getMonth() === 11 ? 1 : 0);
      const nextDate = this.clampMonthlyDate(nextYear, nextMonth0, Number(occ.MONTHLY_DAY));
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
      if (!exists) {
        await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
        );
      }
    } else if (occ.FREQ === 'daily' && (!occ.COUNT || Number(occ.COUNT) === 0)) {
      const d = new Date(occ.SCHEDULED_DATE as string);
      d.setDate(d.getDate() + 1);
      const nextDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const exists = await this.get<any>(`SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?`, [occ.TASK_ID, nextDate]);
      if (!exists) {
        await this.run(
          `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [occ.TASK_ID, nextDate, occ.START_TIME || null, now, now]
        );
      }
    }
  }

  private get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row as T));
    });
  }

  private all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.all(sql, params, (err, rows) => err ? reject(err) : resolve((rows || []) as T[]));
    });
  }

  private nowIso(): string { return new Date().toISOString(); }

  async listTasks(params: { query?: string; status?: string } = {}): Promise<any[]> {
    const where: string[] = [];
    const binds: any[] = [];
    if (params.query) { where.push('(TITLE LIKE ? OR DESCRIPTION LIKE ?)'); binds.push(`%${params.query}%`, `%${params.query}%`); }
    if (params.status) { where.push('STATUS = ?'); binds.push(params.status); }
    const sql = `SELECT T.ID, T.TITLE, T.DESCRIPTION, T.STATUS, T.PRIORITY, T.DUE_AT, T.START_DATE, T.START_TIME, T.IS_RECURRING,
                        T.CREATED_AT, T.UPDATED_AT,
                        R.FREQ, R.MONTHLY_DAY, R.COUNT
                 FROM TASKS T
                 LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY COALESCE(T.UPDATED_AT, T.CREATED_AT) DESC, T.ID DESC`;
    return this.all<any>(sql, binds);
  }

  async getTask(id: number): Promise<any | undefined> {
    const sql = `SELECT T.*, R.FREQ, R.MONTHLY_DAY, R.COUNT
                 FROM TASKS T
                 LEFT JOIN RECURRENCE_RULES R ON R.TASK_ID = T.ID
                 WHERE T.ID = ?`;
    return this.get<any>(sql, [id]);
  }

  async createTask(payload: any): Promise<number> {
    const now = this.nowIso();
    const p = {
      title: payload.title || '',
      description: payload.description || null,
      status: payload.status || 'todo',
      priority: payload.priority ?? null,
      due_at: payload.dueAt || null,
      start_date: payload.startDate || null,
      start_time: payload.startTime || null,
      is_recurring: payload.isRecurring ? 1 : 0
    };
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
    const sql = `INSERT INTO TASKS (TITLE, DESCRIPTION, STATUS, PRIORITY, DUE_AT, START_DATE, START_TIME, IS_RECURRING, CREATED_AT, UPDATED_AT)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const id = await this.run(sql, [p.title, p.description, p.status, p.priority, p.due_at, p.start_date, p.start_time, p.is_recurring, now, now]);
    // Insert recurrence rule: for recurring, from payload; for single, COUNT=1
    const rec = payload.recurrence;
    if (p.is_recurring && rec && rec.freq === 'monthly' && rec.monthlyDay && rec.monthlyDay >= 1 && rec.monthlyDay <= 31) {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0); // 0=無限
      await this.run(rsql, [id, 'monthly', rec.monthlyDay, count, now, now]);
    } else if (p.is_recurring && rec && rec.freq === 'daily') {
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?)`;
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      await this.run(rsql, [id, 'daily', null, count, now, now]);
    } else {
      // Non-recurring: create a rule row with COUNT=1
      const rsql = `INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT)
                    VALUES (?, ?, ?, ?, ?, ?)`;
      await this.run(rsql, [id, 'monthly', null, 1, now, now]);
    }

    // For single tasks, ensure one occurrence exists immediately
    if (!p.is_recurring) {
      const scheduledDate = p.due_at ? (p.due_at.split('T')[0]) : p.start_date;
      if (scheduledDate) {
        const exists = await this.get<any>('SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?', [id, scheduledDate]);
        if (!exists) {
          await this.run(
            `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [id, scheduledDate, p.start_time || null, now, now]
          );
        }
      }
    } else {
      // Finite count: reconcile occurrences to match count
      const count = Number((rec && rec.count) || 0);
      if (count >= 1) {
        await this.reconcileOccurrencesForTask(id);
      }
    }
    return id;
  }

  async updateTask(id: number, payload: any): Promise<void> {
    const now = this.nowIso();
    const sql = `UPDATE TASKS SET TITLE = ?, DESCRIPTION = ?, STATUS = ?, PRIORITY = ?, DUE_AT = ?, START_DATE = ?, START_TIME = ?, IS_RECURRING = ?, UPDATED_AT = ? WHERE ID = ?`;
    const p = {
      title: payload.title || '',
      description: payload.description || null,
      status: payload.status || 'todo',
      priority: payload.priority ?? null,
      due_at: payload.dueAt || null,
      start_date: payload.startDate || null,
      start_time: payload.startTime || null,
      is_recurring: payload.isRecurring ? 1 : 0
    };
    await this.run(sql, [p.title, p.description, p.status, p.priority, p.due_at, p.start_date, p.start_time, p.is_recurring, now, id]);
    // Upsert/delete recurrence rule based on payload
    const rec = payload.recurrence;
    if (p.is_recurring && rec && rec.freq === 'monthly' && rec.monthlyDay && rec.monthlyDay >= 1 && rec.monthlyDay <= 31) {
      // Check if rule exists
      const existing = await this.get<any>('SELECT ID FROM RECURRENCE_RULES WHERE TASK_ID = ?', [id]);
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      if (existing && existing.ID) {
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = ?, COUNT = ?, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['monthly', rec.monthlyDay, count, now, id]);
      } else {
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?)',
          [id, 'monthly', rec.monthlyDay, count, now, now]);
      }
    } else if (p.is_recurring && rec && rec.freq === 'daily') {
      const existing = await this.get<any>('SELECT ID FROM RECURRENCE_RULES WHERE TASK_ID = ?', [id]);
      const count = Math.max(0, Number((rec as any).count || 0) || 0);
      if (existing && existing.ID) {
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = ?, COUNT = ?, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['daily', null, count, now, id]);
      } else {
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?)',
          [id, 'daily', null, count, now, now]);
      }
    } else {
      // Non-recurring: ensure rule with COUNT=1 exists
      const existing = await this.get<any>('SELECT ID FROM RECURRENCE_RULES WHERE TASK_ID = ?', [id]);
      if (existing && existing.ID) {
        await this.run('UPDATE RECURRENCE_RULES SET FREQ = ?, MONTHLY_DAY = ?, COUNT = ?, UPDATED_AT = ? WHERE TASK_ID = ?',
          ['monthly', null, 1, now, id]);
      } else {
        await this.run('INSERT INTO RECURRENCE_RULES (TASK_ID, FREQ, MONTHLY_DAY, COUNT, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?)',
          [id, 'monthly', null, 1, now, now]);
      }
      // Ensure single occurrence exists
      const scheduledDate = p.due_at ? (p.due_at.split('T')[0]) : p.start_date;
      if (scheduledDate) {
        const exists = await this.get<any>('SELECT ID FROM TASK_OCCURRENCES WHERE TASK_ID = ? AND SCHEDULED_DATE = ?', [id, scheduledDate]);
        if (!exists) {
          await this.run(
            `INSERT INTO TASK_OCCURRENCES (TASK_ID, SCHEDULED_DATE, SCHEDULED_TIME, STATUS, CREATED_AT, UPDATED_AT)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [id, scheduledDate, p.start_time || null, now, now]
          );
        }
      }
    }

    // If recurring with finite count, reconcile occurrences
    if (p.is_recurring && rec && typeof rec.count !== 'undefined' && Number(rec.count) >= 1) {
      await this.reconcileOccurrencesForTask(id);
    }
  }

  async deleteTask(id: number): Promise<void> {
    await this.run('DELETE FROM TASKS WHERE ID = ?', [id]);
  }
}
