/**
 * Thin adapter around Node's built-in `node:sqlite` (synchronous model).
 *
 * The rest of the codebase only touches this module's exports plus
 * prepare/run/get/all on the returned handle, so the underlying driver can
 * be swapped here without touching anything else. (This used to be
 * better-sqlite3; node:sqlite removed the only native dependency, which is
 * what makes the single-file release binaries possible.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../config.js';

export type Db = DatabaseSync;

let db: Db | null = null;

export function openDb(filePath: string = DB_PATH): Db {
  if (db) return db;
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not opened yet — call openDb() first');
  return db;
}

export function closeDb(): void {
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // best effort on shutdown
    }
    db.close();
    db = null;
  }
}
