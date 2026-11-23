/**
 * Usage: npm run import:curated [-- --dry-run] [--no-ocr]
 * Imports every manual referenced by a data/curated/*.json file (explicit list, not a folder watcher).
 */
import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';
import { DocumentIngestionService } from '../services/ingestion/DocumentIngestionService.js';
import { listCuratedFiles } from '../services/ingestion/curated.js';
import { shutdownOcr } from '../services/ingestion/ocr.js';

const flags = new Set(process.argv.slice(2));
await bootstrap(() => {});
const svc = new DocumentIngestionService(getDb());
const summary: any[] = [];
for (const c of listCuratedFiles()) {
  if (!c.valid || !c.document_file) {
    summary.push({ file: c.file, status: 'invalid', error: c.error });
    continue;
  }
  console.error(`\n=== ${c.file} → ${c.document_file}`);
  const r = await svc.ingest({ path: c.document_file, dryRun: flags.has('--dry-run'), ocr: !flags.has('--no-ocr'), onProgress: (m) => console.error(m) });
  summary.push({ file: c.file, status: r.status, jobId: r.importJobId, pages: r.pages, extraction: r.extraction, comparison: r.comparison, pendingReview: r.pendingReview, errors: r.errors, warnings: r.warnings.length });
}
await shutdownOcr();
console.log(JSON.stringify(summary, null, 2));
