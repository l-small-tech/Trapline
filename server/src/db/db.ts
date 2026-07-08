/**
 * Thin adapter around better-sqlite3.
 *
 * The rest of the codebase only touches this module's exports
 * (prepare/run/get/all/transaction/pragma), so if the native module ever
 * fails to build, Node's built-in `node:sqlite` (same synchronous model)
 * can be swapped in here without touching anything else.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH } from '../config.js';

export type Db = Database.Database;

let db: Db | null = null;

export function openDb(filePath: string = DB_PATH): Db {
  if (db) return db;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not opened yet — call openDb() first');
  return db;
}

export function closeDb(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // best effort on shutdown
    }
    db.close();
    db = null;
  }
}
