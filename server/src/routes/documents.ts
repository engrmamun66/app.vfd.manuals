import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config, storagePaths } from '../config.js';
import { getDb } from '../db/index.js';
import { ah, badRequest, intParam, notFound, oneOf, str, HttpError } from '../lib/http.js';
import { parseJson, sha256, slugify } from '../lib/util.js';
import { requireSuperAdmin } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { cdJoin, cdOrder, cdVisible, includeHidden } from '../services/visibility.js';
import { DocumentIngestionService, matchQuote, ensureBrandModel } from '../services/ingestion/DocumentIngestionService.js';
import { pdfPageWords, renderPdfPage } from '../services/ingestion/pdf.js';
import { approveStaged, rejectStaged } from '../services/review.js';
import { listCuratedFiles } from '../services/ingestion/curated.js';
import { sniff } from '../services/storage.js';

export const docsRouter = Router();

// ---------------- library ----------------
docsRouter.get(
  '/documents',
  ah(async (req, res) => {
    const all = includeHidden(req);
    const rows = getDb()
      .prepare(
        `SELECT d.*, b.name brand, ${cdOrder('cd')} display_order, COALESCE(cd.visible,1) visible,
           (SELECT json_group_array(json_object('id', m.id, 'name', m.name)) FROM document_models dm JOIN models m ON m.id=dm.model_id WHERE dm.document_id=d.id) models_json,
           (SELECT json_group_array(json_object('id', r.id, 'label', r.revision_label, 'file', r.original_filename, 'format', r.file_format, 'pages', r.page_count,
               'textPages', r.text_layer_pages, 'ocr', r.ocr_status, 'status', r.status, 'size', r.file_size, 'imported_at', r.imported_at, 'path', r.source_rel_path))
             FROM document_revisions r WHERE r.document_id=d.id) revisions_json
         FROM documents d LEFT JOIN brands b ON b.id=d.brand_id ${cdJoin('document', 'd', 'cd')}
         ${all ? '' : `WHERE ${cdVisible('cd')}`} ORDER BY ${cdOrder('cd')}, b.name, d.title`,
      )
      .all()
      .map((d: any) => ({ ...d, models: parseJson(d.models_json, []), revisions: parseJson(d.revisions_json, []), models_json: undefined, revisions_json: undefined }));
    res.json(rows);
  }),
);

docsRouter.get(
  '/documents/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true });
    const d = db.prepare('SELECT d.*, b.name brand FROM documents d LEFT JOIN brands b ON b.id=d.brand_id WHERE d.id = ?').get(id) as any;
    if (!d) throw notFound('Document not found');
    res.json({
      ...d,
      models: db.prepare('SELECT m.id, m.name, b.name brand, dm.relation_status FROM document_models dm JOIN models m ON m.id=dm.model_id JOIN brands b ON b.id=m.brand_id WHERE dm.document_id=?').all(id),
      revisions: db.prepare('SELECT * FROM document_revisions WHERE document_id = ? ORDER BY id').all(id),
      evidenceCount: (db.prepare('SELECT COUNT(*) c FROM source_references s JOIN document_revisions r ON r.id=s.revision_id WHERE r.document_id=?').get(id) as any).c,
    });
  }),
);

docsRouter.patch(
  '/documents/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const prev = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!prev) throw notFound();
    const status = req.body.identification_status ? oneOf(req.body.identification_status, 'identification_status', ['verified', 'needs_review', 'unverified']) : prev.identification_status;
    const title = req.body.title !== undefined ? str(req.body.title, 'title', { required: true, max: 300 }) : prev.title;
    const notes = req.body.notes !== undefined ? str(req.body.notes, 'notes', { max: 5000 }) : prev.notes;
    db.prepare('UPDATE documents SET identification_status = ?, title = ?, notes = ?, updated_at = ? WHERE id = ?').run(status, title, notes, new Date().toISOString(), id);
    if (req.body.model_id) {
      const mid = intParam(req.body.model_id, 'model_id')!;
      db.prepare("INSERT INTO document_models(document_id, model_id, relation_status) VALUES (?,?,'verified') ON CONFLICT(document_id, model_id) DO UPDATE SET relation_status='verified'").run(id, mid);
    }
    audit({ entityType: 'document', entityId: id, operation: 'update', previous: prev, next: req.body, userId: req.user!.id, source: 'documentation_library' });
    res.json({ ok: true });
  }),
);

