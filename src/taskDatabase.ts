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
    const sql = `SELECT ID, TITLE, DESCRIPTION, STATUS, PRIORITY, DUE_AT, START_DATE, START_TIME, IS_RECURRING, CREATED_AT, UPDATED_AT
                 FROM TASKS ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY COALESCE(UPDATED_AT, CREATED_AT) DESC, ID DESC`;
    return this.all<any>(sql, binds);
  }

  async getTask(id: number): Promise<any | undefined> {
    const sql = 'SELECT * FROM TASKS WHERE ID = ?';
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
    const sql = `INSERT INTO TASKS (TITLE, DESCRIPTION, STATUS, PRIORITY, DUE_AT, START_DATE, START_TIME, IS_RECURRING, CREATED_AT, UPDATED_AT)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const id = await this.run(sql, [p.title, p.description, p.status, p.priority, p.due_at, p.start_date, p.start_time, p.is_recurring, now, now]);
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
  }

  async deleteTask(id: number): Promise<void> {
    await this.run('DELETE FROM TASKS WHERE ID = ?', [id]);
  }
}
