import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { migrations } from './migrations.js';

export type DB = Database.Database;

let dbInstance: DB | null = null;

export function openDb(file = config.dbPath): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function getDb(): DB {
  if (!dbInstance) {
    dbInstance = openDb();
    runMigrations(dbInstance);
  }
  return dbInstance;
}

/** For tests: replace the singleton. */
export function setDb(db: DB | null) {
  dbInstance = db;
}

export function currentSchemaVersion(db: DB): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const row = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

/**
 * Applies pending migrations. Before migrating a database that already has a schema,
 * a consistent backup is taken (master prompt §29.9 / §29.12).
 */
export function runMigrations(db: DB, opts: { backup?: (db: DB, label: string) => void } = {}) {
  const current = currentSchemaVersion(db);
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (!pending.length) return [];
  if (current > 0 && opts.backup) opts.backup(db, `pre-migration-v${current}-to-v${pending[pending.length - 1].version}`);
  const applied: number[] = [];
  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    tx();
    applied.push(m.version);
  }
  const fkErrors = db.pragma('foreign_key_check') as unknown[];
  if (fkErrors.length) throw new Error(`Foreign key check failed after migration: ${JSON.stringify(fkErrors.slice(0, 5))}`);
  return applied;
}

export const nowIso = () => new Date().toISOString();
