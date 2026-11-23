import { getDb, runMigrations, openDb, setDb } from './db/index.js';
import { bootstrapSuperAdmin, seedTaxonomy } from './db/seed.js';
import { createBackup } from './services/backup.js';
import { systemDirsReady } from './services/storage.js';

/** Opens the DB, applies pending migrations (with pre-migration backup), seeds taxonomy and bootstraps the Super Admin. */
export async function bootstrap(log: (m: string) => void = console.log) {
  const db = openDb();
  const applied = runMigrations(db, { backup: (d, label) => log(`Backup before migration: ${createBackup(d, label).relPath}`) });
  setDb(db);
  if (applied.length) log(`Applied migrations: ${applied.join(', ')}`);
  const tax = seedTaxonomy(getDb());
  if (tax.categories || tax.functions) log(`Taxonomy seeded: +${tax.categories} categories, +${tax.functions} common functions`);
  const sa = await bootstrapSuperAdmin(getDb());
  log(sa.message);
  systemDirsReady();
  return getDb();
}
