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
  try { pruneBackups(db); } catch { /* retention must never fail a backup */ }
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

/** Monday (UTC) of the week a timestamp falls in, as YYYY-MM-DD. */
function weekKey(t: number) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Retention: keep only the NEWEST verified backup of each calendar week (Mon–Sun, UTC), delete the rest.
 * Only touches `vfd-knowledge-*.db` files in the backup folder and their rows in `backups`.
 */
export function pruneBackups(db: DB, opts: { dryRun?: boolean } = {}) {
  if (!fs.existsSync(config.backupDir)) return { kept: 0, deleted: 0, freedBytes: 0 };
  const files = fs
    .readdirSync(config.backupDir)
    .filter((f) => /^vfd-knowledge-.*\.db$/.test(f))
    .map((f) => {
      const full = path.join(config.backupDir, f);
      const st = fs.statSync(full);
      return { full, t: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.t - a.t); // newest first
  const seen = new Set<string>();
  let kept = 0, deleted = 0, freedBytes = 0;
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='backups'").get();
  for (const f of files) {
    const wk = weekKey(f.t);
    if (!seen.has(wk)) { seen.add(wk); kept++; continue; }
    deleted++; freedBytes += f.size;
    if (opts.dryRun) continue;
    fs.rmSync(f.full, { force: true });
    if (hasTable) db.prepare('DELETE FROM backups WHERE file_rel_path = ?').run(path.relative(config.root, f.full).replace(/\\/g, '/'));
  }
  // drop rows whose file is gone (deleted above or removed by hand)
  if (hasTable && !opts.dryRun) {
    for (const r of db.prepare('SELECT id, file_rel_path FROM backups').all() as { id: number; file_rel_path: string }[])
      if (!fs.existsSync(path.join(config.root, r.file_rel_path))) db.prepare('DELETE FROM backups WHERE id = ?').run(r.id);
  }
  return { kept, deleted, freedBytes };
}
