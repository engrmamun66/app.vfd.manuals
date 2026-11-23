import { bootstrap } from '../bootstrap.js';
import { currentSchemaVersion, getDb } from '../db/index.js';

await bootstrap();
console.log(JSON.stringify({ schemaVersion: currentSchemaVersion(getDb()) }));
