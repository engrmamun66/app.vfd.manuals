import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, storagePaths } from '../config.js';
import { getDb } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { sha256 } from '../lib/util.js';
import { userLimits } from './settings.js';

export const USER_SUBDIRS = ['profile', 'uploads', 'media', 'annotation-images', 'comment-attachments', 'documents', 'thumbnails', 'exports'] as const;

/** Private root keyed by immutable numeric user id (never email/username). */
export function userRoot(userId: number): string {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid user id');
  return path.join(storagePaths.users(), `user-${userId}`);
}
export function ensureUserDirs(userId: number) {
  const root = userRoot(userId);
  for (const d of USER_SUBDIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

/** Resolve a stored relative path and guarantee it stays inside `base` (no traversal / symlink escape). */
export function safeResolve(base: string, rel: string): string {
  const baseReal = fs.existsSync(base) ? fs.realpathSync(base) : path.resolve(base);
  const target = path.resolve(baseReal, rel);
  const relCheck = path.relative(baseReal, target);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new HttpError(400, 'Invalid path');
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const r2 = path.relative(baseReal, real);
    if (r2.startsWith('..') || path.isAbsolute(r2)) throw new HttpError(400, 'Invalid path');
  }
  return target;
}

// ---------- content sniffing (do not trust extensions) ----------
export type Sniffed = { mime: string; ext: string } | null;
export function sniff(buf: Buffer): Sniffed {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function makeThumbnail(buf: Buffer, outFile: string): Promise<number> {
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(buf);
    const scale = Math.min(1, 320 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = createCanvas(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const out = await c.encode('webp', 80);
    fs.writeFileSync(outFile, out);
    return out.length;
  } catch {
    return 0;
  }
}

export function storageUsage(userId: number) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT kind, mime, COUNT(*) n, COALESCE(SUM(size_bytes),0) bytes, COALESCE(SUM(thumbnail_bytes),0) tb
       FROM user_uploads WHERE user_id = ? AND purged_at IS NULL GROUP BY kind, mime`,
    )
    .all(userId) as { kind: string; mime: string; n: number; bytes: number; tb: number }[];
  const out = { total: 0, files: 0, images: 0, attachments: 0, documents: 0, exports: 0, uploads: 0, thumbnails: 0 };
  for (const r of rows) {
    out.total += r.bytes + r.tb;
    out.thumbnails += r.tb;
    out.files += r.n;
    if (r.mime.startsWith('image/')) out.images += r.bytes;
    if (r.kind === 'comment-attachment') out.attachments += r.bytes;
    else if (r.kind === 'document') out.documents += r.bytes;
    else if (r.kind === 'export') out.exports += r.bytes;
    else out.uploads += r.bytes;
  }
  return out;
}

/** Walks the user's directory and compares with metadata. Reports missing files & orphans visibly. */
export function reconcileStorage(userId: number) {
  const db = getDb();
  const root = userRoot(userId);
  const meta = db
    .prepare('SELECT id, stored_rel_path, thumbnail_rel_path, size_bytes FROM user_uploads WHERE user_id = ? AND purged_at IS NULL')
    .all(userId) as { id: number; stored_rel_path: string; thumbnail_rel_path: string | null; size_bytes: number }[];
  const known = new Set<string>();
  const missing: number[] = [];
  const sizeMismatch: number[] = [];
  for (const m of meta) {
    known.add(path.normalize(m.stored_rel_path));
    if (m.thumbnail_rel_path) known.add(path.normalize(m.thumbnail_rel_path));
    const f = path.join(root, m.stored_rel_path);
    if (!fs.existsSync(f)) missing.push(m.id);
    else if (fs.statSync(f).size !== m.size_bytes) sizeMismatch.push(m.id);
  }
  let fsBytes = 0;
  let fsFiles = 0;
  const orphans: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        fsFiles++;
        fsBytes += fs.statSync(p).size;
        const rel = path.normalize(path.relative(root, p));
        if (!known.has(rel)) orphans.push(rel.replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return { filesystemBytes: fsBytes, filesystemFiles: fsFiles, missingFileUploadIds: missing, sizeMismatchUploadIds: sizeMismatch, orphanFiles: orphans.slice(0, 200), orphanCount: orphans.length };
}

/**
 * Validated, quota-checked, owner-scoped image save. Writes file first to a temp name,
 * then inserts metadata; cleans up on failure so DB and disk stay consistent.
 */
export async function saveUserImage(opts: { userId: number; buf: Buffer; originalName: string | null; kind: 'comment-attachment' | 'upload'; subdir: string }) {
  const limits = userLimits(opts.userId);
  const s = sniff(opts.buf);
  if (!s || !['image/jpeg', 'image/png', 'image/webp'].includes(s.mime))
    throw new HttpError(415, 'Only JPEG, PNG or WebP images are allowed (file content did not match an allowed image type)');
  if (opts.buf.length > limits.maxFileBytes) throw new HttpError(413, `Image exceeds the per-file limit of ${limits.maxFileBytes} bytes`);
  const used = storageUsage(opts.userId).total;
  if (used + opts.buf.length > limits.quotaBytes)
    throw new HttpError(413, `Storage quota exceeded (${used} of ${limits.quotaBytes} bytes used)`);
  const root = ensureUserDirs(opts.userId);
  const id = crypto.randomUUID();
  const relDir = opts.subdir.replace(/\\/g, '/');
  if (relDir.includes('..')) throw new HttpError(400, 'Invalid directory');
  const rel = path.join(relDir, `${id}.${s.ext}`);
  const thumbRel = path.join('thumbnails', `${id}.webp`);
  const abs = safeResolve(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.part';
  fs.writeFileSync(tmp, opts.buf, { flag: 'wx' });
  fs.renameSync(tmp, abs);
  const tb = await makeThumbnail(opts.buf, safeResolve(root, thumbRel));
  const dims = imageSize(opts.buf, s.mime);
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO user_uploads(user_id, kind, original_filename, stored_rel_path, thumbnail_rel_path, extension, mime, size_bytes, thumbnail_bytes, width, height, sha256)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(opts.userId, opts.kind, opts.originalName?.slice(0, 200) ?? null, rel, tb ? thumbRel : null, s.ext, s.mime, opts.buf.length, tb, dims?.width ?? null, dims?.height ?? null, sha256(opts.buf));
    return Number(info.lastInsertRowid);
  } catch (e) {
    fs.rmSync(abs, { force: true });
    fs.rmSync(safeResolve(root, thumbRel), { force: true });
    throw e;
  }
}

/** Physically remove an upload owned by userId (permanent delete). */
export function purgeUpload(userId: number, uploadId: number) {
  const db = getDb();
  const u = db.prepare('SELECT * FROM user_uploads WHERE id = ? AND user_id = ?').get(uploadId, userId) as any;
  if (!u || u.purged_at) return;
  const root = userRoot(userId);
  for (const rel of [u.stored_rel_path, u.thumbnail_rel_path].filter(Boolean)) fs.rmSync(safeResolve(root, rel), { force: true });
  db.prepare('UPDATE user_uploads SET purged_at = ?, deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(new Date().toISOString(), new Date().toISOString(), uploadId);
}

export const systemDirsReady = () => {
  for (const d of [storagePaths.extractedText(), storagePaths.pageImages(), storagePaths.thumbnails(), storagePaths.ocrResults(), storagePaths.system(), storagePaths.users(), storagePaths.uploadsTmp(), storagePaths.importedManuals()])
    fs.mkdirSync(d, { recursive: true });
  return config.storageDir;
};
