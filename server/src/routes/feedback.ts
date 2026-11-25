import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { ah, badRequest, HttpError, intParam, notFound, oneOf, paging, str } from '../lib/http.js';
import { audit, logActivity } from '../lib/audit.js';
import { purgeUpload, safeResolve, saveUserImage, userRoot } from '../services/storage.js';
import { requireSuperAdmin } from '../auth/middleware.js';
import { isValidEmail, normalizeEmail } from '../auth/password.js';
import { assertFeature } from '../services/premium.js';

/**
 * Requests and complaints sent by users (message + optional images).
 * Users see only their own; the Super Admin sees everything and sets the status / a reply note.
 */
export const feedbackRouter = Router();

const KINDS = ['request', 'complaint'] as const;
const STATUSES = ['new', 'in_progress', 'resolved'] as const;
const MAX_IMAGES = 5;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: MAX_IMAGES } });

const withImages = (rows: any[]) => {
  const db = getDb();
  const st = db.prepare('SELECT f.upload_id, u.original_filename name FROM feedback_images f JOIN user_uploads u ON u.id = f.upload_id WHERE f.feedback_id = ? AND u.purged_at IS NULL ORDER BY f.id');
  return rows.map((r) => ({ ...r, images: st.all(r.id) }));
};

feedbackRouter.post(
  '/',
  upload.array('files', MAX_IMAGES),
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const kind = oneOf(req.body.kind, 'kind', KINDS);
    if (kind === 'request') assertFeature(req.user!, 'lock_requests', 'Sending a request (for example a new VFD manual) is a Pro feature. Complaints stay free.');
    const message = str(req.body.message, 'message', { required: true, max: 4000 })!;
    if (message.trim().length < 3) throw badRequest('Please write a few words (at least 3 characters)');
    // optional contact details
    const phoneRaw = str(req.body.contact_phone, 'contact_phone', { max: 40 })?.trim() || null;
    if (phoneRaw && !(/^[0-9+()\-.\s]{5,25}$/.test(phoneRaw) && (phoneRaw.match(/\d/g)?.length ?? 0) >= 5)) throw badRequest('Phone number looks invalid (digits, + - ( ) and spaces only)');
    const emailRaw = str(req.body.contact_email, 'contact_email', { max: 200 })?.trim() || null;
    if (emailRaw && !isValidEmail(normalizeEmail(emailRaw))) throw badRequest('Email address looks invalid');
    const files = (req.files as Express.Multer.File[]) ?? [];
    const recent = (db.prepare("SELECT COUNT(*) c FROM feedback_requests WHERE user_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')").get(uid) as any).c;
    if (recent >= 20) throw new HttpError(429, 'Too many messages sent recently; please try again later');
    const id = Number(db.prepare('INSERT INTO feedback_requests(user_id, kind, message, contact_phone, contact_email) VALUES (?,?,?,?,?)').run(uid, kind, message.trim(), phoneRaw, emailRaw).lastInsertRowid);
    try {
      for (const f of files) {
        const uploadId = await saveUserImage({ userId: uid, buf: f.buffer, originalName: f.originalname, kind: 'upload', subdir: `feedback/${id}` });
        db.prepare('INSERT INTO feedback_images(feedback_id, upload_id) VALUES (?,?)').run(id, uploadId);
      }
    } catch (e) {
      const ups = db.prepare('SELECT upload_id FROM feedback_images WHERE feedback_id = ?').all(id) as { upload_id: number }[];
      for (const u of ups) purgeUpload(uid, u.upload_id);
      db.prepare('DELETE FROM feedback_images WHERE feedback_id = ?').run(id);
      db.prepare('DELETE FROM feedback_requests WHERE id = ?').run(id);
      throw e;
    }
    logActivity({ userId: uid, event: 'feedback_sent', entityType: 'feedback', entityId: id, meta: { kind, images: files.length } });
    res.status(201).json({ id });
  }),
);

/** The caller's own messages (so a user can see the status / reply). */
feedbackRouter.get(
  '/mine',
  ah(async (req, res) => {
    const rows = getDb().prepare('SELECT id, kind, message, contact_phone, contact_email, status, admin_note, created_at, updated_at FROM feedback_requests WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user!.id);
    res.json({ rows: withImages(rows as any[]) });
  }),
);

feedbackRouter.get(
  '/',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const where: string[] = [];
    const args: unknown[] = [];
    if (req.query.status) { where.push('f.status = ?'); args.push(oneOf(req.query.status, 'status', STATUSES)); }
    if (req.query.kind) { where.push('f.kind = ?'); args.push(oneOf(req.query.kind, 'kind', KINDS)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { limit, offset, page } = paging(req.query as any, 50, 200);
    const total = (db.prepare(`SELECT COUNT(*) c FROM feedback_requests f ${w}`).get(...args) as any).c;
    const rows = db
      .prepare(`SELECT f.*, u.email, u.display_name FROM feedback_requests f JOIN users u ON u.id = f.user_id ${w} ORDER BY (f.status = 'resolved'), f.id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    const counts = db.prepare('SELECT status, COUNT(*) n FROM feedback_requests GROUP BY status').all();
    res.json({ total, page, limit, rows: withImages(rows as any[]), counts });
  }),
);

feedbackRouter.patch(
  '/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const cur = db.prepare('SELECT * FROM feedback_requests WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Message not found');
    const status = req.body.status === undefined ? cur.status : oneOf(req.body.status, 'status', STATUSES);
    const note = req.body.admin_note === undefined ? cur.admin_note : str(req.body.admin_note, 'admin_note', { max: 2000 });
    db.prepare("UPDATE feedback_requests SET status = ?, admin_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, note, id);
    audit({ entityType: 'feedback', entityId: id, operation: 'update', previous: { status: cur.status }, next: { status }, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);

/** Image file: only the sender or the Super Admin. */
feedbackRouter.get(
  '/images/:uploadId',
  ah(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT f.user_id sender, u.stored_rel_path, u.thumbnail_rel_path, u.mime, u.user_id owner
         FROM feedback_images fi JOIN feedback_requests f ON f.id = fi.feedback_id JOIN user_uploads u ON u.id = fi.upload_id
         WHERE fi.upload_id = ? AND u.purged_at IS NULL`,
      )
      .get(intParam(req.params.uploadId, 'uploadId', { required: true })) as any;
    if (!row || (row.sender !== req.user!.id && req.user!.role !== 'super_admin')) throw notFound('Image not found');
    const thumb = req.query.thumb === '1' && row.thumbnail_rel_path;
    const abs = safeResolve(userRoot(row.owner), thumb ? row.thumbnail_rel_path : row.stored_rel_path);
    if (!fs.existsSync(abs)) throw new HttpError(410, 'Image file is missing on the server');
    res.setHeader('Content-Type', thumb ? 'image/webp' : row.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(abs);
  }),
);
