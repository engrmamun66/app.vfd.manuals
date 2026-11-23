/**
 * E2E seed: builds an isolated temp DB (DB_PATH/STORAGE_DIR from env), imports two real manuals via the
 * normal ingestion service, and approves staged records whose evidence quote was found on the cited page.
 * Never touches the real database.
 */
import { bootstrap } from '../../server/src/bootstrap.js';
import { getDb } from '../../server/src/db/index.js';
import { DocumentIngestionService } from '../../server/src/services/ingestion/DocumentIngestionService.js';
import { approveStaged } from '../../server/src/services/review.js';
import { config } from '../../server/src/config.js';

if (!process.env.DB_PATH || config.dbPath.includes('vfd-knowledge.db')) throw new Error('Refusing to seed the real database. Set DB_PATH.');
await bootstrap(() => {});
const db = getDb();
const svc = new DocumentIngestionService(db);
for (const f of ['vfd-manuals/Delta/Delta-VFD-EL-Series-Users-Manual.pdf', 'vfd-manuals/Sciemence/v20_operating_instructions_complete_en-US_en-US.pdf']) {
  const r = await svc.ingest({ path: f, ocr: false });
  console.error(`[seed] ${f}: ${r.status}, staged ${r.extraction.staged}`);
}
const rows = db.prepare("SELECT id FROM staged_records WHERE status='pending' AND quote_match IN ('exact','normalized') AND comparison='No Existing Record'").all() as { id: number }[];
let ok = 0;
// keep a few records pending so the Verification Center has something to review (curated files now match the manuals fully)
const toApprove = rows.slice(0, Math.max(0, rows.length - 3));
for (const r of toApprove) {
  try { approveStaged(r.id, 1, {}); ok++; } catch { /* leave for review */ }
}
// mark one record Verified so the UI shows both states
db.prepare("UPDATE parameters SET verification_status='Verified' WHERE id=(SELECT MIN(id) FROM parameters)").run();
console.error(`[seed] approved ${ok}/${toApprove.length}`);
process.exit(0);
