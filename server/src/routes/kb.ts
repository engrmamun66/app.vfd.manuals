import { Router } from 'express';
import { assertFeature } from '../services/premium.js';
import { buildMatcher, rankRows } from '../services/search.js';
import { getDb } from '../db/index.js';
import { ah, badRequest, intParam, notFound, oneOf, paging, str } from '../lib/http.js';
import { parseJson } from '../lib/util.js';
import { requireSuperAdmin } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { cdJoin, cdOrder, cdVisible, includeHidden } from '../services/visibility.js';
import { setVerification } from '../services/review.js';

export const kbRouter = Router();

const VERIF = ['Verified', 'Unverified', 'Requires Manual Verification', 'Documentation Conflict', 'Rejected'] as const;

// ---------------- dashboard ----------------
kbRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const db = getDb();
    const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;
    res.json({
      totals: {
        brands: one('SELECT COUNT(*) c FROM brands'),
        models: one('SELECT COUNT(*) c FROM models'),
        documents: one('SELECT COUNT(*) c FROM documents'),
        revisions: one('SELECT COUNT(*) c FROM document_revisions'),
        pages: one('SELECT COUNT(*) c FROM document_pages'),
        parameters: one('SELECT COUNT(*) c FROM parameters WHERE is_demo = 0'),
        verifiedParameters: one("SELECT COUNT(*) c FROM parameters WHERE verification_status = 'Verified' AND is_demo = 0"),
        modbusRegisters: one('SELECT COUNT(*) c FROM modbus_registers WHERE is_demo = 0'),
        verifiedRegisters: one("SELECT COUNT(*) c FROM modbus_registers WHERE verification_status = 'Verified' AND is_demo = 0"),
        pendingStaged: one("SELECT COUNT(*) c FROM staged_records WHERE status = 'pending'"),
        openTasks: one("SELECT COUNT(*) c FROM verification_tasks WHERE status = 'open'"),
        conflicts: one("SELECT (SELECT COUNT(*) FROM parameters WHERE verification_status='Documentation Conflict') + (SELECT COUNT(*) FROM modbus_registers WHERE verification_status='Documentation Conflict') c"),
      },
      verificationBreakdown: db
        .prepare("SELECT 'parameter' t, verification_status s, COUNT(*) n FROM parameters GROUP BY 2 UNION ALL SELECT 'register', verification_status, COUNT(*) FROM modbus_registers GROUP BY 2")
        .all(),
      // pages of each manual (latest revision of each document)
      manuals: db
        .prepare(
          `SELECT d.id, d.title, b.name brand, r.page_count pages
           FROM documents d LEFT JOIN brands b ON b.id=d.brand_id
           JOIN document_revisions r ON r.id = (SELECT MAX(id) FROM document_revisions WHERE document_id=d.id)
           ORDER BY b.name, d.title`,
        )
        .all(),
      recentImports: db.prepare('SELECT id, file_path, status, dry_run, started_at, finished_at FROM document_import_jobs ORDER BY id DESC LIMIT 8').all(),
      recentlyUpdated: db
        .prepare(
          `SELECT * FROM (
             SELECT 'parameter' AS type, p.id AS id, p.code AS label, p.name AS name, m.name AS model, b.name AS brand, p.verification_status AS verification_status, p.updated_at AS updated_at FROM parameters p JOIN models m ON m.id=p.model_id JOIN brands b ON b.id=m.brand_id
             UNION ALL
             SELECT 'modbus_register', r.id, r.original_address, r.name, m.name, b.name, r.verification_status, r.updated_at FROM modbus_registers r JOIN models m ON m.id=r.model_id JOIN brands b ON b.id=m.brand_id
           ) ORDER BY updated_at DESC LIMIT 10`,
        )
        .all(),
      models: db
        .prepare(
          `SELECT m.id, m.name, b.name brand, b.slug brand_slug, m.slug,
             (SELECT COUNT(*) FROM parameters p WHERE p.model_id=m.id) params,
             (SELECT COUNT(*) FROM modbus_registers r WHERE r.model_id=m.id) registers
           FROM models m JOIN brands b ON b.id=m.brand_id ${cdJoin('model', 'm', 'cd')}
           WHERE ${cdVisible('cd', 'dashboard')} ORDER BY ${cdOrder('cd')}, b.name, m.name`,
        )
        .all(),
      featured: db
        .prepare("SELECT entity_type, entity_id FROM content_display WHERE featured = 1 AND visible = 1 ORDER BY display_order LIMIT 20")
        .all(),
    });
  }),
);

// ---------------- taxonomy ----------------
kbRouter.get(
  '/taxonomy',
  ah(async (req, res) => {
    const db = getDb();
    const all = includeHidden(req);
    const cats = db
      .prepare(
        `SELECT c.*, ${cdOrder('cd')} display_order, COALESCE(cd.visible,1) visible, COALESCE(cd.show_nav,1) show_nav FROM categories c ${cdJoin('category', 'c', 'cd')}
         ${all ? '' : `WHERE ${cdVisible('cd')}`} ORDER BY ${cdOrder('cd')}, c.name`,
      )
      .all() as any[];
    const fns = db
      .prepare(
        `SELECT f.*, ${cdOrder('cd')} display_order, COALESCE(cd.visible,1) visible,
           (SELECT COUNT(*) FROM parameters p WHERE p.common_function_id = f.id) param_count,
           (SELECT COUNT(*) FROM modbus_registers r WHERE r.common_function_id = f.id) register_count
         FROM common_functions f ${cdJoin('common_function', 'f', 'cd')}
         ${all ? '' : `WHERE ${cdVisible('cd')}`} ORDER BY ${cdOrder('cd')}, f.name`,
      )
      .all() as any[];
    res.json(cats.map((c) => ({ ...c, functions: fns.filter((f) => f.category_id === c.id) })));
  }),
);

kbRouter.post(
  '/categories',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const name = str(req.body.name, 'name', { required: true, max: 120 })!;
    const slug = str(req.body.slug, 'slug', { required: true, max: 80 })!;
    if (!/^[a-z0-9-]+$/.test(slug)) throw badRequest('slug must be lowercase letters, digits and dashes');
    const parent = intParam(req.body.parent_id, 'parent_id');
    const id = Number(db.prepare('INSERT INTO categories(slug, name, name_bn, description, parent_id) VALUES (?,?,?,?,?)').run(slug, name, str(req.body.name_bn, 'name_bn'), str(req.body.description, 'description'), parent).lastInsertRowid);
    audit({ entityType: 'category', entityId: id, operation: 'create', next: req.body, userId: req.user!.id, source: 'admin' });
    res.status(201).json({ id });
  }),
);