/** Create brand/model records (identity only — no technical values). */
docsRouter.post(
  '/models',
  requireSuperAdmin,
  ah(async (req, res) => {
    const brand = str(req.body.brand, 'brand', { required: true, max: 100 })!;
    const model = str(req.body.model, 'model', { required: true, max: 100 })!;
    const r = ensureBrandModel(getDb(), brand, model);
    audit({ entityType: 'model', entityId: r.modelId, operation: 'create', next: { brand, model }, userId: req.user!.id, source: 'admin' });
    res.status(201).json(r);
  }),
);

// ---------------- revisions: file, pages, images ----------------
function getRevision(id: number) {
  const r = getDb().prepare('SELECT r.*, d.title FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE r.id = ?').get(id) as any;
  if (!r) throw notFound('Document revision not found');
  return r;
}
function revisionFile(r: any) {
  const abs = path.resolve(config.root, r.source_rel_path);
  const base = path.resolve(config.root);
  if (!abs.startsWith(base)) throw new HttpError(400, 'Invalid stored path');
  if (!fs.existsSync(abs)) throw new HttpError(410, 'Original document file is missing from disk (Missing source document). Re-import or restore the file.');
  return abs;
}

docsRouter.get(
  '/revisions/:id',
  ah(async (req, res) => {
    const r = getRevision(intParam(req.params.id, 'id', { required: true })!);
    const pages = getDb().prepare('SELECT page_index, printed_page, text_source, char_count, ocr_confidence FROM document_pages WHERE revision_id = ? ORDER BY page_index').all(r.id);
    res.json({ ...r, pages, fileExists: fs.existsSync(path.resolve(config.root, r.source_rel_path)) });
  }),
);

docsRouter.get(
  '/revisions/:id/file',
  ah(async (req, res) => {
    const r = getRevision(intParam(req.params.id, 'id', { required: true })!);
    const abs = revisionFile(r);
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.original_filename)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(abs);
  }),
);

docsRouter.get(
  '/revisions/:id/pages/:page',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const page = intParam(req.params.page, 'page', { required: true, min: 1 })!;
    const r = getRevision(id);
    const p = db.prepare('SELECT * FROM document_pages WHERE revision_id = ? AND page_index = ?').get(id, page) as any;
    if (!p) throw notFound(`Page ${page} does not exist in this document (1-${r.page_count})`);
    const refs = db
      .prepare(
        `SELECT s.id, s.section, s.table_ref, s.extracted_text, s.quote_match, s.printed_page, e.entity_type, e.entity_id, e.role
         FROM source_references s JOIN evidence_records e ON e.source_reference_id = s.id WHERE s.revision_id = ? AND s.page_index = ?`,
      )
      .all(id, page)
      .map((x: any) => ({ ...x, entity: undefined }));
    res.json({ revision: { id: r.id, title: r.title, document_id: r.document_id, page_count: r.page_count, file_format: r.file_format, revision_label: r.revision_label, original_filename: r.original_filename }, page: p, references: refs });
  }),
);

const renderQueue: Promise<unknown>[] = [];
docsRouter.get(
  '/revisions/:id/pages/:page/image',
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const page = intParam(req.params.page, 'page', { required: true, min: 1 })!;
    const scale = Math.min(Math.max(Number(req.query.scale) || 1.5, 0.5), 3);
    const r = getRevision(id);
    const abs = revisionFile(r);
    if (r.file_format !== 'pdf') {
      if (page !== 1) throw notFound();
      res.setHeader('Content-Type', r.mime);
      return res.sendFile(abs);
    }
    if (page > r.page_count) throw notFound();
    // serialize renders: pdf.js rendering is CPU/memory heavy
    const prev = renderQueue[renderQueue.length - 1] ?? Promise.resolve();
    const job = prev.catch(() => {}).then(() => renderPdfPage(abs, page, Math.round(scale * 4) / 4, `sha-${r.sha256.slice(0, 16)}`));
    renderQueue.push(job);
    try {
      const file = (await job) as string;
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type('png').sendFile(file);
    } finally {
      renderQueue.splice(renderQueue.indexOf(job), 1);
    }
  }),
);

