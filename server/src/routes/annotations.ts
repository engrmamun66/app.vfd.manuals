import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { getDb, type DB } from '../db/index.js';
import { ah, badRequest, bool, HttpError, intParam, notFound, oneOf, str } from '../lib/http.js';
import { logActivity } from '../lib/audit.js';
import { json, parseJson } from '../lib/util.js';
import { purgeUpload, safeResolve, saveUserImage, userRoot } from '../services/storage.js';
import { userLimits } from '../services/settings.js';
import { assertUploadSize, assertWithinLimit } from '../services/premium.js';

/**
 * Shared Text Anchor + Independent User Annotations (§35).
 * Visibility is enforced in every SQL read: own items, or other users' PUBLIC non-trashed items.
 * Private items of other users are never returned, counted or hinted at.
 */
export const annotationsRouter = Router();

const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'] as const;
const VISIBLE = `(a.user_id = @uid OR (a.visibility = 'public' AND a.deletion_status = 'active'))`;

function validateLinks(v: unknown) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw badRequest('links must be an array');
  return v.slice(0, 20).map((l: any) => {
    const url = String(l?.url ?? '').trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest(`Invalid link URL: ${url.slice(0, 80)}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('Only http: and https: links are allowed');
    return { url: parsed.toString().slice(0, 2000), text: String(l?.text ?? '').trim().slice(0, 200) || null };
  });
}

function ownAnnotation(db: DB, uid: number, id: number) {
  const a = db.prepare('SELECT * FROM research_annotations WHERE id = ? AND user_id = ?').get(id, uid) as any;
  if (!a) throw notFound('Annotation not found'); // same response whether it exists for someone else or not
  return a;
}

function attachmentsFor(db: DB, annotationIds: number[]) {
  if (!annotationIds.length) return new Map<number, any[]>();
  const rows = db
    .prepare(
      `SELECT t.id, t.annotation_id, t.alt_text, u.mime, u.width, u.height, u.size_bytes, u.original_filename, (u.thumbnail_rel_path IS NOT NULL) has_thumb
       FROM research_annotation_attachments t JOIN user_uploads u ON u.id = t.upload_id
       WHERE t.removed_at IS NULL AND u.purged_at IS NULL AND t.annotation_id IN (${annotationIds.map(() => '?').join(',')}) ORDER BY t.id`,
    )
    .all(...annotationIds) as any[];
  const m = new Map<number, any[]>();
  for (const r of rows) m.set(r.annotation_id, [...(m.get(r.annotation_id) ?? []), r]);
  return m;
}

function shape(db: DB, rows: any[], uid: number) {
  const atts = attachmentsFor(db, rows.map((r) => r.id));
  return rows.map((a) => ({
    id: a.id,
    anchorId: a.anchor_id,
    isOwn: a.user_id === uid,
    author: a.author_name,
    comment: a.comment_text,
    links: parseJson<any[] | null>(a.links_json, []) ?? [],
    color: a.highlight_color,
    visibility: a.user_id === uid ? a.visibility : 'public',
    status: a.anchor_status === 'requires_reattachment' ? 'Requires Reattachment' : a.anchor_status === 'source_unavailable' ? 'Source Unavailable' : a.annotation_status,
    favorite: a.user_id === uid ? !!a.favorite : false,
    deletionStatus: a.user_id === uid ? a.deletion_status : 'active',
    deletedAt: a.user_id === uid ? a.deleted_at : null,
    researchUrl: a.research_url ?? a.anchor_url,
    sectionId: a.section_id,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    attachments: atts.get(a.id) ?? [],
    anchor: {
      contentKey: a.content_key,
      selectedText: a.selected_text,
      start: a.start_offset,
      end: a.end_offset,
      prefix: a.text_prefix,
      suffix: a.text_suffix,
      contentHash: a.content_hash,
      entityType: a.entity_type,
      entityId: a.entity_id,
      brand: a.brand_name,
      model: a.model_name,
      documentId: a.document_id,
      revisionId: a.revision_id,
    },
  }));
}

const SELECT = `SELECT a.*, COALESCE(u.display_name, 'User #' || u.id) author_name, x.content_key, x.selected_text, x.start_offset, x.end_offset, x.text_prefix, x.text_suffix,
  x.content_hash, x.entity_type, x.entity_id, x.anchor_status, x.research_url anchor_url, x.document_id, x.revision_id, br.name brand_name, m.name model_name
  FROM research_annotations a JOIN research_text_anchors x ON x.id = a.anchor_id JOIN users u ON u.id = a.user_id
  LEFT JOIN brands br ON br.id = x.brand_id LEFT JOIN models m ON m.id = x.model_id`;

/** Annotations for rendered content blocks on the current page. */
annotationsRouter.get(
  '/for-content',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const keys = String(req.query.keys || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (!keys.length) return res.json([]);
    const rows = db
      .prepare(`${SELECT} WHERE x.content_key IN (${keys.map((_, i) => `@k${i}`).join(',')}) AND ${VISIBLE} AND a.deletion_status = 'active' ORDER BY a.created_at`)
      .all({ uid, ...Object.fromEntries(keys.map((k, i) => [`k${i}`, k])) }) as any[];
    res.json(shape(db, rows, uid));
  }),
);

/** Annotations whose content key starts with a prefix (used by the page-wide annotation layer: all keys of one page). */
annotationsRouter.get(
  '/for-prefix',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const prefix = String(req.query.prefix || '');
    if (!/^ui:[A-Za-z0-9_.:-]+$/.test(prefix) || prefix.length > 120) throw badRequest('Invalid prefix');
    const rows = db
      .prepare(`${SELECT} WHERE x.content_key LIKE @p ESCAPE '!' AND ${VISIBLE} AND a.deletion_status = 'active' ORDER BY a.created_at LIMIT 1000`)
      .all({ uid, p: prefix.replace(/[%_!]/g, (c) => '!' + c) + '%' }) as any[];
    res.json(shape(db, rows, uid));
  }),
);

annotationsRouter.post(
  '/',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const b = req.body ?? {};
    const contentKey = str(b.contentKey, 'contentKey', { required: true, max: 200 })!;
    if (!/^[a-z_]+:[A-Za-z0-9_.:-]+$/.test(contentKey)) throw badRequest('Invalid contentKey');
    const selected = typeof b.selectedText === 'string' ? b.selectedText : '';
    if (!selected.trim() || selected.length > 5000) throw badRequest('selectedText is required (max 5000 chars)');
    const color = b.color === null || b.color === undefined || b.color === '' ? null : oneOf(b.color, 'color', COLORS);
    const visibility = oneOf(b.visibility, 'visibility', ['private', 'public'] as const, 'private');
    const comment = str(b.comment, 'comment', { max: 20000 });
    if (!comment && !color) throw badRequest('Provide a comment, a highlight color, or both');
    if (comment) assertWithinLimit(req.user!, 'comments');
    if (color) assertWithinLimit(req.user!, 'highlights');
    const links = validateLinks(b.links);
    const start = intParam(b.start, 'start', { min: 0 });
    const end = intParam(b.end, 'end', { min: 0 });
    const prefix = typeof b.prefix === 'string' ? b.prefix.slice(-64) : null;
    const suffix = typeof b.suffix === 'string' ? b.suffix.slice(0, 64) : null;
    const contentHash = str(b.contentHash, 'contentHash', { max: 80 });
    const url = str(b.researchUrl, 'researchUrl', { max: 2000 });
    if (url && (!url.startsWith('/') || url.startsWith('//'))) throw badRequest('researchUrl must be an internal path');
    const ctx = b.context && typeof b.context === 'object' ? b.context : {};
    const fk = (table: string, v: unknown) => {
      const n = intParam(v, table);
      return n && db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(n) ? n : null;
    };
    const id = db.transaction(() => {
      // reuse a shared anchor only on an exact, unambiguous match of text + context
      let anchor = db
        .prepare(
          `SELECT id FROM research_text_anchors WHERE content_key = ? AND selected_text = ? AND start_offset IS ? AND end_offset IS ?
             AND text_prefix IS ? AND text_suffix IS ? AND content_hash IS ? AND anchor_status = 'active' LIMIT 1`,
        )
        .get(contentKey, selected, start, end, prefix, suffix, contentHash) as any;
      if (!anchor) {
        anchor = {
          id: Number(
            db
              .prepare(
                `INSERT INTO research_text_anchors(content_key, content_hash, research_url, entity_type, entity_id, brand_id, model_id, parameter_id, modbus_register_id,
                   document_id, revision_id, document_page_id, selected_text, start_offset, end_offset, text_prefix, text_suffix)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
                contentKey,
                contentHash,
                url,
                ctx.entityType ? String(ctx.entityType).slice(0, 40) : null,
                intParam(ctx.entityId, 'entityId'),
                fk('brands', ctx.brandId),
                fk('models', ctx.modelId),
                fk('parameters', ctx.parameterId),
                fk('modbus_registers', ctx.registerId),
                fk('documents', ctx.documentId),
                fk('document_revisions', ctx.revisionId),
                fk('document_pages', ctx.pageId),
                selected,
                start,
                end,
                prefix,
                suffix,
              ).lastInsertRowid,
          ),
        };
      }
      return Number(
        db
          .prepare('INSERT INTO research_annotations(anchor_id, user_id, comment_text, links_json, highlight_color, visibility, research_url, section_id) VALUES (?,?,?,?,?,?,?,?)')
          .run(anchor.id, uid, comment, json(links), color, visibility, url, str(b.sectionId, 'sectionId', { max: 100 })).lastInsertRowid,
      );
    })();
    logActivity({ userId: uid, event: color && comment ? 'annotation_create' : color ? 'highlight_create' : 'comment_create', entityType: 'annotation', entityId: id, meta: { visibility } });
    const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
    res.status(201).json(shape(db, [row], uid)[0]);
  }),
);

annotationsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const id = intParam(req.params.id, 'id', { required: true })!;
    const a = ownAnnotation(db, uid, id);
    const b = req.body ?? {};
    const sets: Record<string, unknown> = {};
    if ('comment' in b) sets.comment_text = str(b.comment, 'comment', { max: 20000 });
    if ('color' in b) sets.highlight_color = b.color === null || b.color === '' ? null : oneOf(b.color, 'color', COLORS);
    if ('visibility' in b) sets.visibility = oneOf(b.visibility, 'visibility', ['private', 'public'] as const);
    if ('links' in b) sets.links_json = json(validateLinks(b.links));
    if ('favorite' in b) sets.favorite = bool(b.favorite) ? 1 : 0;
    if (!Object.keys(sets).length) throw badRequest('Nothing to update');
    const nextComment = 'comment_text' in sets ? sets.comment_text : a.comment_text;
    const nextColor = 'highlight_color' in sets ? sets.highlight_color : a.highlight_color;
    if (!nextComment && !nextColor) throw badRequest('An annotation needs a comment or a highlight. Use "Delete complete annotation" to remove it.');
    db.prepare(`UPDATE research_annotations SET ${Object.keys(sets).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(
      ...Object.values(sets),
      new Date().toISOString(),
      id,
      uid,
    );
    const event = 'highlight_color' in sets && sets.highlight_color === null ? 'highlight_remove' : 'visibility' in sets ? 'annotation_visibility_change' : 'annotation_edit';
    logActivity({ userId: uid, event, entityType: 'annotation', entityId: id, meta: { fields: Object.keys(sets) } });
    res.json(shape(db, [db.prepare(`${SELECT} WHERE a.id = ?`).get(id)], uid)[0]);
  }),
);

/** Delete Comment: removes only the comment text; if no highlight remains the annotation moves to Trash. */
annotationsRouter.post(
  '/:id/delete-comment',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const a = ownAnnotation(db, uid, intParam(req.params.id, 'id', { required: true })!);
    const now = new Date().toISOString();
    if (a.highlight_color) db.prepare('UPDATE research_annotations SET comment_text = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(now, a.id, uid);
    else db.prepare("UPDATE research_annotations SET deletion_status='trashed', deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE id = ? AND user_id = ?").run(now, uid, now, a.id, uid);
    logActivity({ userId: uid, event: 'comment_delete', entityType: 'annotation', entityId: a.id, meta: { trashed: !a.highlight_color } });
    res.json({ ok: true, trashed: !a.highlight_color });
  }),
);

annotationsRouter.post(
  '/:id/trash',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const a = ownAnnotation(db, uid, intParam(req.params.id, 'id', { required: true })!);
    const now = new Date().toISOString();
    db.prepare("UPDATE research_annotations SET deletion_status='trashed', deleted_at=?, deleted_by_user_id=?, updated_at=? WHERE id = ? AND user_id = ?").run(now, uid, now, a.id, uid);
    logActivity({ userId: uid, event: 'annotation_delete', entityType: 'annotation', entityId: a.id });
    res.json({ ok: true });
  }),
);

annotationsRouter.post(
  '/:id/restore',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const a = ownAnnotation(db, uid, intParam(req.params.id, 'id', { required: true })!);
    if (a.deletion_status !== 'trashed') throw badRequest('Annotation is not in Trash');
    const now = new Date().toISOString();
    db.prepare("UPDATE research_annotations SET deletion_status='active', deleted_at=NULL, deleted_by_user_id=NULL, restored_at=?, updated_at=? WHERE id = ? AND user_id = ?").run(now, now, a.id, uid);
    logActivity({ userId: uid, event: 'annotation_restore', entityType: 'annotation', entityId: a.id });
    res.json({ ok: true });
  }),
);

/** Permanent delete: requires explicit confirmation; removes only this user's annotation + exclusively owned files. */
annotationsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const a = ownAnnotation(db, uid, intParam(req.params.id, 'id', { required: true })!);
    if (req.query.confirm !== 'PERMANENT') throw badRequest('Permanent deletion requires confirm=PERMANENT');
    const atts = db.prepare('SELECT upload_id FROM research_annotation_attachments WHERE annotation_id = ? AND user_id = ?').all(a.id, uid) as any[];
    db.transaction(() => {
      db.prepare('DELETE FROM research_annotation_attachments WHERE annotation_id = ? AND user_id = ?').run(a.id, uid);
      db.prepare('DELETE FROM research_annotations WHERE id = ? AND user_id = ?').run(a.id, uid);
      // anchors are shared; remove only if no other annotation references it
      const others = db.prepare('SELECT COUNT(*) c FROM research_annotations WHERE anchor_id = ?').get(a.anchor_id) as any;
      if (!others.c) db.prepare('DELETE FROM research_text_anchors WHERE id = ?').run(a.anchor_id);
    })();
    for (const t of atts) purgeUpload(uid, t.upload_id);
    logActivity({ userId: uid, event: 'annotation_permanent_delete', entityType: 'annotation', entityId: a.id, meta: { attachmentsPurged: atts.length } });
    res.json({ ok: true });
  }),
);

annotationsRouter.get(
  '/mine',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const q = req.query as any;
    const where = ['a.user_id = @uid'];
    const p: Record<string, unknown> = { uid };
    where.push(q.status === 'trashed' ? "a.deletion_status = 'trashed'" : "a.deletion_status = 'active'");
    if (q.color) (where.push('a.highlight_color = @color'), (p.color = String(q.color)));
    if (q.visibility) (where.push('a.visibility = @vis'), (p.vis = String(q.visibility)));
    if (q.brand) (where.push('x.brand_id = @brand'), (p.brand = Number(q.brand)));
    if (q.model) (where.push('x.model_id = @model'), (p.model = Number(q.model)));
    if (q.document) (where.push('x.document_id = @doc'), (p.doc = Number(q.document)));
    if (q.entityType) (where.push('x.entity_type = @et'), (p.et = String(q.entityType)));
    if (q.favorite === '1') where.push('a.favorite = 1');
    if (q.reattach === '1') where.push("x.anchor_status != 'active'");
    if (q.text) (where.push('x.selected_text LIKE @text'), (p.text = `%${String(q.text).slice(0, 100)}%`));
    if (q.comment) (where.push('a.comment_text LIKE @comment'), (p.comment = `%${String(q.comment).slice(0, 100)}%`));
    if (q.from) (where.push('a.created_at >= @from'), (p.from = String(q.from)));
    if (q.to) (where.push('a.created_at <= @to'), (p.to = String(q.to)));
    const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 1000`).all(p) as any[];
    res.json(shape(db, rows, uid));
  }),
);

