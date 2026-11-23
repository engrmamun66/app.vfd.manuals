import { getDb, type DB } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { json, parseJson } from '../lib/util.js';
import { normAddress } from './ingestion/DocumentIngestionService.js';

/**
 * Applies human review decisions on staged records. Rules (§29.5):
 *  A exact match      → keep record, add supporting evidence
 *  B adds details     → fill ONLY empty fields, add evidence, keep history
 *  C conflict         → never overwrite; add conflicting evidence, flag Documentation Conflict, create task
 *  D different entity → create separate record
 *  E uncertain        → reviewer must choose explicitly (create_new | attach)
 */

type Mode = 'auto' | 'create_new' | 'attach';

function evidenceStatusFor(quoteMatch: string | null) {
  return quoteMatch === 'exact' || quoteMatch === 'normalized' ? 'Explicitly Documented' : 'Unverified';
}
function verificationFor(quoteMatch: string | null) {
  return quoteMatch === 'exact' || quoteMatch === 'normalized' ? 'Unverified' : 'Requires Manual Verification';
}

function createSourceRef(db: DB, revisionId: number | null, p: any, quoteMatch: string | null) {
  if (!revisionId) return null;
  const page = p.page_index
    ? (db.prepare('SELECT id FROM document_pages WHERE revision_id = ? AND page_index = ?').get(revisionId, p.page_index) as { id: number } | undefined)
    : undefined;
  return Number(
    db
      .prepare(
        `INSERT INTO source_references(revision_id, page_id, page_index, printed_page, page_verified, section, table_ref, extracted_text, quote_match)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(revisionId, page?.id ?? null, p.page_index ?? null, p.printed_page ?? null, 0, p.section ?? null, p.table_ref ?? null, p.evidence_quote ?? null, quoteMatch ?? 'unchecked').lastInsertRowid,
  );
}

function addEvidence(db: DB, entityType: string, entityId: number, srcId: number | null, role: string, status: string, snapshot: unknown, jobId: number | null) {
  if (!srcId) return;
  db.prepare('INSERT INTO evidence_records(entity_type, entity_id, source_reference_id, role, evidence_status, value_snapshot_json, import_job_id) VALUES (?,?,?,?,?,?,?)').run(
    entityType,
    entityId,
    srcId,
    role,
    status,
    json(snapshot),
    jobId,
  );
}

const PARAM_FILL: [string, string][] = [
  ['name', 'name'],
  ['description', 'description_en'],
  ['unit', 'unit'],
  ['data_type', 'data_type'],
  ['default_value', 'default_value'],
  ['min_value', 'min_value'],
  ['max_value', 'max_value'],
  ['resolution', 'resolution'],
  ['access', 'access_type'],
  ['setting_conditions', 'setting_conditions'],
];
const REG_FILL: [string, string][] = [
  ['register_type', 'register_type'],
  ['function_codes', 'function_codes'],
  ['access', 'access'],
  ['data_length_words', 'data_length_words'],
  ['data_type', 'data_type'],
  ['scaling', 'scaling'],
  ['unit', 'unit'],
  ['description', 'description'],
];

/** Mathematical-only conversions of an original address. Never claims PLC/4xxxx validity. */
export function addressConversions(original: string, format: string | null): { hex?: string; decimal?: string; method?: string } {
  const s = original.trim();
  const hexM = /^(?:0x)?([0-9a-f]{1,8})\s*h?$/i.exec(s);
  if (format === 'HEX' && hexM) {
    const v = parseInt(hexM[1], 16);
    return { hex: `0x${hexM[1].toUpperCase()}`, decimal: String(v), method: `0x${hexM[1].toUpperCase()} = ${v} (base-16 to base-10)` };
  }
  if (format === 'Decimal' && /^\d{1,10}$/.test(s)) {
    const v = parseInt(s, 10);
    return { decimal: s, hex: `0x${v.toString(16).toUpperCase().padStart(4, '0')}`, method: `${v} = 0x${v.toString(16).toUpperCase()} (base-10 to base-16)` };
  }
  return {};
}

function createParameter(db: DB, p: any, userId: number, ev: string, ver: string) {
  const cat = p._common_function_id ? (db.prepare('SELECT category_id FROM common_functions WHERE id = ?').get(p._common_function_id) as any)?.category_id : null;
  const id = Number(
    db
      .prepare(
        `INSERT INTO parameters(model_id, common_function_id, category_id, code, name, description_en, unit, data_type, default_value, min_value, max_value, resolution,
          access_type, setting_conditions, options_json, equivalence, equivalence_note, evidence_status, verification_status, created_by_user_id, updated_by_user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p._model_id,
        p._common_function_id ?? null,
        cat ?? null,
        String(p.code).trim(),
        p.name ?? null,
        p.description ?? null,
        p.unit ?? null,
        p.data_type ?? null,
        p.default_value ?? null,
        p.min_value ?? null,
        p.max_value ?? null,
        p.resolution ?? null,
        p.access ?? null,
        p.setting_conditions ?? null,
        p.options?.length ? json(p.options) : null,
        p.equivalence ?? null,
        p.equivalence_note ?? null,
        ev,
        ver,
        userId,
        userId,
      ).lastInsertRowid,
  );
  db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES ('parameter', ?)").run(id);
  return id;
}

function createRegister(db: DB, r: any, userId: number, ev: string, ver: string) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO modbus_registers(model_id, common_function_id, name, original_address, address_format, register_type, function_codes, access, data_length_words,
          data_type, scaling, unit, bit_definitions_json, description, evidence_status, verification_status, created_by_user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        r._model_id,
        r._common_function_id ?? null,
        r.name,
        String(r.original_address).trim(),
        ['HEX', 'Decimal', 'Parameter-derived'].includes(r.address_format) ? r.address_format : r.address_format ? 'Other' : null,
        r.register_type ?? null,
        r.function_codes ?? null,
        r.access ?? null,
        Number.isInteger(r.data_length_words) ? r.data_length_words : null,
        r.data_type ?? null,
        r.scaling ?? null,
        r.unit ?? null,
        r.bit_definitions?.length ? json(r.bit_definitions) : null,
        r.description ?? null,
        ev,
        ver,
        userId,
      ).lastInsertRowid,
  );
  const conv = addressConversions(String(r.original_address), r.address_format ?? null);
  const ins = db.prepare('INSERT OR IGNORE INTO modbus_address_conversions(register_id, representation, value, method) VALUES (?,?,?,?)');
  if (conv.hex && r.address_format !== 'HEX') ins.run(id, 'hex', conv.hex, conv.method);
  if (conv.decimal && r.address_format !== 'Decimal') ins.run(id, 'decimal', conv.decimal, conv.method);
  db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES ('modbus_register', ?)").run(id);
  return id;
}