/** Text runs with their position on the page (fractions of the page size): drives the selectable text layer over the page image. */
docsRouter.get(
  '/revisions/:id/pages/:page/words',
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const page = intParam(req.params.page, 'page', { required: true, min: 1 })!;
    const r = getRevision(id);
    if (r.file_format !== 'pdf' || page > r.page_count) return res.json({ width: 0, height: 0, items: [] });
    const words = await pdfPageWords(revisionFile(r), page, `sha-${r.sha256.slice(0, 16)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.json(words);
  }),
);

docsRouter.get(
  '/revisions/:id/search',
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const fts = q.split(/\s+/).map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
    try {
      res.json(
        getDb()
          .prepare(
            `SELECT pg.page_index, pg.printed_page, snippet(document_pages_fts, 0, '[[', ']]', ' … ', 16) snippet
             FROM document_pages_fts JOIN document_pages pg ON pg.id=document_pages_fts.rowid WHERE pg.revision_id = ? AND document_pages_fts MATCH ? ORDER BY pg.page_index LIMIT 200`,
          )
          .all(id, fts),
      );
    } catch {
      res.json([]);
    }
  }),
);

// ---------------- import workflow (Super Admin) ----------------
type JobState = { log: string[]; done: boolean };
const jobLogs = new Map<number, JobState>();
let chain: Promise<unknown> = Promise.resolve();

export function startImportJob(input: { path: string; dryRun: boolean; ocr: boolean; userId: number }): Promise<number> {
  return new Promise((resolveId) => {
    const svc = new DocumentIngestionService();
    const state: JobState = { log: [], done: false };
    // Jobs run one at a time (PDF parsing/OCR is heavy); the job id is returned as soon as the job row exists.
    chain = chain
      .catch(() => {})
      .then(() =>
        svc.ingest({
          path: input.path,
          dryRun: input.dryRun,
          ocr: input.ocr,
          userId: input.userId,
          onJobCreated: (id) => {
            jobLogs.set(id, state);
            resolveId(id);
          },
          onProgress: (m) => {
            state.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
            if (state.log.length > 500) state.log.shift();
          },
        }),
      )
      .then(() => {
        state.done = true;
      });
  });
}

docsRouter.get(
  '/manuals/scan',
  requireSuperAdmin,
  ah(async (_req, res) => {
    const db = getDb();
    const out: any[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(pdf|jpe?g|png|webp)$/i.test(e.name)) {
          const rel = path.relative(config.root, p).replace(/\\/g, '/');
          const st = fs.statSync(p);
          const rev = db.prepare('SELECT id, document_id, sha256 FROM document_revisions WHERE source_rel_path = ?').get(rel) as any;
          out.push({ path: rel, folder: path.relative(config.manualsDir, dir).replace(/\\/g, '/') || '.', size: st.size, modified: st.mtime.toISOString(), imported: !!rev, revisionId: rev?.id ?? null, documentId: rev?.document_id ?? null });
        }
      }
    };
    walk(config.manualsDir);
    const folders = fs.existsSync(config.manualsDir) ? fs.readdirSync(config.manualsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
    res.json({ files: out, folders, curated: listCuratedFiles() });
  }),
);

docsRouter.post(
  '/imports',
  requireSuperAdmin,
  ah(async (req, res) => {
    const p = str(req.body.path, 'path', { required: true, max: 500 })!;
    const id = await startImportJob({ path: p, dryRun: !!req.body.dryRun, ocr: req.body.ocr !== false, userId: req.user!.id });
    res.status(202).json({ importJobId: id });
  }),
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024, files: 1 } });
docsRouter.post(
  '/imports/upload',
  requireSuperAdmin,
  upload.single('file'),
  ah(async (req, res) => {
    const f = req.file;
    if (!f) throw badRequest('file is required');
    const sn = sniff(f.buffer);
    if (!sn) throw new HttpError(415, 'Unsupported document content (PDF, JPEG, PNG, WebP only)');
    const folder = slugify(String(req.body.folder || 'uploads')).replace(/-/g, '-');
    const rawFolder = String(req.body.folder || '').trim();
    const folderName = /^[A-Za-z0-9 _.-]{1,60}$/.test(rawFolder) && !rawFolder.includes('..') ? rawFolder : folder;
    const dir = path.join(config.manualsDir, folderName);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(f.originalname).replace(/[^A-Za-z0-9 _.()-]+/g, '_').slice(0, 150) || `upload.${sn.ext}`;
    let target = path.join(dir, base.toLowerCase().endsWith(`.${sn.ext}`) || (sn.ext === 'jpg' && /\.jpe?g$/i.test(base)) ? base : `${base}.${sn.ext}`);
    // never overwrite an existing file
    if (fs.existsSync(target)) {
      if (sha256(fs.readFileSync(target)) === sha256(f.buffer)) throw new HttpError(409, 'This exact file already exists in the manuals directory');
      const ext = path.extname(target);
      target = target.slice(0, -ext.length) + `-${Date.now()}` + ext;
    }
    fs.writeFileSync(target, f.buffer, { flag: 'wx' });
    const rel = path.relative(config.root, target).replace(/\\/g, '/');
    const id = await startImportJob({ path: rel, dryRun: false, ocr: req.body.ocr !== 'false', userId: req.user!.id });
    res.status(202).json({ importJobId: id, path: rel });
  }),
);

docsRouter.get(
  '/imports',
  requireSuperAdmin,
  ah(async (_req, res) => {
    res.json(getDb().prepare('SELECT id, file_path, dry_run, status, started_at, finished_at, error, backup_id FROM document_import_jobs ORDER BY id DESC LIMIT 200').all());
  }),
);

docsRouter.get(
  '/imports/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const j = getDb().prepare('SELECT * FROM document_import_jobs WHERE id = ?').get(id) as any;
    if (!j) throw notFound();
    res.json({ ...j, result: parseJson(j.result_json, null), result_json: undefined, log: jobLogs.get(id)?.log ?? [] });
  }),
);

docsRouter.post(
  '/revisions/:id/reprocess-ocr',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const r = await new DocumentIngestionService().reprocessOcr(id);
    audit({ entityType: 'document_revision', entityId: id, operation: 'reprocess_ocr', next: r, userId: req.user!.id, source: 'documentation_library' });
    res.json(r);
  }),
);

/** OCR correction: Super Admin can correct OCR text of a page; the previous text is kept in the audit log. */
docsRouter.patch(
  '/revisions/:id/pages/:page/text',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const page = intParam(req.params.page, 'page', { required: true })!;
    const p = db.prepare('SELECT * FROM document_pages WHERE revision_id = ? AND page_index = ?').get(id, page) as any;
    if (!p) throw notFound();
    if (p.text_source === 'pdf-text') throw badRequest('This page has an original PDF text layer; it cannot be edited.');
    const text = str(req.body.text, 'text', { required: true, max: 200000 })!;
    db.prepare("UPDATE document_pages SET text = ?, text_source = 'ocr', char_count = ? WHERE id = ?").run(text, text.length, p.id);
    audit({ entityType: 'document_page', entityId: p.id, operation: 'ocr_correction', previous: { text: p.text }, next: { text }, userId: req.user!.id, source: 'ocr_review' });
    res.json({ ok: true });
  }),
);

// ---------------- staged records review ----------------
docsRouter.get(
  '/staged',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const q = req.query as any;
    const where: string[] = ['1=1'];
    const args: unknown[] = [];
    if (q.status) (where.push('s.status = ?'), args.push(String(q.status)));
    if (q.job) (where.push('s.import_job_id = ?'), args.push(Number(q.job)));
    if (q.comparison) (where.push('s.comparison = ?'), args.push(String(q.comparison)));
    if (q.type) (where.push('s.record_type = ?'), args.push(String(q.type)));
    if (q.quote) (where.push('s.quote_match = ?'), args.push(String(q.quote)));
    if (q.revision) (where.push('s.revision_id = ?'), args.push(Number(q.revision)));
    const limit = Math.min(Number(q.limit) || 200, 1000);
    const offset = Math.max(0, (Number(q.page) || 1) - 1) * limit;
    const total = (db.prepare(`SELECT COUNT(*) c FROM staged_records s WHERE ${where.join(' AND ')}`).get(...args) as any).c;
    const rows = db
      .prepare(
        `SELECT s.*, r.original_filename, r.document_id FROM staged_records s LEFT JOIN document_revisions r ON r.id=s.revision_id
         WHERE ${where.join(' AND ')} ORDER BY s.id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset)
      .map((s: any) => ({ ...s, payload: parseJson(s.payload_json, {}), comparison_detail: parseJson(s.comparison_detail_json, null), payload_json: undefined, comparison_detail_json: undefined }));
    const summary = db.prepare(`SELECT status, comparison, quote_match, COUNT(*) n FROM staged_records s WHERE ${q.job ? 's.import_job_id = ?' : '1=1'} GROUP BY 1,2,3`).all(...(q.job ? [Number(q.job)] : []));
    res.json({ total, rows, summary });
  }),
);

