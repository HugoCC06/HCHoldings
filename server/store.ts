import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { inspectBackup, openDatabase } from './db';
import { HttpError } from './errors';

/**
 * Owns the SQLite connection and everything to do with backing it up and restoring it.
 * The whole application state (including uploaded documents) lives in one database file,
 * so a backup is a single portable file.
 */
export class Store {
  db: Database.Database;
  readonly file: string;
  readonly backupDir: string;

  constructor(readonly dataDir: string, private keepAuto = 14) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, 'holdings.sqlite');
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    this.db = openDatabase(this.file);
  }

  static memory(): Store {
    const s = Object.create(Store.prototype) as Store;
    Object.assign(s, { db: openDatabase(':memory:'), file: ':memory:', backupDir: '', dataDir: '', keepAuto: 0 });
    return s;
  }

  listBackups() {
    if (!this.backupDir) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => {
        const st = fs.statSync(path.join(this.backupDir, f));
        return { file: f, size: st.size, created: st.mtime.toISOString() };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  /** Consistent online backup using SQLite's backup API. */
  async backup(kind: 'auto' | 'manual' | 'download' | 'pre-restore'): Promise<string> {
    if (!this.backupDir) throw new HttpError(400, 'Backups are not available for in-memory databases.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(this.backupDir, `${kind}-${stamp}.sqlite`);
    await this.db.backup(target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* ignore */
    }
    this.prune();
    return target;
  }

  /** Daily automatic backup; skipped if one was already made today. */
  async autoBackup(): Promise<string | null> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.listBackups().some((b) => b.file.startsWith(`auto-${today}`))) return null;
    return this.backup('auto');
  }

  private prune() {
    for (const kind of ['auto', 'download']) {
      const files = this.listBackups().filter((b) => b.file.startsWith(kind + '-'));
      const keep = kind === 'download' ? 3 : this.keepAuto;
      for (const f of files.slice(keep)) fs.rmSync(path.join(this.backupDir, f.file), { force: true });
    }
  }

  /** Replace the live database with an uploaded backup after validating it. A safety backup is taken first. */
  async restoreFromBuffer(buf: Buffer): Promise<void> {
    if (!this.backupDir) throw new HttpError(400, 'Restore is not available for in-memory databases.');
    const tmp = path.join(this.dataDir, `restore-${Date.now()}.sqlite`);
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    try {
      const problem = inspectBackup(tmp);
      if (problem) throw new HttpError(422, problem);
      await this.backup('pre-restore');
      this.db.close();
      for (const ext of ['-wal', '-shm']) fs.rmSync(this.file + ext, { force: true });
      fs.renameSync(tmp, this.file);
      this.db = openDatabase(this.file); // also applies any newer migrations
    } finally {
      fs.rmSync(tmp, { force: true });
      if (!this.db.open) this.db = openDatabase(this.file);
    }
  }
}