kbRouter.post(
  '/functions',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const name = str(req.body.name, 'name', { required: true, max: 160 })!;
    const slug = str(req.body.slug, 'slug', { required: true, max: 80 })!;
    if (!/^[a-z0-9-]+$/.test(slug)) throw badRequest('slug must be lowercase letters, digits and dashes');
    const cat = intParam(req.body.category_id, 'category_id', { required: true })!;
    const id = Number(
      db
        .prepare('INSERT INTO common_functions(category_id, slug, name, name_bn, short_description, short_description_bn) VALUES (?,?,?,?,?,?)')
        .run(cat, slug, name, str(req.body.name_bn, 'name_bn'), str(req.body.short_description, 'short_description', { max: 1000 }), str(req.body.short_description_bn, 'short_description_bn', { max: 1000 })).lastInsertRowid,
    );
    audit({ entityType: 'common_function', entityId: id, operation: 'create', next: req.body, userId: req.user!.id, source: 'admin' });
    res.status(201).json({ id });
  }),
);

// ---------------- brands / models ----------------
kbRouter.get(
  '/brands',
  ah(async (req, res) => {
    const all = includeHidden(req);
    res.json(
      getDb()
        .prepare(
          `SELECT b.*, ${cdOrder('cd')} display_order, COALESCE(cd.visible,1) visible,
             (SELECT COUNT(*) FROM models m WHERE m.brand_id=b.id) model_count
           FROM brands b ${cdJoin('brand', 'b', 'cd')} ${all ? '' : `WHERE ${cdVisible('cd')}`} ORDER BY ${cdOrder('cd')}, b.name`,
        )
        .all(),
    );
  }),
);

kbRouter.get(
  '/models',
  ah(async (req, res) => {
    const all = includeHidden(req);
    res.json(
      getDb()
        .prepare(
          `SELECT m.*, b.name brand, b.slug brand_slug, ${cdOrder('cd')} display_order, COALESCE(cd.visible,1) visible,
             (SELECT COUNT(*) FROM parameters p WHERE p.model_id=m.id) param_count,
             (SELECT COUNT(*) FROM modbus_registers r WHERE r.model_id=m.id) register_count
           FROM models m JOIN brands b ON b.id=m.brand_id ${cdJoin('model', 'm', 'cd')} ${cdJoin('brand', 'b', 'cdb')}
           ${all ? '' : `WHERE ${cdVisible('cd')} AND ${cdVisible('cdb')}`} ORDER BY ${cdOrder('cdb')}, b.name, ${cdOrder('cd')}, m.name`,
        )
        .all(),
    );
  }),
);

kbRouter.get(
  '/models/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true });
    const m = db.prepare('SELECT m.*, b.name brand, b.slug brand_slug FROM models m JOIN brands b ON b.id=m.brand_id WHERE m.id = ?').get(id) as any;
    if (!m) throw notFound('Model not found');
    const docs = db
      .prepare(
        `SELECT d.id, d.title, d.identification_status, dm.relation_status, r.id revision_id, r.original_filename, r.page_count, r.revision_label
         FROM document_models dm JOIN documents d ON d.id=dm.document_id LEFT JOIN document_revisions r ON r.document_id=d.id AND r.status='current'
         WHERE dm.model_id = ?`,
      )
      .all(id);
    const byCat = db
      .prepare(
        `SELECT c.id, c.slug, c.name, COUNT(p.id) n FROM parameters p LEFT JOIN categories c ON c.id=p.category_id WHERE p.model_id=? GROUP BY c.id ORDER BY c.id`,
      )
      .all(id);
    res.json({ ...m, documents: docs, categories: byCat });
  }),
);

