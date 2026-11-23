import fs from 'node:fs';
import { config } from '../config.js';
import type { DB } from './index.js';
import { hashPassword, isValidEmail, normalizeEmail, passwordProblems } from '../auth/password.js';

interface Taxonomy {
  categories: { slug: string; name: string; name_bn?: string; functions: [string, string, string, string][] }[];
}

/**
 * Idempotent taxonomy seed. Inserts missing categories/common functions only;
 * never deletes or renames existing ones (IDs stay stable).
 */
export function seedTaxonomy(db: DB) {
  if (!fs.existsSync(config.taxonomyFile)) return { categories: 0, functions: 0 };
  const tax = JSON.parse(fs.readFileSync(config.taxonomyFile, 'utf8')) as Taxonomy;
  let c = 0;
  let f = 0;
  const insCat = db.prepare('INSERT OR IGNORE INTO categories(slug, name, name_bn) VALUES (?,?,?)');
  const getCat = db.prepare('SELECT id FROM categories WHERE slug = ?');
  const insFn = db.prepare(
    'INSERT OR IGNORE INTO common_functions(category_id, slug, name, name_bn, short_description) VALUES (?,?,?,?,?)',
  );
  db.transaction(() => {
    tax.categories.forEach((cat, ci) => {
      c += insCat.run(cat.slug, cat.name, cat.name_bn ?? null).changes;
      const catId = (getCat.get(cat.slug) as { id: number }).id;
      db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id, display_order) VALUES ('category', ?, ?)").run(catId, (ci + 1) * 10);
      cat.functions.forEach(([slug, name, nameBn, desc], fi) => {
        const r = insFn.run(catId, slug, name, nameBn, desc);
        f += r.changes;
        if (r.changes)
          db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id, display_order) VALUES ('common_function', ?, ?)").run(
            Number(r.lastInsertRowid),
            (fi + 1) * 10,
          );
      });
    });
  })();
  return { categories: c, functions: f };
}

/**
 * Creates the initial Super Admin ONLY when no Super Admin exists (§32.4).
 * Never resets an existing account or password. Password comes from env, never logged.
 */
export async function bootstrapSuperAdmin(db: DB): Promise<{ created: boolean; message: string }> {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get();
  if (existing) return { created: false, message: 'Super Admin already exists' };
  const email = config.initialAdminEmail;
  const pw = config.initialAdminPassword;
  if (!email || !isValidEmail(normalizeEmail(email)))
    return { created: false, message: 'INITIAL_SUPERADMIN_EMAIL not set or invalid — no Super Admin created' };
  if (!pw || passwordProblems(pw).length)
    return { created: false, message: 'INITIAL_SUPERADMIN_PASSWORD not set or too weak — no Super Admin created' };
  const hash = await hashPassword(pw);
  const norm = normalizeEmail(email);
  // If a normal user already registered with this email, do not silently promote — require manual action.
  const clash = db.prepare('SELECT id FROM users WHERE email_normalized = ?').get(norm);
  if (clash) return { created: false, message: 'A user with INITIAL_SUPERADMIN_EMAIL already exists; refusing to modify it automatically' };
  db.prepare(
    `INSERT INTO users(email, email_normalized, password_hash, role, status, must_change_password, display_name)
     VALUES (?,?,?,'super_admin','enabled',1,'Super Admin')`,
  ).run(email.trim(), norm, hash);
  return { created: true, message: `Initial Super Admin created (${norm}); password change required at first login` };
}