export function approveStaged(stagedId: number, userId: number, opts: { mode?: Mode; note?: string | null } = {}) {
  const db = getDb();
  const mode: Mode = opts.mode ?? 'auto';
  return db.transaction(() => {
    const s = db.prepare('SELECT * FROM staged_records WHERE id = ?').get(stagedId) as any;
    if (!s) throw new HttpError(404, 'Staged record not found');
    if (s.status !== 'pending') throw new HttpError(409, `Staged record is already ${s.status}`);
    const p = parseJson<any>(s.payload_json, {});
    if (!p._model_id) {
      // model may have been created after staging (dry-run → real run)
      const m = db.prepare('SELECT m.id FROM models m JOIN brands b ON b.id=m.brand_id WHERE lower(b.name)=lower(?) AND lower(m.name)=lower(?)').get(p._brand, p._model) as any;
      if (!m) throw new HttpError(409, 'Model for this record does not exist yet');
      p._model_id = m.id;
    }
    const table = s.record_type === 'parameter' ? 'parameters' : 'modbus_registers';
    const entityType = s.record_type;
    const ev = evidenceStatusFor(s.quote_match);
    const ver = verificationFor(s.quote_match);
    const srcId = createSourceRef(db, s.revision_id, p, s.quote_match);
    let comparison: string = s.comparison;

    // re-check the match at approval time (DB may have changed since staging)
    let existing: any = null;
    if (s.record_type === 'parameter') existing = db.prepare('SELECT * FROM parameters WHERE model_id = ? AND code = ?').get(p._model_id, String(p.code).trim());
    else
      existing = (db.prepare('SELECT * FROM modbus_registers WHERE model_id = ?').all(p._model_id) as any[]).find(
        (r) => normAddress(r.original_address) === normAddress(String(p.original_address)) && r.name.trim().toLowerCase() === String(p.name).trim().toLowerCase(),
      );
    if (!existing && ['Exact Match', 'Updated Information', 'Conflicting Information'].includes(comparison)) comparison = 'No Existing Record';
    if (existing && comparison === 'No Existing Record') comparison = 'Uncertain Match';

    let entityId: number;
    let outcome: string;
    if (mode === 'attach') {
      const target = s.matched_entity_id ?? existing?.id;
      if (!target) throw new HttpError(400, 'No existing record to attach to');
      entityId = target;
      addEvidence(db, entityType, entityId, srcId, 'supporting', ev, p, s.import_job_id);
      outcome = 'attached as supporting evidence';
    } else if (mode === 'create_new' || comparison === 'No Existing Record' || comparison === 'New Information') {
      if (existing && s.record_type === 'parameter')
        throw new HttpError(409, `Parameter ${p.code} already exists for this model (#${existing.id}). Use "attach" instead.`);
      entityId = s.record_type === 'parameter' ? createParameter(db, p, userId, ev, ver) : createRegister(db, p, userId, ev, ver);
      addEvidence(db, entityType, entityId, srcId, 'original', ev, p, s.import_job_id);
      outcome = 'created';
      audit({ entityType, entityId, operation: 'create', next: p, source: `staged_record:${s.id}`, importJobId: s.import_job_id, userId, approval: 'approved' });
    } else if (comparison === 'Exact Match') {
      entityId = existing.id;
      addEvidence(db, entityType, entityId, srcId, 'supporting', ev, p, s.import_job_id);
      outcome = 'exact match — supporting evidence added';
    } else if (comparison === 'Updated Information') {
      entityId = existing.id;
      const fill = s.record_type === 'parameter' ? PARAM_FILL : REG_FILL;
      const changes: Record<string, unknown> = {};
      for (const [src, col] of fill) if ((existing[col] === null || existing[col] === '') && p[src] !== null && p[src] !== undefined && p[src] !== '') changes[col] = p[src];
      if (Object.keys(changes).length) {
        const sets = Object.keys(changes).map((c) => `${c} = ?`).join(', ');
        db.prepare(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`).run(...Object.values(changes), new Date().toISOString(), entityId);
        audit({ entityType, entityId, operation: 'fill_empty_fields', previous: Object.fromEntries(Object.keys(changes).map((k) => [k, existing[k]])), next: changes, source: `staged_record:${s.id}`, importJobId: s.import_job_id, userId, approval: 'approved' });
      }
      addEvidence(db, entityType, entityId, srcId, 'supporting', ev, p, s.import_job_id);
      outcome = `details added (${Object.keys(changes).join(', ') || 'none'})`;
    } else if (comparison === 'Conflicting Information') {
      entityId = existing.id;
      addEvidence(db, entityType, entityId, srcId, 'conflicting', 'Conflicting', p, s.import_job_id);
      db.prepare(`UPDATE ${table} SET verification_status = 'Documentation Conflict', evidence_status = 'Conflicting', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), entityId);
      db.prepare('INSERT INTO verification_tasks(entity_type, entity_id, task_type, title, details_json, import_job_id) VALUES (?,?,?,?,?,?)').run(
        entityType,
        entityId,
        'conflict',
        `Documentation conflict on ${s.record_type === 'parameter' ? p.code : p.original_address}`,
        s.comparison_detail_json,
        s.import_job_id,
      );
      audit({ entityType, entityId, operation: 'flag_conflict', previous: { verification_status: existing.verification_status }, next: { verification_status: 'Documentation Conflict', conflicting: p }, source: `staged_record:${s.id}`, importJobId: s.import_job_id, userId, approval: 'approved' });
      outcome = 'conflict recorded — existing value preserved';
    } else {
      throw new HttpError(409, `Comparison "${comparison}" requires an explicit decision: mode=create_new or mode=attach`);
    }
    db.prepare("UPDATE staged_records SET status = 'approved', reviewed_by_user_id = ?, reviewed_at = ?, created_entity_id = ?, review_note = ? WHERE id = ?").run(
      userId,
      new Date().toISOString(),
      entityId,
      opts.note ?? outcome,
      stagedId,
    );
    db.prepare('INSERT INTO verification_records(entity_type, entity_id, action, to_status, note, user_id) VALUES (?,?,?,?,?,?)').run(entityType, entityId, 'approve_staged', ver, outcome, userId);
    return { stagedId, entityType, entityId, outcome };
  })();
}