kbRouter.patch(
  '/models/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true });
    const prev = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
    if (!prev) throw notFound();
    const status = req.body.identification_status ? oneOf(req.body.identification_status, 'identification_status', ['verified', 'needs_review', 'unverified']) : null;
    const desc = req.body.description !== undefined ? str(req.body.description, 'description', { max: 2000 }) : undefined;
    db.prepare('UPDATE models SET identification_status = COALESCE(?, identification_status), description = CASE WHEN ? THEN ? ELSE description END, updated_at = ? WHERE id = ?').run(
      status,
      desc !== undefined ? 1 : 0,
      desc ?? null,
      new Date().toISOString(),
      id,
    );
    audit({ entityType: 'model', entityId: id, operation: 'update', previous: prev, next: req.body, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);

// ---------------- parameters ----------------
function paramFilters(q: any, req: any) {
  const where: string[] = ['p.is_demo IN (0,1)'];
  const args: unknown[] = [];
  if (!includeHidden(req)) where.push(cdVisible('cdp'), cdVisible('cdm'), cdVisible('cdb'));
  if (q.brand) (where.push('b.slug = ?'), args.push(String(q.brand)));
  if (q.model) {
    const ids = String(q.model).split(',').map(Number).filter(Number.isInteger);
    if (ids.length) where.push(`p.model_id IN (${ids.map(() => '?').join(',')})`), args.push(...ids);
  }
  if (q.category) (where.push('(c.slug = ? OR EXISTS (SELECT 1 FROM category_parameters cp JOIN categories cx ON cx.id = cp.category_id WHERE cp.parameter_id = p.id AND cx.slug = ?))'), args.push(String(q.category), String(q.category)));
  if (q.ucat && req.user) {
    // personal category (only the owner's own categories can match)
    where.push('EXISTS (SELECT 1 FROM parameter_user_categories puc JOIN user_categories uc ON uc.id = puc.user_category_id WHERE puc.parameter_id = p.id AND uc.id = ? AND uc.user_id = ?)');
    args.push(Number(q.ucat) || 0, req.user.id);
  }
  if (q.function) (where.push('f.slug = ?'), args.push(String(q.function)));
  if (q.verification) (where.push('p.verification_status = ?'), args.push(String(q.verification)));
  if (q.evidence) (where.push('p.evidence_status = ?'), args.push(String(q.evidence)));
  if (q.access) (where.push('p.access_type LIKE ?'), args.push(`%${q.access}%`));
  if (q.importance) (where.push('p.importance = ?'), args.push(String(q.importance)));
  if (q.group) (where.push('p.param_group = ?'), args.push(String(q.group)));
  if (q.unmapped === '1') where.push('p.common_function_id IS NULL');
  if (q.q) {
    const like = `%${String(q.q).slice(0, 100)}%`;
    where.push('(p.code LIKE ? OR p.name LIKE ? OR p.description_en LIKE ? OR p.description_bn LIKE ? OR f.name LIKE ? OR f.name_bn LIKE ? OR m.name LIKE ? OR b.name LIKE ?)');
    args.push(like, like, like, like, like, like, like, like);
  }
  return { where: where.join(' AND '), args };
}
const PARAM_FROM = `FROM parameters p JOIN models m ON m.id=p.model_id JOIN brands b ON b.id=m.brand_id
  LEFT JOIN common_functions f ON f.id=p.common_function_id LEFT JOIN categories c ON c.id=p.category_id
  ${cdJoin('parameter', 'p', 'cdp')} ${cdJoin('model', 'm', 'cdm')} ${cdJoin('brand', 'b', 'cdb')}`;

kbRouter.get(
  '/parameters',
  ah(async (req, res) => {
    const db = getDb();
    const { limit, offset, page } = paging(req.query as any, 50, 500);
    const { where, args } = paramFilters(req.query, req);
    // "Basic Parameters": in every model the frequency source and the run-command source come first
    const basicFirst = req.query.category === 'basic-parameters' ? "CASE WHEN f.slug = 'frequency-source' AND ROW_NUMBER() OVER (PARTITION BY p.model_id, f.slug ORDER BY p.code) = 1 THEN 0 WHEN f.slug = 'command-source' AND ROW_NUMBER() OVER (PARTITION BY p.model_id, f.slug ORDER BY p.code) = 1 THEN 1 ELSE 2 END, " : '';
    const total = (db.prepare(`SELECT COUNT(*) c ${PARAM_FROM} WHERE ${where}`).get(...args) as { c: number }).c;
    const rows = db
      .prepare(
        `SELECT p.id, p.code, p.name, p.unit, p.default_value, p.min_value, p.max_value, p.access_type, p.verification_status, p.evidence_status, p.equivalence, p.is_demo, p.importance, p.param_group,
           m.id model_id, m.name model, b.name brand, b.slug brand_slug, f.slug function_slug, f.name function_name, f.name_bn function_name_bn, c.slug category_slug, c.name category,
           (SELECT json_object('revision_id', sr.revision_id, 'page', sr.page_index, 'quote', sr.extracted_text) FROM evidence_records e JOIN source_references sr ON sr.id=e.source_reference_id WHERE e.entity_type='parameter' AND e.entity_id=p.id ORDER BY CASE e.role WHEN 'original' THEN 0 ELSE 1 END, e.id LIMIT 1) manual_json
         ${PARAM_FROM} WHERE ${where} ORDER BY ${cdOrder('cdb')}, b.name, ${cdOrder('cdm')}, m.name, ${basicFirst}${cdOrder('cdp')}, CASE p.importance WHEN 'Important' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Optional' THEN 2 ELSE 3 END, p.code LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as any[];
    // the caller's own personal categories per row (never other users')
    const mine = new Map<number, number[]>();
    if (rows.length && req.user) {
      const ph = rows.map(() => '?').join(',');
      for (const m of db.prepare(`SELECT puc.parameter_id pid, puc.user_category_id cid FROM parameter_user_categories puc JOIN user_categories uc ON uc.id = puc.user_category_id WHERE uc.user_id = ? AND puc.parameter_id IN (${ph})`).all(req.user.id, ...rows.map((r) => r.id)) as any[])
        (mine.get(m.pid) ?? mine.set(m.pid, []).get(m.pid)!).push(m.cid);
    }
    res.json({ total, page, limit, rows: rows.map((r) => ({ ...r, manual: parseJson(r.manual_json, null), manual_json: undefined, my_category_ids: mine.get(r.id) ?? [] })) });
  }),
);

// ---------------- knowledge items (faults, warnings, troubleshooting, wiring, ...) ----------------
const KNOWLEDGE_KINDS = ['fault', 'alarm', 'warning', 'troubleshooting', 'wiring', 'installation', 'safety', 'specification', 'communication', 'maintenance', 'note'];
kbRouter.get(
  '/knowledge',
  ah(async (req, res) => {
    const db = getDb();
    const { limit, offset, page } = paging(req.query as any, 50, 500);
    const where: string[] = ['1=1'];
    const args: unknown[] = [];
    if (!includeHidden(req)) where.push(cdVisible('cdm'), cdVisible('cdb'));
    const ids = String(req.query.model ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) (where.push(`k.model_id IN (${ids.map(() => '?').join(',')})`), args.push(...ids));
    if (req.query.kind) {
      oneOf(String(req.query.kind), 'kind', KNOWLEDGE_KINDS);
      (where.push('k.kind = ?'), args.push(String(req.query.kind)));
    }
    if (req.query.verification) (where.push('k.verification_status = ?'), args.push(String(req.query.verification)));
    if (req.query.importance) (where.push('k.importance = ?'), args.push(String(req.query.importance)));
    if (req.query.q) {
      const like = `%${String(req.query.q).slice(0, 100)}%`;
      where.push('(k.code LIKE ? OR k.title LIKE ? OR k.description LIKE ? OR k.cause LIKE ? OR k.remedy LIKE ?)');
      args.push(like, like, like, like, like);
    }
    const from = `FROM knowledge_items k JOIN models m ON m.id=k.model_id JOIN brands b ON b.id=m.brand_id ${cdJoin('model', 'm', 'cdm')} ${cdJoin('brand', 'b', 'cdb')}`;
    const w = where.join(' AND ');
    const total = (db.prepare(`SELECT COUNT(*) c ${from} WHERE ${w}`).get(...args) as { c: number }).c;
    // per-kind counts ignore the kind filter so the tabs always show what exists
    const kindArgs: unknown[] = [];
    const kw: string[] = ['1=1'];
    if (!includeHidden(req)) kw.push(cdVisible('cdm'), cdVisible('cdb'));
    if (ids.length) (kw.push(`k.model_id IN (${ids.map(() => '?').join(',')})`), kindArgs.push(...ids));
    const kinds = db.prepare(`SELECT k.kind, COUNT(*) n ${from} WHERE ${kw.join(' AND ')} GROUP BY k.kind`).all(...kindArgs);
    const rows = db
      .prepare(
        `SELECT k.id, k.kind, k.code, k.title, k.description, k.cause, k.remedy, k.details_json, k.section, k.page_index, k.printed_page, k.revision_id, k.importance, k.evidence_quote,
           k.evidence_status, k.verification_status, m.id model_id, m.name model, b.name brand
         ${from} WHERE ${w} ORDER BY b.name, m.name, k.kind, CASE k.importance WHEN 'Important' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Optional' THEN 2 ELSE 3 END, k.code, k.title LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset)
      .map((r: any) => ({ ...r, details: parseJson(r.details_json, null), details_json: undefined })) as any[];
    // every manual page of each topic (primary first), so the UI can show the raw page images
    const pagesBy = new Map<number, any[]>();
    if (rows.length) {
      const ph = rows.map(() => '?').join(',');
      for (const p of db.prepare(`SELECT item_id, revision_id, page_index, printed_page, role FROM knowledge_item_pages WHERE item_id IN (${ph}) ORDER BY item_id, role = 'related', page_index`).all(...rows.map((r) => r.id)) as any[])
        (pagesBy.get(p.item_id) ?? pagesBy.set(p.item_id, []).get(p.item_id)!).push(p);
    }
    res.json({ total, page, limit, rows: rows.map((r) => ({ ...r, pages: pagesBy.get(r.id) ?? (r.page_index ? [{ revision_id: r.revision_id, page_index: r.page_index, printed_page: r.printed_page, role: 'primary' }] : []) })), kinds });
  }),
);

export function loadEvidence(entityType: string, id: number) {
  return getDb()
    .prepare(
      `SELECT e.id, e.role, e.evidence_status, e.value_snapshot_json, e.import_job_id, e.created_at,
         s.id source_reference_id, s.page_index, s.printed_page, s.page_verified, s.section, s.table_ref, s.figure_ref, s.extracted_text, s.quote_match,
         r.id revision_id, r.revision_label, r.original_filename, r.file_format, r.source_rel_path, d.id document_id, d.title document_title,
         pg.id page_id, pg.text_source
       FROM evidence_records e JOIN source_references s ON s.id=e.source_reference_id
       JOIN document_revisions r ON r.id=s.revision_id JOIN documents d ON d.id=r.document_id
       LEFT JOIN document_pages pg ON pg.id=s.page_id
       WHERE e.entity_type = ? AND e.entity_id = ? ORDER BY CASE e.role WHEN 'original' THEN 0 WHEN 'current' THEN 1 WHEN 'supporting' THEN 2 WHEN 'conflicting' THEN 3 ELSE 4 END, e.id`,
    )
    .all(entityType, id)
    .map((e: any) => ({ ...e, value_snapshot: parseJson(e.value_snapshot_json, null), value_snapshot_json: undefined }));
}

export function loadRelationships(type: string, id: number) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM entity_relationships WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?) ORDER BY relation_kind`,
    )
    .all(type, id, type, id) as any[];
  return rows.map((r) => {
    const outgoing = r.from_type === type && r.from_id === id;
    const ot = outgoing ? r.to_type : r.from_type;
    const oi = outgoing ? r.to_id : r.from_id;
    return { ...r, direction: outgoing ? 'out' : 'in', other: describeEntity(ot, oi) };
  });
}

export function describeEntity(type: string, id: number): any {
  const db = getDb();
  if (type === 'parameter')
    return db.prepare('SELECT p.id, p.code label, p.name, m.name model, b.name brand, \'parameter\' type FROM parameters p JOIN models m ON m.id=p.model_id JOIN brands b ON b.id=m.brand_id WHERE p.id=?').get(id) ?? { type, id, missing: true };
  if (type === 'modbus_register')
    return db.prepare('SELECT r.id, r.original_address label, r.name, m.name model, b.name brand, \'modbus_register\' type FROM modbus_registers r JOIN models m ON m.id=r.model_id JOIN brands b ON b.id=m.brand_id WHERE r.id=?').get(id) ?? { type, id, missing: true };
  if (type === 'common_function') return db.prepare("SELECT id, slug, name label, name, 'common_function' type FROM common_functions WHERE id=?").get(id) ?? { type, id, missing: true };
  return { type, id };
}

kbRouter.get(
  '/parameters/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const p = db
      .prepare(
        `SELECT p.*, m.name model, m.slug model_slug, b.id brand_id, b.name brand, b.slug brand_slug, f.slug function_slug, f.name function_name, f.name_bn function_name_bn,
           f.short_description function_short, c.slug category_slug, c.name category, c.name_bn category_bn,
           COALESCE(cdp.visible,1) visible
         ${PARAM_FROM} WHERE p.id = ?`,
      )
      .get(id) as any;
    if (!p) throw notFound('Parameter not found (it may have been removed). The bookmark target is unavailable.');
    if (!p.visible && !includeHidden(req) && req.user?.role !== 'super_admin') throw notFound('Parameter not found');
    const siblings = p.common_function_id
      ? db
          .prepare(
            `SELECT p2.id, p2.code, p2.name, p2.equivalence, m.id model_id, m.name model, b.name brand FROM parameters p2 JOIN models m ON m.id=p2.model_id JOIN brands b ON b.id=m.brand_id
             WHERE p2.common_function_id = ? AND p2.id != ? ORDER BY b.name, m.name`,
          )
          .all(p.common_function_id, id)
      : [];
    const sameModelSameFn = siblings.filter((s: any) => s.model === p.model);
    res.json({
      ...p,
      options: parseJson(p.options_json, null),
      evidence: loadEvidence('parameter', id),
      relationships: loadRelationships('parameter', id),
      explanations: db.prepare("SELECT * FROM technical_explanations WHERE entity_type = 'parameter' AND entity_id = ? ORDER BY level, language, version DESC").all(id),
      otherBrandImplementations: siblings,
      sameModelSameFunction: sameModelSameFn,
      registers: db
        .prepare('SELECT id, original_address, name, access FROM modbus_registers WHERE model_id = ? AND common_function_id IS ? AND common_function_id IS NOT NULL')
        .all(p.model_id, p.common_function_id),
      verificationHistory: db.prepare("SELECT * FROM verification_records WHERE entity_type = 'parameter' AND entity_id = ? ORDER BY id DESC LIMIT 50").all(id),
    });
  }),
);

kbRouter.patch(
  '/parameters/:id/verification',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    setVerification('parameter', id, oneOf(req.body.status, 'status', VERIF), req.user!.id, str(req.body.note, 'note', { max: 2000 }));
    res.json({ ok: true });
  }),
);

/** Editable non-value metadata (Bangla description, explanation). Technical values are changed only via import review. */
kbRouter.patch(
  '/parameters/:id',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const prev = db.prepare('SELECT * FROM parameters WHERE id = ?').get(id) as any;
    if (!prev) throw notFound();
    const allowed = ['description_bn', 'technical_explanation', 'common_function_id', 'equivalence', 'equivalence_note'] as const;
    const changes: Record<string, unknown> = {};
    for (const k of allowed) if (k in req.body) changes[k] = req.body[k] === '' ? null : req.body[k];
    if ('equivalence' in changes && changes.equivalence !== null)
      oneOf(changes.equivalence, 'equivalence', ['Exact Equivalent', 'Functionally Similar', 'Partially Equivalent', 'Not Equivalent', 'Insufficient Documentation']);
    if ('common_function_id' in changes && changes.common_function_id !== null) {
      const cf = db.prepare('SELECT category_id FROM common_functions WHERE id = ?').get(Number(changes.common_function_id)) as any;
      if (!cf) throw badRequest('Unknown common function');
      changes.category_id = cf.category_id;
    }
    if (!Object.keys(changes).length) throw badRequest('No editable fields supplied');
    db.prepare(`UPDATE parameters SET ${Object.keys(changes).map((k) => `${k} = ?`).join(', ')}, updated_at = ?, updated_by_user_id = ? WHERE id = ?`).run(
      ...Object.values(changes),
      new Date().toISOString(),
      req.user!.id,
      id,
    );
    audit({ entityType: 'parameter', entityId: id, operation: 'update_metadata', previous: Object.fromEntries(Object.keys(changes).map((k) => [k, prev[k]])), next: changes, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);

// ---------------- common function (all brand implementations) ----------------
kbRouter.get(
  '/functions/:slug',
  ah(async (req, res) => {
    const db = getDb();
    const f = db
      .prepare('SELECT f.*, c.slug category_slug, c.name category, c.name_bn category_bn FROM common_functions f JOIN categories c ON c.id=f.category_id WHERE f.slug = ?')
      .get(req.params.slug) as any;
    if (!f) throw notFound('Common function not found');
    const hidden = includeHidden(req);
    const params = db
      .prepare(
        `SELECT p.id, p.code, p.name, p.unit, p.default_value, p.min_value, p.max_value, p.resolution, p.equivalence, p.equivalence_note, p.verification_status, p.evidence_status,
           m.id model_id, m.name model, b.name brand, b.slug brand_slug,
           (SELECT COUNT(*) FROM evidence_records e WHERE e.entity_type='parameter' AND e.entity_id=p.id) evidence_count
         ${PARAM_FROM} WHERE p.common_function_id = ? ${hidden ? '' : `AND ${cdVisible('cdp')} AND ${cdVisible('cdm')} AND ${cdVisible('cdb')}`}
         ORDER BY ${cdOrder('cdb')}, b.name, m.name, p.code`,
      )
      .all(f.id);
    const regs = db
      .prepare(
        `SELECT r.id, r.original_address, r.address_format, r.name, r.access, r.scaling, r.unit, r.verification_status, m.id model_id, m.name model, b.name brand
         FROM modbus_registers r JOIN models m ON m.id=r.model_id JOIN brands b ON b.id=m.brand_id WHERE r.common_function_id = ? ORDER BY b.name, m.name`,
      )
      .all(f.id);
    const models = db.prepare('SELECT m.id, m.name, b.name brand FROM models m JOIN brands b ON b.id=m.brand_id ORDER BY b.name, m.name').all();
    res.json({
      ...f,
      parameters: params,
      registers: regs,
      modelsWithoutRecord: (models as any[]).filter((m) => !(params as any[]).some((p) => p.model_id === m.id) && !(regs as any[]).some((r) => r.model_id === m.id)),
      relationships: loadRelationships('common_function', f.id),
      explanations: db.prepare("SELECT * FROM technical_explanations WHERE entity_type = 'common_function' AND entity_id = ? AND is_current = 1").all(f.id),
    });
  }),
);

// ---------------- modbus registers ----------------
const REG_FROM = `FROM modbus_registers r JOIN models m ON m.id=r.model_id JOIN brands b ON b.id=m.brand_id LEFT JOIN common_functions f ON f.id=r.common_function_id
  ${cdJoin('modbus_register', 'r', 'cdr')} ${cdJoin('model', 'm', 'cdm')} ${cdJoin('brand', 'b', 'cdb')}`;

kbRouter.get(
  '/registers',
  ah(async (req, res) => {
    const db = getDb();
    const q = req.query as any;
    const { limit, offset, page } = paging(q, 100, 1000);
    const where: string[] = ['1=1'];
    const args: unknown[] = [];
    if (!includeHidden(req)) where.push(cdVisible('cdr'), cdVisible('cdm'), cdVisible('cdb'));
    if (q.brand) (where.push('b.slug = ?'), args.push(String(q.brand)));
    if (q.model) {
      const ids = String(q.model).split(',').map(Number).filter(Number.isInteger);
      if (ids.length) where.push(`r.model_id IN (${ids.map(() => '?').join(',')})`), args.push(...ids);
    }
    if (q.function) (where.push('f.slug = ?'), args.push(String(q.function)));
    if (q.access) (where.push('r.access LIKE ?'), args.push(`%${q.access}%`));
    if (q.verification) (where.push('r.verification_status = ?'), args.push(String(q.verification)));
    if (q.q) {
      const raw = String(q.q).trim().slice(0, 60);
      const like = `%${raw}%`;
      // address search matches original text and stored conversions only — never invented addresses
      where.push(
        `(r.original_address LIKE ? OR r.name LIKE ? OR r.description LIKE ? OR f.name LIKE ? OR EXISTS (SELECT 1 FROM modbus_address_conversions mc WHERE mc.register_id = r.id AND mc.value LIKE ?))`,
      );
      args.push(like, like, like, like, like);
    }
    const total = (db.prepare(`SELECT COUNT(*) c ${REG_FROM} WHERE ${where.join(' AND ')}`).get(...args) as { c: number }).c;
    const rows = db
      .prepare(
        `SELECT r.id, r.name, r.original_address, r.address_format, r.register_type, r.function_codes, r.access, r.data_type, r.scaling, r.unit, r.verification_status, r.evidence_status,
           m.id model_id, m.name model, b.name brand, b.slug brand_slug, f.slug function_slug, f.name function_name,
           (SELECT json_group_array(json_object('representation', representation, 'value', value, 'method', method)) FROM modbus_address_conversions mc WHERE mc.register_id = r.id) conversions_json,
           (SELECT json_object('revision_id', sr.revision_id, 'page', sr.page_index, 'quote', sr.extracted_text) FROM evidence_records e JOIN source_references sr ON sr.id=e.source_reference_id WHERE e.entity_type='modbus_register' AND e.entity_id=r.id ORDER BY e.id LIMIT 1) manual_json
         ${REG_FROM} WHERE ${where.join(' AND ')} ORDER BY b.name, m.name, ${cdOrder('cdr')}, r.original_address LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset)
      .map((r: any) => ({ ...r, conversions: parseJson(r.conversions_json, []), conversions_json: undefined, manual: parseJson(r.manual_json, null), manual_json: undefined }));
    res.json({ total, page, limit, rows });
  }),
);

