/**
 * Automated verification of live records against the stored manual page text.
 *
 *   npx tsx server/src/cli/verify-records.ts            # dry run: report only
 *   npx tsx server/src/cli/verify-records.ts --apply    # mark passing records Verified (audited)
 *
 * A record is marked Verified ONLY when, on the page its evidence cites:
 *   1. its identifier (parameter code / register address) appears in the page text,
 *   2. its evidence quote is covered by the page text (>= 85% of the quote's words are on the page),
 *   3. every numeric default / min / max it stores appears on the page.
 * Everything else keeps its current status and the failed check is written to verification_records.
 * Technical values are never modified.
 */
import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';
import { setVerification } from '../services/review.js';

const apply = process.argv.includes('--apply');
await bootstrap(() => {});
const db = getDb();
const admin = db.prepare("SELECT id FROM users WHERE role='super_admin' ORDER BY id LIMIT 1").get() as { id: number };

/** Some PDFs (e.g. OMRON MX2) store ASCII glyphs as private-use characters U+F020..U+F07E (= ASCII + 0xF000); decode them so codes match. */
const decode = (t: string | null | undefined) => (t ?? '').replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xf000));
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const isNum = (v: unknown) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim());
const hasNumber = (text: string, v: string) => new RegExp(`(?<![\\w.])${v.trim().replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(text);

interface Check { ok: boolean; reasons: string[]; coverage: number }

function check(entityType: 'parameter' | 'modbus_register', row: any, pageText: string, quote: string | null): Check {
  const reasons: string[] = [];
  const id = entityType === 'parameter' ? String(row.code) : String(row.original_address);
  let idOk = squash(pageText).includes(squash(id)) || (alnum(id).length >= 3 && alnum(pageText).includes(alnum(id)));
  if (!idOk && entityType === 'modbus_register') {
    // addresses are printed in many notations (0x1000, 1000H, 1000): every address token of a list/range must appear as a whole token
    const toks = id.split(/\s*(?:-|–|;|,|\bto\b)\s*/i).map((t) => t.trim().replace(/^0x/i, '').replace(/h$/i, '')).filter(Boolean);
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    idOk = toks.length > 0 && toks.every((t) => new RegExp(`(?<![0-9A-Za-z])(?:0x)?${esc(t)}h?(?![0-9A-Za-z])`, 'i').test(pageText));
  }
  if (!idOk) reasons.push(`identifier "${id}" not on page`);
  const pageWords = new Set(words(pageText));
  const qw = words(quote ?? '');
  const coverage = qw.length ? qw.filter((w) => pageWords.has(w)).length / qw.length : 0;
  if (!qw.length) reasons.push('no evidence quote');
  else if (coverage < 0.85) reasons.push(`quote only ${(coverage * 100).toFixed(0)}% on page`);
  if (entityType === 'parameter')
    for (const [k, v] of [['default', row.default_value], ['min', row.min_value], ['max', row.max_value]] as const)
      if (isNum(v) && !hasNumber(pageText, v)) reasons.push(`${k} value ${v} not on page`);
  return { ok: reasons.length === 0, reasons, coverage };
}

const pageStmt = db.prepare(
  `SELECT dp.text, dp.text_source, sr.extracted_text quote, sr.page_index, e.id evidence_id
   FROM evidence_records e JOIN source_references sr ON sr.id = e.source_reference_id
   LEFT JOIN document_pages dp ON dp.id = sr.page_id
   WHERE e.entity_type = ? AND e.entity_id = ? AND e.role = 'original' ORDER BY e.id LIMIT 1`,
);

const summary: Record<string, Record<string, number>> = {};
const failures: string[] = [];
let verified = 0;
for (const [entityType, table] of [['parameter', 'parameters'], ['modbus_register', 'modbus_registers']] as const) {
  const rows = db.prepare(`SELECT t.*, m.name model_name FROM ${table} t JOIN models m ON m.id = t.model_id WHERE t.verification_status IN ('Unverified','Requires Manual Verification')`).all() as any[];
  for (const row of rows) {
    const ev = pageStmt.get(entityType, row.id) as any;
    const bucket = (summary[row.model_name.slice(0, 18)] ??= { pass: 0, fail: 0 });
    if (!ev?.text) {
      bucket.fail++;
      failures.push(`${entityType} #${row.id} ${row.model_name.slice(0, 14)}: no page text for cited page`);
      continue;
    }
    const r = check(entityType, row, decode(ev.text), decode(ev.quote));
    if (r.ok) {
      bucket.pass++;
      if (apply) {
        setVerification(entityType, row.id, 'Verified', admin.id, `auto-verified against manual page ${ev.page_index} (${ev.text_source}): identifier, quote coverage ${(r.coverage * 100).toFixed(0)}%, stored numeric values found on the page`);
        if (row.evidence_status !== 'Explicitly Documented')
          db.prepare(`UPDATE ${table} SET evidence_status = 'Explicitly Documented' WHERE id = ?`).run(row.id);
        verified++;
      }
    } else {
      bucket.fail++;
      failures.push(`${entityType} #${row.id} ${row.model_name.slice(0, 14)} ${entityType === 'parameter' ? row.code : row.original_address}: ${r.reasons.join('; ')}`);
      if (apply && row.verification_status !== 'Requires Manual Verification')
        setVerification(entityType, row.id, 'Requires Manual Verification', admin.id, `automatic check failed: ${r.reasons.join('; ')}`);
    }
  }
}
// ---- knowledge items (faults, warnings, troubleshooting, wiring ...): the evidence quote must be covered by the cited page; a code, when given, must be on it
{
  const bucketOf = (name: string) => (summary[name.slice(0, 18) + ' (topics)'] ??= { pass: 0, fail: 0 });
  const items = db
    .prepare("SELECT k.*, m.name model_name FROM knowledge_items k JOIN models m ON m.id = k.model_id WHERE k.verification_status IN ('Unverified','Requires Manual Verification')")
    .all() as any[];
  const pg = db.prepare('SELECT text FROM document_pages WHERE revision_id = ? AND page_index = ?');
  const upd = db.prepare("UPDATE knowledge_items SET verification_status = ?, evidence_status = ?, updated_at = ? WHERE id = ?");
  for (const k of items) {
    const b = bucketOf(k.model_name);
    const rawText = (pg.get(k.revision_id, k.page_index) as any)?.text as string | undefined;
    const text = rawText ? decode(rawText) : undefined;
    const reasons: string[] = [];
    if (!text) reasons.push('no page text for cited page');
    else {
      const pw = new Set(words(text));
      const qw = words(decode(k.evidence_quote));
      const cov = qw.length ? qw.filter((w) => pw.has(w)).length / qw.length : 0;
      if (!qw.length) reasons.push('no evidence quote');
      else if (cov < 0.85) reasons.push(`quote only ${(cov * 100).toFixed(0)}% on page`);
      if ((k.kind === 'fault' || k.kind === 'alarm') && k.code && alnum(String(k.code)).length >= 2 && !alnum(text).includes(alnum(String(k.code)))) reasons.push(`code "${k.code}" not on page`);
    }
    if (!reasons.length) {
      b.pass++;
      if (apply) { upd.run('Verified', 'Explicitly Documented', new Date().toISOString(), k.id); verified++; }
    } else {
      b.fail++;
      failures.push(`knowledge #${k.id} ${k.model_name.slice(0, 14)} ${k.kind} ${k.code ?? k.title}: ${reasons.join('; ')}`);
      if (apply && k.verification_status !== 'Requires Manual Verification') upd.run('Requires Manual Verification', k.evidence_status, new Date().toISOString(), k.id);
    }
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', verified, summary }, null, 2));
console.log(failures.filter((f) => !process.env.ONLY || f.includes(process.env.ONLY)).slice(0, 60).join('\n'));
console.log(`failures total: ${failures.length}`);
process.exit(0);
