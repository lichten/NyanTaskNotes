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
}

