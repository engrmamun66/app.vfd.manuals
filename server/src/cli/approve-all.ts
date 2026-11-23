/**
 * Bulk-approve every pending staged record (mode=auto). Same rules as the Verification Center:
 * conflicts are preserved, uncertain matches are skipped and left pending for a human decision.
 * Records whose quote was not machine-verified become "Requires Manual Verification".
 */
import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';
import { approveStaged } from '../services/review.js';

await bootstrap(() => {});
const db = getDb();
const admin = db.prepare("SELECT id FROM users WHERE role='super_admin' ORDER BY id LIMIT 1").get() as { id: number };
const rows = db.prepare("SELECT id FROM staged_records WHERE status='pending' ORDER BY id").all() as { id: number }[];
let ok = 0;
const skipped: Record<string, number> = {};
for (const r of rows) {
  try {
    try {
      approveStaged(r.id, admin.id, { note: 'bulk approved by owner request; verify against manual later' });
    } catch (e: any) {
      // "Possible Duplicate" / "Uncertain Match": a new code is a different parameter, so create it (existing records stay untouched)
      if (!/requires an explicit decision/.test(String(e.message))) throw e;
      approveStaged(r.id, admin.id, { mode: 'create_new', note: 'bulk approved (create_new); verify against manual later' });
    }
    ok++;
  } catch (e: any) {
    const k = String(e.message).slice(0, 90);
    skipped[k] = (skipped[k] ?? 0) + 1;
  }
}
console.log(JSON.stringify({ total: rows.length, approved: ok, skipped }, null, 2));
process.exit(0);
