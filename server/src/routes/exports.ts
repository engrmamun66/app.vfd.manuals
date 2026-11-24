import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ah, oneOf } from '../lib/http.js';
import { logActivity } from '../lib/audit.js';

/** Knowledge-base exports (shared technical data only — never other users' private data). */
export const exportsRouter = Router();

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

exportsRouter.get(
  '/',
  ah(async (req, res) => {
    const db = getDb();
    const scope = oneOf(req.query.scope, 'scope', ['parameters', 'registers', 'sources', 'taxonomy'] as const);
    const format = oneOf(req.query.format, 'format', ['csv', 'json'] as const, 'json');
    const where: string[] = ['1=1'];
    const args: unknown[] = [];
    if (req.query.brand) (where.push('b.slug = ?'), args.push(String(req.query.brand)));
    if (req.query.model) (where.push('m.id = ?'), args.push(Number(req.query.model)));
    if (req.query.category) (where.push('(c.slug = ? OR EXISTS (SELECT 1 FROM category_parameters cp JOIN categories cx ON cx.id = cp.category_id WHERE cp.parameter_id = p.id AND cx.slug = ?))'), args.push(String(req.query.category), String(req.query.category)));
    let rows: any[] = [];
    const src = (type: string, alias: string) => `(SELECT d.title || ' | rev ' || COALESCE(r.revision_label,'?') || ' | PDF page ' || COALESCE(s.page_index,'?') || COALESCE(' | printed ' || s.printed_page,'') || ' | quote ' || s.quote_match
        FROM evidence_records e JOIN source_references s ON s.id=e.source_reference_id JOIN document_revisions r ON r.id=s.revision_id JOIN documents d ON d.id=r.document_id
        WHERE e.entity_type='${type}' AND e.entity_id=${alias}.id ORDER BY e.id LIMIT 1)`;
    if (scope === 'parameters')
      rows = db
        .prepare(
          `SELECT p.id, b.name brand, m.name model, c.name category, f.name common_function, p.equivalence, p.code, p.name, p.unit, p.default_value, p.min_value, p.max_value,
             p.resolution, p.access_type, p.setting_conditions, p.description_en, p.description_bn, p.evidence_status, p.verification_status, ${src('parameter', 'p')} source
           FROM parameters p JOIN models m ON m.id=p.model_id JOIN brands b ON b.id=m.brand_id LEFT JOIN common_functions f ON f.id=p.common_function_id LEFT JOIN categories c ON c.id=p.category_id
           WHERE ${where.join(' AND ')} ORDER BY b.name, m.name, p.code`,
        )
        .all(...args);
    else if (scope === 'registers')
      rows = db
        .prepare(
          `SELECT r.id, b.name brand, m.name model, f.name common_function, r.name, r.original_address, r.address_format,
             (SELECT group_concat(representation || '=' || value || ' (' || method || ')', '; ') FROM modbus_address_conversions WHERE register_id=r.id) mathematical_conversions,
             r.register_type, r.function_codes, r.access, r.data_type, r.scaling, r.unit, r.description, r.evidence_status, r.verification_status, ${src('modbus_register', 'r')} source
           FROM modbus_registers r JOIN models m ON m.id=r.model_id JOIN brands b ON b.id=m.brand_id LEFT JOIN common_functions f ON f.id=r.common_function_id LEFT JOIN categories c ON c.id=f.category_id
           WHERE ${where.join(' AND ')} ORDER BY b.name, m.name, r.original_address`,
        )
        .all(...args);
    else if (scope === 'sources')
      rows = db
        .prepare(
          `SELECT s.id source_reference_id, e.entity_type, e.entity_id, e.role, d.title document, r.revision_label, r.original_filename, r.sha256, s.page_index, s.printed_page,
             s.section, s.table_ref, s.quote_match, s.extracted_text
           FROM source_references s JOIN evidence_records e ON e.source_reference_id=s.id JOIN document_revisions r ON r.id=s.revision_id JOIN documents d ON d.id=r.document_id
           LEFT JOIN brands b ON b.id=d.brand_id LEFT JOIN document_models dm ON dm.document_id=d.id LEFT JOIN models m ON m.id=dm.model_id LEFT JOIN categories c ON 0
           WHERE ${where.filter((w) => !w.startsWith('c.')).join(' AND ')} ORDER BY d.title, s.page_index`,
        )
        .all(...args.filter((_, i) => !where[i + 1]?.startsWith('c.')));
    else
      rows = db
        .prepare('SELECT c.slug category_slug, c.name category, c.name_bn category_bn, f.slug function_slug, f.name, f.name_bn, f.short_description FROM common_functions f JOIN categories c ON c.id=f.category_id ORDER BY c.id, f.id')
        .all();
    logActivity({ userId: req.user!.id, event: 'export', meta: { scope, format, filters: req.query } });
    const fname = `vfd-${scope}-${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(toCsv(rows));
    } else res.json({ exportedAt: new Date().toISOString(), scope, filters: req.query, count: rows.length, rows });
  }),
);