kbRouter.get(
  '/registers/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const r = db
      .prepare(
        `SELECT r.*, m.name model, b.id brand_id, b.name brand, b.slug brand_slug, f.slug function_slug, f.name function_name, f.short_description function_short
         ${REG_FROM} WHERE r.id = ?`,
      )
      .get(id) as any;
    if (!r) throw notFound('Register not found (it may have been removed). The bookmark target is unavailable.');
    res.json({
      ...r,
      bit_definitions: parseJson(r.bit_definitions_json, null),
      conversions: db.prepare('SELECT representation, value, method, is_mathematical_only FROM modbus_address_conversions WHERE register_id = ?').all(id),
      evidence: loadEvidence('modbus_register', id),
      relationships: loadRelationships('modbus_register', id),
      explanations: db.prepare("SELECT * FROM technical_explanations WHERE entity_type = 'modbus_register' AND entity_id = ? ORDER BY level, version DESC").all(id),
      sameModelRegisters: db.prepare('SELECT id, original_address, name FROM modbus_registers WHERE model_id = ? AND id != ? ORDER BY original_address LIMIT 100').all(r.model_id, id),
      otherBrandImplementations: r.common_function_id
        ? db
            .prepare('SELECT r2.id, r2.original_address, r2.name, m.id model_id, m.name model, b.name brand FROM modbus_registers r2 JOIN models m ON m.id=r2.model_id JOIN brands b ON b.id=m.brand_id WHERE r2.common_function_id = ? AND r2.id != ?')
            .all(r.common_function_id, id)
        : [],
      communicationParameters: db
        .prepare(
          `SELECT p.id, p.code, p.name, f.name function_name FROM parameters p JOIN common_functions f ON f.id=p.common_function_id JOIN categories c ON c.id=f.category_id
           WHERE p.model_id = ? AND c.slug = 'modbus-rs485' ORDER BY p.code`,
        )
        .all(r.model_id),
      verificationHistory: db.prepare("SELECT * FROM verification_records WHERE entity_type = 'modbus_register' AND entity_id = ? ORDER BY id DESC LIMIT 50").all(id),
    });
  }),
);

