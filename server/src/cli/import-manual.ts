/**
 * Usage: npm run import:manual -- "vfd-manuals/Delta/New-Manual.pdf" [--dry-run] [--no-ocr]
 * Prints a structured JSON result (stdout). Progress goes to stderr.
 * Uses the same DocumentIngestionService as the web UI. Processes ONLY the explicitly given path.
 */
import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';
import { DocumentIngestionService } from '../services/ingestion/DocumentIngestionService.js';
import { shutdownOcr } from '../services/ingestion/ocr.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: npm run import:manual -- <path-inside-vfd-manuals> [--dry-run] [--no-ocr]');
  process.exit(2);
}
await bootstrap(() => {});
const svc = new DocumentIngestionService(getDb());
const result = await svc.ingest({ path: target, dryRun: flags.has('--dry-run'), ocr: !flags.has('--no-ocr'), onProgress: (m) => console.error(m) });
await shutdownOcr();
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'failed' ? 1 : 0);
