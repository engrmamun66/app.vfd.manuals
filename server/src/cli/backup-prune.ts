import { getDb } from '../db/index.js';
import { pruneBackups } from '../services/backup.js';

// usage: npm run backup:prune [-- --dry-run]
const r = pruneBackups(getDb(), { dryRun: process.argv.includes('--dry-run') });
console.log(JSON.stringify({ ...r, freedMB: Math.round(r.freedBytes / 1048576), dryRun: process.argv.includes('--dry-run') }));
