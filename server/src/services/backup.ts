import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import type { DB } from '../db/index.js';

export interface BackupResult {
  id: number | null;
  file: string;
  relPath: string;
  size: number;
  verified: boolean;
}

/**
 * Consistent online backup using VACUUM INTO, then verifies the copy opens and passes integrity_check.
 * Records the backup in the `backups` table when it exists.
 */
export function createBackup(db: DB, operation: string, userId: number | null = null): BackupResult {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeOp = operation.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);
  const file = path.join(config.backupDir, `vfd-knowledge-${stamp}-${safeOp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  const verified = verifyBackup(file);
  const size = fs.statSync(file).size;
  const relPath = path.relative(config.root, file).replace(/\\/g, '/');
  let id: number | null = null;
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='backups'").get();
  if (hasTable) {
    id = Number(
      db
        .prepare('INSERT INTO backups(file_rel_path, operation, size_bytes, verified, created_by_user_id) VALUES (?,?,?,?,?)')
        .run(relPath, operation, size, verified ? 1 : 0, userId).lastInsertRowid,
    );
  }
  if (!verified) throw new Error(`Backup verification failed for ${relPath}`);
  return { id, file, relPath, size, verified };
}

export function verifyBackup(file: string): boolean {
  try {
    const b = new Database(file, { readonly: true, fileMustExist: true });
    const r = b.pragma('integrity_check', { simple: true });
    const n = b.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get() as { c: number };
    b.close();
    return r === 'ok' && n.c > 0;
  } catch {
    return false;
  }
}

export function listBackups(db: DB) {
  return db.prepare('SELECT * FROM backups ORDER BY id DESC').all();
}