/** Public annotations of other users (read-only), for browsing. */
annotationsRouter.get(
  '/public',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const rows = db.prepare(`${SELECT} WHERE a.user_id != @uid AND a.visibility = 'public' AND a.deletion_status = 'active' ORDER BY a.created_at DESC LIMIT 300`).all({ uid }) as any[];
    res.json(shape(db, rows, uid));
  }),
);

/** Client reports that an anchor's text could not be re-located after content changed. */
annotationsRouter.post(
  '/anchors/:id/status',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const id = intParam(req.params.id, 'id', { required: true })!;
    const status = oneOf(req.body.status, 'status', ['active', 'requires_reattachment'] as const);
    const visible = db.prepare(`SELECT 1 FROM research_annotations a WHERE a.anchor_id = @id AND ${VISIBLE}`).get({ id, uid });
    if (!visible) throw notFound();
    db.prepare('UPDATE research_text_anchors SET anchor_status = ? WHERE id = ?').run(status, id);
    res.json({ ok: true });
  }),
);

// ---------- attachments ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

annotationsRouter.post(
  '/:id/attachments',
  upload.array('files', 10),
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const a = ownAnnotation(db, uid, intParam(req.params.id, 'id', { required: true })!);
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw badRequest('No files uploaded');
    const existing = (db.prepare('SELECT COUNT(*) c FROM research_annotation_attachments WHERE annotation_id = ? AND removed_at IS NULL').get(a.id) as any).c;
    const lim = userLimits(uid);
    if (existing + files.length > lim.maxAttachmentsPerComment) throw new HttpError(413, `A comment can have at most ${lim.maxAttachmentsPerComment} images`);
    const created: number[] = [];
    for (const f of files) assertUploadSize(req.user!, f.size);
    for (const f of files) {
      const uploadId = await saveUserImage({ userId: uid, buf: f.buffer, originalName: f.originalname, kind: 'comment-attachment', subdir: `comment-attachments/${a.id}` });
      created.push(
        Number(
          db.prepare('INSERT INTO research_annotation_attachments(annotation_id, user_id, upload_id, alt_text) VALUES (?,?,?,?)').run(a.id, uid, uploadId, str(req.body.alt, 'alt', { max: 300 })).lastInsertRowid,
        ),
      );
      logActivity({ userId: uid, event: 'file_upload', entityType: 'annotation_attachment', entityId: created[created.length - 1], meta: { size: f.size } });
    }
    res.status(201).json({ ids: created });
  }),
);