kbRouter.patch(
  '/registers/:id/verification',
  requireSuperAdmin,
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    setVerification('modbus_register', id, oneOf(req.body.status, 'status', VERIF), req.user!.id, str(req.body.note, 'note', { max: 2000 }));
    res.json({ ok: true });
  }),
);

// ---------------- relationships & explanations (Super Admin curated) ----------------
kbRouter.post(
  '/relationships',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const types = ['parameter', 'modbus_register', 'common_function'] as const;
    const from_type = oneOf(req.body.from_type, 'from_type', types);
    const to_type = oneOf(req.body.to_type, 'to_type', types);
    const from_id = intParam(req.body.from_id, 'from_id', { required: true })!;
    const to_id = intParam(req.body.to_id, 'to_id', { required: true })!;
    const kind = oneOf(req.body.relation_kind, 'relation_kind', ['documented_dependency', 'documented_relationship', 'related_function', 'research_suggestion']);
    const src = intParam(req.body.source_reference_id, 'source_reference_id');
    if ((kind === 'documented_dependency' || kind === 'documented_relationship') && !src)
      throw badRequest('Documented relationships require a source_reference_id (evidence). Use "research_suggestion" otherwise.');
    const id = Number(
      db
        .prepare('INSERT INTO entity_relationships(from_type, from_id, to_type, to_id, relation_kind, note, source_reference_id, created_by_user_id) VALUES (?,?,?,?,?,?,?,?)')
        .run(from_type, from_id, to_type, to_id, kind, str(req.body.note, 'note', { max: 2000 }), src, req.user!.id).lastInsertRowid,
    );
    audit({ entityType: 'relationship', entityId: id, operation: 'create', next: req.body, userId: req.user!.id, source: 'admin' });
    res.status(201).json({ id });
  }),
);