export function rejectStaged(stagedId: number, userId: number, note: string | null) {
  const db = getDb();
  const s = db.prepare('SELECT status FROM staged_records WHERE id = ?').get(stagedId) as any;
  if (!s) throw new HttpError(404, 'Staged record not found');
  if (s.status !== 'pending') throw new HttpError(409, `Staged record is already ${s.status}`);
  db.prepare("UPDATE staged_records SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(userId, new Date().toISOString(), note, stagedId);
  return { stagedId, status: 'rejected' };
}

/** Human verification of a live record against its source (does not alter technical values). */
export function setVerification(entityType: 'parameter' | 'modbus_register', id: number, status: string, userId: number, note: string | null) {
  const db = getDb();
  const table = entityType === 'parameter' ? 'parameters' : 'modbus_registers';
  const row = db.prepare(`SELECT verification_status FROM ${table} WHERE id = ?`).get(id) as any;
  if (!row) throw new HttpError(404, 'Record not found');
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET verification_status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
    db.prepare('INSERT INTO verification_records(entity_type, entity_id, action, from_status, to_status, note, user_id) VALUES (?,?,?,?,?,?,?)').run(entityType, id, 'set_status', row.verification_status, status, note, userId);
    audit({ entityType, entityId: id, operation: 'verification_status', previous: row, next: { verification_status: status, note }, source: 'verification_center', userId });
  })();
}
