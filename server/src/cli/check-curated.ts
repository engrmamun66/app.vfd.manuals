/**
 * Validates a curated extraction file against the manual text already stored in the DB.
 *   npx tsx server/src/cli/check-curated.ts data/curated/<file>.json
 * Read-only. Prints a JSON report; exit code 1 when blocking problems exist.
 * Checks: structure, duplicates, importance/kind values, quote match per record (page text from the DB),
 * and COMPLETENESS: codes that look like the extracted ones but occur in the manual text and are missing from the file.
 */
import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { bootstrap } from '../bootstrap.js';
import { matchQuote } from '../services/ingestion/DocumentIngestionService.js';
import type { CuratedFile } from '../services/ingestion/curated.js';

const file = process.argv[2];
if (!file) throw new Error('usage: check-curated.ts <curated.json>');
await bootstrap(() => {});
const db = getDb();
const problems: string[] = [];
let data: CuratedFile;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.log(JSON.stringify({ ok: false, problems: [`invalid JSON: ${(e as Error).message}`] }));
  process.exit(1);
}
const rev = db.prepare("SELECT id, page_count FROM document_revisions WHERE lower(replace(source_rel_path, char(92), '/')) = lower(?)").get((data.document_file ?? '').replace(/\\/g, '/')) as { id: number; page_count: number } | undefined;
if (!rev) {
  console.log(JSON.stringify({ ok: false, problems: [`document_file "${data.document_file}" is not imported yet (run the manual import first)`] }));
  process.exit(1);
}
const pages = new Map<number, string>();
for (const p of db.prepare('SELECT page_index, text FROM document_pages WHERE revision_id = ?').all(rev.id) as { page_index: number; text: string }[]) pages.set(p.page_index, p.text ?? '');
if (!data.brand || !data.model) problems.push('brand and model are required');

const IMP = new Set(['Important', 'Medium', 'Optional']);
const KINDS = new Set(['fault', 'alarm', 'warning', 'troubleshooting', 'wiring', 'installation', 'safety', 'specification', 'communication', 'maintenance', 'note']);
const qstats: Record<string, number> = {};
const bump = (k: string) => (qstats[k] = (qstats[k] ?? 0) + 1);
const sample: string[] = [];
const seen = new Set<string>();
const importance: Record<string, number> = { Important: 0, Medium: 0, Optional: 0, missing: 0 };

for (const p of data.parameters ?? []) {
  const key = String(p.code ?? '').trim();
  if (!key) { problems.push('parameter without code'); continue; }
  if (seen.has(key)) problems.push(`duplicate parameter code ${key}`);
  seen.add(key);
  if (!p.name) problems.push(`${key}: name missing`);
  if (!p.page_index || p.page_index < 1 || p.page_index > rev.page_count) problems.push(`${key}: page_index invalid (${p.page_index})`);
  if (!p.evidence_quote) problems.push(`${key}: evidence_quote missing`);
  if (!p.importance || !IMP.has(p.importance)) { importance.missing++; problems.push(`${key}: importance must be Important|Medium|Optional`); } else importance[p.importance]++;
  const qm = matchQuote(pages.get(p.page_index ?? 0), p.evidence_quote);
  bump(qm);
  if (qm === 'not_found' && sample.length < 25) sample.push(`${key} p${p.page_index}: quote not on page`);
}
const regSeen = new Set<string>();
for (const r of data.modbus_registers ?? []) {
  const key = `${r.original_address}|${r.name}`;
  if (!r.original_address || !r.name) { problems.push('register without address/name'); continue; }
  if (regSeen.has(key)) problems.push(`duplicate register ${key}`);
  regSeen.add(key);
  const qm = matchQuote(pages.get(r.page_index ?? 0), r.evidence_quote);
  bump('reg_' + qm);
  if (qm === 'not_found' && sample.length < 25) sample.push(`register ${key} p${r.page_index}: quote not on page`);
}
const kinds: Record<string, number> = {};
const kiSeen = new Set<string>();
for (const k of data.knowledge_items ?? []) {
  if (!k.kind || !KINDS.has(k.kind)) { problems.push(`knowledge item "${k.title}": invalid kind ${k.kind}`); continue; }
  if (!k.title) { problems.push('knowledge item without title'); continue; }
  const key = `${k.kind}|${k.code ?? ''}|${k.title}`;
  if (kiSeen.has(key)) problems.push(`duplicate knowledge item ${key}`);
  kiSeen.add(key);
  kinds[k.kind] = (kinds[k.kind] ?? 0) + 1;
  const qm = matchQuote(pages.get(k.page_index ?? 0), k.evidence_quote);
  bump('ki_' + qm);
  if (qm === 'not_found' && sample.length < 25) sample.push(`knowledge ${k.kind} ${k.code ?? k.title} p${k.page_index}: quote not on page`);
}

// completeness: code shapes seen in the file (e.g. F0-00 -> "A#-##") that appear in the manual text but are not extracted
const shape = (c: string) => c.replace(/[0-9]/g, '#');
const shapes = new Map<string, number>();
for (const c of seen) shapes.set(shape(c), (shapes.get(shape(c)) ?? 0) + 1);
const goodShapes = [...shapes.entries()].filter(([s, n]) => n >= 3 && /#/.test(s)).map(([s]) => s);
const missing = new Map<string, number>();
if (goodShapes.length) {
  const re = /[A-Za-z]{0,3}[0-9]{1,4}(?:[-.][0-9A-Za-z]{1,4})?(?:[-.][0-9]{1,4})?/g;
  const lower = new Set([...seen].map((c) => c.toLowerCase()));
  for (const [idx, text] of pages) {
    for (const m of text.matchAll(re)) {
      const t = m[0];
      if (!goodShapes.includes(shape(t)) || lower.has(t.toLowerCase())) continue;
      if (!missing.has(t)) missing.set(t, idx);
    }
  }
}
const report = {
  ok: problems.length === 0,
  document: data.document_file,
  pages: rev.page_count,
  counts: { parameters: seen.size, registers: regSeen.size, knowledge_items: kiSeen.size, byKind: kinds },
  importance,
  quoteMatch: qstats,
  possibleMissingParameterCodes: { shapesUsed: goodShapes.slice(0, 12), count: missing.size, firstSeenOnPage: [...missing.entries()].slice(0, 60).map(([c, p]) => `${c}@p${p}`) },
  quoteProblemsSample: sample,
  problems: problems.slice(0, 40),
  problemCount: problems.length,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
