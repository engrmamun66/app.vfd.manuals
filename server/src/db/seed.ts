import fs from 'node:fs';
import { config } from '../config.js';
import type { DB } from './index.js';
import { hashPassword, isValidEmail, normalizeEmail, passwordProblems } from '../auth/password.js';

interface Taxonomy {
  categories: { slug: string; name: string; name_bn?: string; display_order?: number; includes_functions?: string[]; functions: [string, string, string, string][] }[];
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
      db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id, display_order) VALUES ('category', ?, ?)").run(catId, cat.display_order ?? (ci + 1) * 10);
      // a category that groups parameters of other categories (e.g. "Basic Parameters"): membership follows the common function
      if (cat.includes_functions?.length) {
        const ph = cat.includes_functions.map(() => '?').join(',');
        db.prepare('DELETE FROM category_parameters WHERE category_id = ?').run(catId); // the list in taxonomy.json is authoritative
        db.prepare(
          `INSERT OR IGNORE INTO category_parameters(category_id, parameter_id)
           SELECT ?, p.id FROM parameters p JOIN common_functions f ON f.id = p.common_function_id WHERE f.slug IN (${ph})`,
        ).run(catId, ...cat.includes_functions);
      }
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

/** Applies data/function-links.json (secondary common-function links). Idempotent; links whose parameter or function is not present yet are skipped. */
export function applyFunctionLinks(db: DB) {
  if (!fs.existsSync(config.functionLinksFile)) return 0;
  const file = JSON.parse(fs.readFileSync(config.functionLinksFile, 'utf8')) as { links: { model: string; code: string; function: string; equivalence?: string; note?: string }[] };
  const find = db.prepare('SELECT p.id FROM parameters p JOIN models m ON m.id = p.model_id WHERE m.name LIKE ? AND p.code = ? LIMIT 1');
  const fn = db.prepare('SELECT id FROM common_functions WHERE slug = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO parameter_function_links(parameter_id, function_id, equivalence, note) VALUES (?,?,?,?)');
  let n = 0;
  db.transaction(() => {
    for (const l of file.links) {
      const p = find.get(`${l.model}%`, l.code) as { id: number } | undefined;
      const f = fn.get(l.function) as { id: number } | undefined;
      if (p && f) n += ins.run(p.id, f.id, l.equivalence ?? null, l.note ?? null).changes;
    }
  })();
  return n;
}

/**
 * Creates the initial Super Admin ONLY when no Super Admin exists (§32.4).
 * Never resets an existing account or password. Password comes from env, never logged.
 */
export async function bootstrapSuperAdmin(db: DB): Promise<{ created: boolean; message: string }> {
  const existing = db.prepare("SELECT id, email_normalized, password_hash FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1").get() as
    | { id: number; email_normalized: string; password_hash: string }
    | undefined;
  if (existing) {
    // Owner request: .env credentials are the source of truth for the first Super Admin (synced on every start).
    const e = config.initialAdminEmail;
    const p = config.initialAdminPassword;
    if (e && p && isValidEmail(normalizeEmail(e)) && !passwordProblems(p).length) {
      const norm = normalizeEmail(e);
      const other = db.prepare('SELECT id FROM users WHERE email_normalized = ? AND id <> ?').get(norm, existing.id);
      const { verifyPassword } = await import('../auth/password.js');
      const pwSame = await verifyPassword(existing.password_hash, p);
      if (!other && (existing.email_normalized !== norm || !pwSame)) {
        db.prepare(
          "UPDATE users SET email = ?, email_normalized = ?, password_hash = ?, must_change_password = 0, status = 'enabled' WHERE id = ?",
        ).run(e.trim(), norm, pwSame ? existing.password_hash : await hashPassword(p), existing.id);
        return { created: false, message: `Super Admin credentials synced from .env (${norm})` };
      }
    }
    return { created: false, message: 'Super Admin already exists' };
  }
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
