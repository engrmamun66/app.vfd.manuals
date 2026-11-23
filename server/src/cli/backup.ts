import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';
import { createBackup } from '../services/backup.js';

await bootstrap(() => {});
const b = createBackup(getDb(), 'cli');
console.log(JSON.stringify({ path: b.relPath, size: b.size, verified: b.verified }, null, 2));