docsRouter.post(
  '/staged/:id/approve',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const mode = oneOf(req.body.mode, 'mode', ['auto', 'create_new', 'attach'] as const, 'auto');
    res.json(approveStaged(id, req.user!.id, { mode, note: str(req.body.note, 'note', { max: 2000 }) }));
  }),
);
docsRouter.post(
  '/staged/:id/reject',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    res.json(rejectStaged(id, req.user!.id, str(req.body.note, 'note', { max: 2000 })));
  }),
);
/** Bulk approval only applies the automatic rules; records needing an explicit decision are reported, not forced. */
docsRouter.post(
  '/staged/bulk',
  requireSuperAdmin,
  ah(async (req, res) => {
    const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 2000) : [];
    const action = oneOf(req.body.action, 'action', ['approve', 'reject'] as const);
    const results: any[] = [];
    for (const id of ids) {
      try {
        results.push(action === 'approve' ? approveStaged(id, req.user!.id, { mode: 'auto' }) : rejectStaged(id, req.user!.id, str(req.body.note, 'note')));
      } catch (e) {
        results.push({ stagedId: id, error: (e as Error).message });
      }
    }
    res.json({ processed: results.length, failed: results.filter((r) => r.error).length, results });
  }),
);

/** Manual record entry from a document page. Quote is checked against the page text; record goes to staging. */
docsRouter.post(
  '/staged/manual',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const revisionId = intParam(req.body.revision_id, 'revision_id', { required: true })!;
    const type = oneOf(req.body.record_type, 'record_type', ['parameter', 'modbus_register'] as const);
    const modelId = intParam(req.body.model_id, 'model_id', { required: true })!;
    const rec = req.body.record ?? {};
    if (typeof rec !== 'object') throw badRequest('record must be an object');
    if (type === 'parameter' && !rec.code) throw badRequest('record.code is required');
    if (type === 'modbus_register' && (!rec.original_address || !rec.name)) throw badRequest('record.original_address and record.name are required');
    const model = db.prepare('SELECT m.name, b.name brand FROM models m JOIN brands b ON b.id=m.brand_id WHERE m.id = ?').get(modelId) as any;
    if (!model) throw badRequest('Unknown model');
    getRevision(revisionId);
    const page = rec.page_index ? (db.prepare('SELECT text FROM document_pages WHERE revision_id = ? AND page_index = ?').get(revisionId, rec.page_index) as any) : null;
    const qm = matchQuote(page?.text, rec.evidence_quote);
    const cf = rec.common_function ? (db.prepare('SELECT id FROM common_functions WHERE slug = ?').get(rec.common_function) as any) : null;
    const { compareRecord } = await import('../services/ingestion/DocumentIngestionService.js');
    const cmp = compareRecord(db, type, modelId, rec, cf?.id ?? null);
    const jobId = Number(db.prepare("INSERT INTO document_import_jobs(file_path, status, created_by_user_id, finished_at) VALUES (?, 'completed', ?, ?)").run(`manual-entry:revision-${revisionId}`, req.user!.id, new Date().toISOString()).lastInsertRowid);
    const id = Number(
      db
        .prepare('INSERT INTO staged_records(import_job_id, revision_id, record_type, payload_json, comparison, comparison_detail_json, matched_entity_id, quote_match) VALUES (?,?,?,?,?,?,?,?)')
        .run(jobId, revisionId, type, JSON.stringify({ ...rec, _brand: model.brand, _model: model.name, _model_id: modelId, _common_function_id: cf?.id ?? null, _extraction_method: 'manual-entry' }), cmp.comparison, JSON.stringify(cmp.detail), cmp.matchedId, qm).lastInsertRowid,
    );
    res.status(201).json({ stagedId: id, quoteMatch: qm, comparison: cmp.comparison });
  }),
);

// ---------------- verification tasks ----------------
docsRouter.get(
  '/verification/tasks',
  requireSuperAdmin,
  ah(async (req, res) => {
    const status = (req.query.status as string) || 'open';
    res.json(
      getDb()
        .prepare('SELECT * FROM verification_tasks WHERE status = ? ORDER BY id DESC LIMIT 500')
        .all(status)
        .map((t: any) => ({ ...t, details: parseJson(t.details_json, null), details_json: undefined })),
    );
  }),
);
docsRouter.patch(
  '/verification/tasks/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const status = oneOf(req.body.status, 'status', ['open', 'resolved', 'dismissed'] as const);
    getDb()
      .prepare('UPDATE verification_tasks SET status = ?, resolution_note = ?, resolved_by_user_id = ?, resolved_at = ? WHERE id = ?')
      .run(status, str(req.body.note, 'note', { max: 2000 }), req.user!.id, status === 'open' ? null : new Date().toISOString(), id);
    res.json({ ok: true });
  }),
);

export { storagePaths };