kbRouter.post(
  '/explanations',
  requireSuperAdmin,
  ah(async (req, res) => {
    const db = getDb();
    const entity_type = oneOf(req.body.entity_type, 'entity_type', ['parameter', 'modbus_register', 'common_function'] as const);
    const entity_id = intParam(req.body.entity_id, 'entity_id', { required: true })!;
    const level = oneOf(req.body.level, 'level', ['short', 'detailed', 'advanced', 'manufacturer'] as const);
    const language = oneOf(req.body.language, 'language', ['en', 'bn'] as const, 'en');
    const body = str(req.body.body, 'body', { required: true, max: 20000 })!;
    const src = intParam(req.body.source_reference_id, 'source_reference_id');
    const evidence = src ? 'Explicitly Documented' : 'Unverified';
    const id = db.transaction(() => {
      const prev = db.prepare('SELECT MAX(version) v FROM technical_explanations WHERE entity_type=? AND entity_id=? AND level=? AND language=?').get(entity_type, entity_id, level, language) as any;
      // keep history: previous versions stay, marked not-current (never deleted)
      db.prepare('UPDATE technical_explanations SET is_current = 0 WHERE entity_type=? AND entity_id=? AND level=? AND language=?').run(entity_type, entity_id, level, language);
      return Number(
        db
          .prepare('INSERT INTO technical_explanations(entity_type, entity_id, level, language, body, source_reference_id, evidence_status, version, created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(entity_type, entity_id, level, language, body, src, evidence, (prev?.v ?? 0) + 1, req.user!.id).lastInsertRowid,
      );
    })();
    audit({ entityType: 'explanation', entityId: id, operation: 'create_version', next: { entity_type, entity_id, level, language }, userId: req.user!.id, source: 'admin' });
    res.status(201).json({ id });
  }),
);

// ---------------- comparison ----------------
export function buildComparison(modelIds: number[], opts: { category?: string | null; fn?: string | null }) {
  const db = getDb();
  const models = modelIds.map((id) => db.prepare('SELECT m.id, m.name, b.name brand FROM models m JOIN brands b ON b.id=m.brand_id WHERE m.id = ?').get(id)).filter(Boolean) as any[];
  const fWhere: string[] = [];
  const fArgs: unknown[] = [];
  if (opts.category) (fWhere.push('c.slug = ?'), fArgs.push(opts.category));
  if (opts.fn) (fWhere.push('f.slug = ?'), fArgs.push(opts.fn));
  const functions = db
    .prepare(
      `SELECT f.id, f.slug, f.name, f.name_bn, f.short_description, c.slug category_slug, c.name category FROM common_functions f JOIN categories c ON c.id=f.category_id
       ${cdJoin('common_function', 'f', 'cdf')} ${cdJoin('category', 'c', 'cdc')}
       WHERE ${cdVisible('cdf')} AND ${cdVisible('cdc')} ${fWhere.length ? 'AND ' + fWhere.join(' AND ') : ''} ORDER BY ${cdOrder('cdc')}, ${cdOrder('cdf')}, f.name`,
    )
    .all(...fArgs) as any[];
  const ph = modelIds.map(() => '?').join(',') || 'NULL';
  const params = db
    .prepare(
      `SELECT p.id, p.model_id, p.common_function_id, p.code, p.name, p.unit, p.default_value, p.min_value, p.max_value, p.resolution, p.equivalence, p.equivalence_note,
         p.verification_status, p.evidence_status,
         (SELECT json_object('page_index', s.page_index, 'printed_page', s.printed_page, 'document', d.title, 'revision_id', s.revision_id, 'quote_match', s.quote_match)
            FROM evidence_records e JOIN source_references s ON s.id=e.source_reference_id JOIN document_revisions r ON r.id=s.revision_id JOIN documents d ON d.id=r.document_id
            WHERE e.entity_type='parameter' AND e.entity_id=p.id ORDER BY CASE e.role WHEN 'original' THEN 0 ELSE 1 END, e.id LIMIT 1) source_json
       FROM parameters p ${cdJoin('parameter', 'p', 'cdp')} WHERE ${cdVisible('cdp')} AND p.model_id IN (${ph}) AND p.common_function_id IS NOT NULL`,
    )
    .all(...modelIds) as any[];
  // secondary links: parameters that the manual ties to another common function
  const linked = db
    .prepare(
      `SELECT p.id, p.model_id, l.function_id common_function_id, p.code, p.name, p.unit, p.default_value, p.min_value, p.max_value, p.resolution,
         COALESCE(l.equivalence, p.equivalence) equivalence, l.note equivalence_note, p.verification_status, p.evidence_status, 1 linked,
         (SELECT json_object('page_index', s.page_index, 'printed_page', s.printed_page, 'document', d.title, 'revision_id', s.revision_id, 'quote_match', s.quote_match)
            FROM evidence_records e JOIN source_references s ON s.id=e.source_reference_id JOIN document_revisions r ON r.id=s.revision_id JOIN documents d ON d.id=r.document_id
            WHERE e.entity_type='parameter' AND e.entity_id=p.id ORDER BY CASE e.role WHEN 'original' THEN 0 ELSE 1 END, e.id LIMIT 1) source_json
       FROM parameter_function_links l JOIN parameters p ON p.id = l.parameter_id ${cdJoin('parameter', 'p', 'cdp')} WHERE ${cdVisible('cdp')} AND p.model_id IN (${ph})`,
    )
    .all(...modelIds) as any[];
  params.push(...linked);
  const regs = db
    .prepare(
      `SELECT r.id, r.model_id, r.common_function_id, r.original_address, r.address_format, r.name, r.access, r.scaling, r.unit, r.verification_status,
         (SELECT json_object('page_index', s.page_index, 'printed_page', s.printed_page, 'document', d.title, 'revision_id', s.revision_id, 'quote_match', s.quote_match)
            FROM evidence_records e JOIN source_references s ON s.id=e.source_reference_id JOIN document_revisions rv ON rv.id=s.revision_id JOIN documents d ON d.id=rv.document_id
            WHERE e.entity_type='modbus_register' AND e.entity_id=r.id ORDER BY e.id LIMIT 1) source_json
       FROM modbus_registers r ${cdJoin('modbus_register', 'r', 'cdr')} WHERE ${cdVisible('cdr')} AND r.model_id IN (${ph}) AND r.common_function_id IS NOT NULL`,
    )
    .all(...modelIds) as any[];
  const rows = functions
    .map((f) => {
      const cells: Record<number, any[]> = {};
      for (const m of models) {
        const ps = params.filter((p) => p.common_function_id === f.id && p.model_id === m.id).map((p) => ({ kind: 'parameter', ...p, source: parseJson(p.source_json, null), source_json: undefined }));
        const rs = regs.filter((r) => r.common_function_id === f.id && r.model_id === m.id).map((r) => ({ kind: 'modbus_register', ...r, source: parseJson(r.source_json, null), source_json: undefined }));
        cells[m.id] = [...ps, ...rs];
      }
      return { function: f, cells };
    })
    .filter((r) => !opts.category && !opts.fn ? Object.values(r.cells).some((c) => c.length) : true);
  return { models, rows };
}

kbRouter.get(
  '/compare',
  ah(async (req, res) => {
    const ids = String(req.query.models || '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 10);
    if (ids.length < 1) throw badRequest('Select at least one model (models=1,2,...)');
    const data = buildComparison(ids, { category: (req.query.category as string) || null, fn: (req.query.function as string) || null });
    if (req.query.format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Category', 'Common Function', ...data.models.flatMap((m) => [`${m.brand} ${m.name} — code/address`, `${m.brand} ${m.name} — value/range`, `${m.brand} ${m.name} — source`])];
      const lines = [header.map(esc).join(',')];
      for (const r of data.rows) {
        const cols = [r.function.category, r.function.name];
        for (const m of data.models) {
          const c = r.cells[m.id] ?? [];
          if (!c.length) cols.push('Not Documented', '', '');
          else {
            cols.push(c.map((x: any) => (x.kind === 'parameter' ? x.code : x.original_address)).join(' | '));
            cols.push(c.map((x: any) => (x.kind === 'parameter' ? [x.default_value && `default ${x.default_value}`, (x.min_value || x.max_value) && `${x.min_value ?? '?'}..${x.max_value ?? '?'}`, x.unit].filter(Boolean).join(' ') : `${x.access ?? ''} ${x.scaling ?? ''}`) + ` [${x.verification_status}]`).join(' | '));
            cols.push(c.map((x: any) => (x.source ? `${x.source.document} p.${x.source.page_index}${x.source.printed_page ? ` (printed ${x.source.printed_page})` : ''}` : 'No source')).join(' | '));
          }
        }
        lines.push(cols.map(esc).join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vfd-comparison.csv"');
      res.send('﻿' + lines.join('\r\n'));
      return;
    }
    if (req.query.format === 'json') res.setHeader('Content-Disposition', 'attachment; filename="vfd-comparison.json"');
    res.json(data);
  }),
);

// ---------------- global search ----------------
// Exact matches first; then forgiving matches (text copied from a page image rarely equals the stored text exactly).
kbRouter.get(
  '/search',
  ah(async (req, res) => {
    const db = getDb();
    const q = String(req.query.q || '').trim().slice(0, 300);
    if (!q) return res.json({ q, functions: [], parameters: [], registers: [], models: [], topics: [], pages: [] });
    assertFeature(req.user!, 'lock_search', 'Search is a Pro feature. Upgrade to search everything.');
    const like = `%${q.slice(0, 100)}%`;
    const hidden = includeHidden(req);
    // scope: "@model" chips in the search box send ?models=1,2,3 (several VFDs); the model tab filter sends ?model=1
    const ids = (String(req.query.models ?? '') || String(req.query.model ?? ''))
      .split(',')
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
    const MF = ids.length ? `m.id IN (${ids.join(',')})` : '1=1';
    const DF = ids.length ? `d.id IN (SELECT document_id FROM document_models WHERE model_id IN (${ids.join(',')}))` : '1=1';
    const m = buildMatcher(q);
    const functions = db
      .prepare(
        `SELECT f.id, f.slug, f.name, f.name_bn, c.name category FROM common_functions f JOIN categories c ON c.id=f.category_id ${cdJoin('common_function', 'f', 'cd')}
         WHERE ${hidden ? '1=1' : cdVisible('cd', 'search')} AND (f.name LIKE ? OR f.name_bn LIKE ? OR f.slug LIKE ? OR f.short_description LIKE ?) LIMIT 20`,
      )
      .all(like, like, like, like) as any[];
    if (functions.length < 8 && m.tokens.length) {
      const all = db
        .prepare(`SELECT f.id, f.slug, f.name, f.name_bn, f.short_description, c.name category FROM common_functions f JOIN categories c ON c.id=f.category_id ${cdJoin('common_function', 'f', 'cd')} WHERE ${hidden ? '1=1' : cdVisible('cd', 'search')}`)
        .all() as any[];
      const have = new Set(functions.map((x) => x.id));
      for (const { row } of rankRows(all, m, (r) => `${r.name} ${r.slug.replace(/-/g, ' ')} ${r.short_description ?? ''}`)) if (!have.has(row.id) && functions.length < 20) functions.push({ id: row.id, slug: row.slug, name: row.name, name_bn: row.name_bn, category: row.category });
    }
    const parameters = db
      .prepare(
        `SELECT p.id, p.code, p.name, p.verification_status, m.name model, b.name brand, f.name function_name ${PARAM_FROM}
         WHERE ${hidden ? '1=1' : `${cdVisible('cdp', 'search')} AND ${cdVisible('cdm')} AND ${cdVisible('cdb')}`}
         AND (p.code LIKE ? OR p.name LIKE ? OR p.description_en LIKE ? OR p.description_bn LIKE ?) AND ${MF} ORDER BY (p.code = ?) DESC, b.name LIMIT 50`,
      )
      .all(like, like, like, like, q.slice(0, 100)) as any[];
    if (parameters.length < 10 && m.tokens.length) {
      const all = db
        .prepare(
          `SELECT p.id, p.code, p.name, p.description_en, p.verification_status, m.name model, b.name brand, f.name function_name ${PARAM_FROM}
           WHERE ${hidden ? '1=1' : `${cdVisible('cdp', 'search')} AND ${cdVisible('cdm')} AND ${cdVisible('cdb')}`} AND ${MF}`,
        )
        .all() as any[];
      const have = new Set(parameters.map((x) => x.id));
      for (const { row } of rankRows(all, m, (r) => `${r.code} ${r.name ?? ''} ${r.function_name ?? ''} ${r.description_en ?? ''}`))
        if (!have.has(row.id) && parameters.length < 40) parameters.push({ id: row.id, code: row.code, name: row.name, verification_status: row.verification_status, model: row.model, brand: row.brand, function_name: row.function_name });
    }
    const registers = db
      .prepare(
        `SELECT r.id, r.original_address, r.name, r.verification_status, m.name model, b.name brand ${REG_FROM}
         WHERE ${hidden ? '1=1' : `${cdVisible('cdr', 'search')} AND ${cdVisible('cdm')}`}
         AND (r.original_address LIKE ? OR r.name LIKE ? OR r.description LIKE ? OR EXISTS (SELECT 1 FROM modbus_address_conversions mc WHERE mc.register_id=r.id AND mc.value LIKE ?)) AND ${MF} LIMIT 50`,
      )
      .all(like, like, like, like) as any[];
    if (registers.length < 10 && m.tokens.length) {
      const all = db
        .prepare(
          `SELECT r.id, r.original_address, r.name, r.description, r.verification_status, m.name model, b.name brand ${REG_FROM}
           WHERE ${hidden ? '1=1' : `${cdVisible('cdr', 'search')} AND ${cdVisible('cdm')}`} AND ${MF}`,
        )
        .all() as any[];
      const have = new Set(registers.map((x) => x.id));
      for (const { row } of rankRows(all, m, (r) => `${r.original_address} ${r.name ?? ''} ${r.description ?? ''}`))
        if (!have.has(row.id) && registers.length < 40) registers.push({ id: row.id, original_address: row.original_address, name: row.name, verification_status: row.verification_status, model: row.model, brand: row.brand });
    }
    const models = db
      .prepare(`SELECT m.id, m.name, b.name brand FROM models m JOIN brands b ON b.id=m.brand_id ${cdJoin('model', 'm', 'cd')} WHERE ${hidden ? '1=1' : cdVisible('cd', 'search')} AND (m.name LIKE ? OR b.name LIKE ?) AND ${MF} LIMIT 20`)
      .all(like, like);

    // manual topics (faults, warnings, wiring, specifications ...): matched on code, title and the documented text
    let topics: unknown[] = [];
    if (m.tokens.length) {
      const items = db
        .prepare(
          `SELECT k.id, k.kind, k.code, k.title, k.description, k.cause, k.remedy, k.section, k.page_index, k.revision_id, m.name model, b.name brand
           FROM knowledge_items k JOIN models m ON m.id=k.model_id JOIN brands b ON b.id=m.brand_id ${cdJoin('model', 'm', 'cdm')} ${cdJoin('brand', 'b', 'cdb')}
           WHERE ${hidden ? '1=1' : `${cdVisible('cdm')} AND ${cdVisible('cdb')}`} AND ${MF}`,
        )
        .all() as any[];
      const textOf = (r: any) => [r.code, r.title, r.description, r.cause, r.remedy].filter(Boolean).join('. ');
      topics = rankRows(items, m, textOf)
        .slice(0, 25)
        .map(({ row }) => ({ id: row.id, kind: row.kind, code: row.code, title: row.title, model: row.model, brand: row.brand, section: row.section, revision_id: row.revision_id, page_index: row.page_index, snippet: m.snippet(textOf(row), 200) }));
    }

    // manual page text: candidates from the full-text index (any spelling of any query word), then ranked by how many query words the page has
    let pages: unknown[] = [];
    if (m.tokens.length && m.terms.length) {
      const ftsQ = m.terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
      try {
        const cands = db
          .prepare(
            `SELECT pg.id page_id, pg.page_index, pg.printed_page, pg.text_source, pg.text, r.id revision_id, d.id document_id, d.title document_title
             FROM document_pages_fts JOIN document_pages pg ON pg.id = document_pages_fts.rowid
             JOIN document_revisions r ON r.id=pg.revision_id JOIN documents d ON d.id=r.document_id ${cdJoin('document', 'd', 'cd')}
             WHERE document_pages_fts MATCH ? AND ${DF} AND ${hidden ? '1=1' : cdVisible('cd', 'search')} ORDER BY rank LIMIT 400`,
          )
          .all(ftsQ) as any[];
        pages = rankRows(cands, m, (r) => r.text ?? '')
          .slice(0, 40)
          .map(({ row, coverage }) => ({ page_id: row.page_id, page_index: row.page_index, printed_page: row.printed_page, text_source: row.text_source, revision_id: row.revision_id, document_id: row.document_id, document_title: row.document_title, snippet: m.snippet(row.text ?? ''), match: Math.round(coverage * 100) }));
      } catch {
        pages = [];
      }
    }
    res.json({ q, functions, parameters, registers, models, topics, pages });
  }),
);
