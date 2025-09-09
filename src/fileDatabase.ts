import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface FileInfo {
  ID?: number;
  CREATED_AT?: string;
  UPDATED_AT?: string;
  FOLDER_PATH: string;
  FILE_NAME: string;
  SHA_256: string;
}

export interface TagInfo {
  ID?: number;
  CREATED_AT?: string;
  UPDATED_AT?: string;
  NAME: string;
}

export interface TagMap {
  ID?: number;
  CREATED_AT?: string;
  UPDATED_AT?: string;
  FILE_INFO_ID: number;
  TAG_ID: number;
}

export class FileDatabase {
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
    const nearby = path.resolve(__dirname, '..', 'db', 'file_schema.sql');
    if (fs.existsSync(nearby)) return nearby;
    const cwdPath = path.resolve(process.cwd(), 'db', 'file_schema.sql');
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

  private nowIso(): string {
    return new Date().toISOString();
  }

  private getQuery<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err); else resolve(row as T);
      });
    });
  }

  private allQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err); else resolve((rows || []) as T[]);
      });
    });
  }

  private run(sql: string, params: any[] = []): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('Database not initialized'));
      this.db.run(sql, params, function (this: sqlite3.RunResult, err) {
        if (err) reject(err); else resolve(this.changes || 0);
      });
    });
  }

  async upsertFileInfoBySha256(folderPath: string, fileName: string, sha256: string): Promise<FileInfo> {
    const existing = await this.getFileInfoBySha256(sha256);
    if (existing && existing.ID) {
      await this.updateFileInfoPathIfChanged(existing.ID, folderPath, fileName);
      return (await this.getFileInfoById(existing.ID))!;
    }
    return this.insertFileInfo(folderPath, fileName, sha256);
  }

  async insertFileInfo(folderPath: string, fileName: string, sha256: string): Promise<FileInfo> {
    const now = this.nowIso();
    const sql = `INSERT INTO FILE_INFOS (CREATED_AT, UPDATED_AT, FOLDER_PATH, FILE_NAME, SHA_256) VALUES (?, ?, ?, ?, ?)`;
    await this.run(sql, [now, now, folderPath, fileName, sha256.toUpperCase()]);
    const created = await this.getFileInfoBySha256(sha256);
    if (!created) throw new Error('Failed to insert FILE_INFOS');
    return created;
  }

  async updateFileInfoPathIfChanged(id: number, folderPath: string, fileName: string): Promise<void> {
    const current = await this.getFileInfoById(id);
    if (!current) return;
    if (current.FOLDER_PATH === folderPath && current.FILE_NAME === fileName) return;
    const sql = `UPDATE FILE_INFOS SET FOLDER_PATH = ?, FILE_NAME = ?, UPDATED_AT = ? WHERE ID = ?`;
    await this.run(sql, [folderPath, fileName, this.nowIso(), id]);
  }

  async insertTagIfNotExists(name: string): Promise<TagInfo> {
    const existing = await this.getTagInfoByName(name);
    if (existing) return existing;
    const now = this.nowIso();
    const sql = `INSERT INTO TAG_INFOS (CREATED_AT, UPDATED_AT, NAME) VALUES (?, ?, ?)`;
    await this.run(sql, [now, now, name]);
    const created = await this.getTagInfoByName(name);
    if (!created) throw new Error('Failed to insert TAG_INFOS');
    return created;
  }

  async ensureTagMap(fileInfoId: number, tagId: number): Promise<void> {
    const maps = await this.getTagMapsByFileId(fileInfoId);
    const exists = maps.some(m => m.TAG_ID === tagId);
    if (exists) return;
    const now = this.nowIso();
    const sql = `INSERT INTO TAG_MAPS (CREATED_AT, UPDATED_AT, FILE_INFO_ID, TAG_ID) VALUES (?, ?, ?, ?)`;
    await this.run(sql, [now, now, fileInfoId, tagId]);
  }

  async addTagsToFileByNames(fileInfoId: number, tagNames: string[]): Promise<number> {
    let added = 0;
    for (const name of tagNames) {
      const tag = await this.insertTagIfNotExists(name);
      await this.ensureTagMap(fileInfoId, tag.ID!);
      added++;
    }
    return added;
  }

  // Reads
  async getFileInfos(): Promise<FileInfo[]> {
    return this.allQuery<FileInfo>(
      'SELECT ID, CREATED_AT, UPDATED_AT, FOLDER_PATH, FILE_NAME, SHA_256 FROM FILE_INFOS ORDER BY CREATED_AT DESC'
    );
  }

  async getFileInfoById(id: number): Promise<FileInfo | undefined> {
    return this.getQuery<FileInfo>(
      'SELECT ID, CREATED_AT, UPDATED_AT, FOLDER_PATH, FILE_NAME, SHA_256 FROM FILE_INFOS WHERE ID = ?',
      [id]
    );
  }

  async getFileInfoBySha256(sha256: string): Promise<FileInfo | undefined> {
    return this.getQuery<FileInfo>(
      'SELECT ID, CREATED_AT, UPDATED_AT, FOLDER_PATH, FILE_NAME, SHA_256 FROM FILE_INFOS WHERE UPPER(SHA_256) = UPPER(?)',
      [sha256]
    );
  }

  async getTagInfoById(id: number): Promise<TagInfo | undefined> {
    return this.getQuery<TagInfo>(
      'SELECT ID, CREATED_AT, UPDATED_AT, NAME FROM TAG_INFOS WHERE ID = ?',
      [id]
    );
  }

  async getTagInfoByName(name: string): Promise<TagInfo | undefined> {
    return this.getQuery<TagInfo>(
      'SELECT ID, CREATED_AT, UPDATED_AT, NAME FROM TAG_INFOS WHERE NAME = ?',
      [name]
    );
  }

  async getTagMapsByFileId(fileInfoId: number): Promise<TagMap[]> {
    return this.allQuery<TagMap>(
      'SELECT ID, CREATED_AT, UPDATED_AT, FILE_INFO_ID, TAG_ID FROM TAG_MAPS WHERE FILE_INFO_ID = ? ORDER BY CREATED_AT ASC',
      [fileInfoId]
    );
  }

  async searchFileInfosByTags(tagNames: string[]): Promise<FileInfo[]> {
    if (!tagNames || tagNames.length === 0) return [];
    const placeholders = tagNames.map(() => '?').join(',');
    const sql = `
      SELECT DISTINCT f.ID, f.CREATED_AT, f.UPDATED_AT, f.FOLDER_PATH, f.FILE_NAME, f.SHA_256
      FROM FILE_INFOS f
      INNER JOIN TAG_MAPS tm ON f.ID = tm.FILE_INFO_ID
      INNER JOIN TAG_INFOS t ON tm.TAG_ID = t.ID
      WHERE t.NAME IN (${placeholders})
      ORDER BY f.CREATED_AT DESC
    `;
    return this.allQuery<FileInfo>(sql, tagNames);
  }

  async removeTagsFromFileByTagNames(fileInfoId: number, tagNames: string[]): Promise<number> {
    if (!tagNames || tagNames.length === 0) return 0;
    let total = 0;
    for (const name of tagNames) {
      const tag = await this.getTagInfoByName(name);
      if (!tag || !tag.ID) continue;
      const removed = await this.run('DELETE FROM TAG_MAPS WHERE FILE_INFO_ID = ? AND TAG_ID = ?', [fileInfoId, tag.ID]);
      total += removed;
    }
    return total;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
    this.db = null;
  }
}