annotationsRouter.delete(
  '/:id/attachments/:attId',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const a = ownAnnotation(db, uid, intParam(req.params.id, 'id', { required: true })!);
    const att = db.prepare('SELECT * FROM research_annotation_attachments WHERE id = ? AND annotation_id = ? AND user_id = ?').get(intParam(req.params.attId, 'attId', { required: true }), a.id, uid) as any;
    if (!att) throw notFound('Attachment not found');
    db.prepare('UPDATE research_annotation_attachments SET removed_at = ? WHERE id = ?').run(new Date().toISOString(), att.id);
    db.prepare('UPDATE user_uploads SET deleted_at = ? WHERE id = ? AND user_id = ?').run(new Date().toISOString(), att.upload_id, uid);
    // file purged immediately (attachment removal is an explicit owner action)
    purgeUpload(uid, att.upload_id);
    logActivity({ userId: uid, event: 'file_delete', entityType: 'annotation_attachment', entityId: att.id });
    res.json({ ok: true });
  }),
);

/** Serves an attachment after re-checking visibility on every request. Paths are never exposed. */
annotationsRouter.get(
  '/attachments/:attId/file',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const row = db
      .prepare(
        `SELECT t.*, u.stored_rel_path, u.thumbnail_rel_path, u.mime, u.user_id owner_id, a.visibility, a.deletion_status, a.user_id ann_owner
         FROM research_annotation_attachments t JOIN user_uploads u ON u.id=t.upload_id JOIN research_annotations a ON a.id=t.annotation_id
         WHERE t.id = ? AND t.removed_at IS NULL AND u.purged_at IS NULL`,
      )
      .get(intParam(req.params.attId, 'attId', { required: true })) as any;
    const allowed = row && (row.ann_owner === uid || (row.visibility === 'public' && row.deletion_status === 'active'));
    if (!allowed) throw notFound('Attachment not found');
    const thumb = req.query.thumb === '1' && row.thumbnail_rel_path;
    const abs = safeResolve(userRoot(row.owner_id), thumb ? row.thumbnail_rel_path : row.stored_rel_path);
    if (!fs.existsSync(abs)) throw new HttpError(410, 'Attachment file is missing on the server');
    res.setHeader('Content-Type', thumb ? 'image/webp' : row.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(abs);
  }),
);
