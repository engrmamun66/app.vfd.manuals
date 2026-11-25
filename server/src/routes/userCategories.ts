import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ah, badRequest, conflict, intParam, notFound, str } from '../lib/http.js';
import { logActivity } from '../lib/audit.js';
import { assertFeature } from '../services/premium.js';

/**
 * Personal parameter categories. Every query is scoped by the session user id (other users never see them).
 * Names are unique per user (case-insensitive) and may not equal a system category name.
 */
export const userCategoriesRouter = Router();

const MAX_PER_USER = 100;
const key = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const slugKey = (s: string) => key(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function cleanName(v: unknown) {
  const raw = str(v, 'name', { required: true, max: 60 })!;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) throw badRequest('Category name is required');
  return name;
}

function assertNotSystem(name: string) {
  const k = key(name);
  const sk = slugKey(name);
  const hit = (getDb().prepare('SELECT name, slug FROM categories').all() as { name: string; slug: string }[]).find((c) => key(c.name) === k || (sk && c.slug.toLowerCase() === sk));
  if (hit) throw conflict(`“${hit.name}” is a system category name. Please choose a different name.`);
}

userCategoriesRouter.get(
  '/',
  ah(async (req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT c.id, c.name, (SELECT COUNT(*) FROM parameter_user_categories x WHERE x.user_category_id = c.id) count
         FROM user_categories c WHERE c.user_id = ? ORDER BY c.sort_order, c.id`,
      )
      .all(req.user!.id);
    res.json({ rows });
  }),
);

userCategoriesRouter.post(
  '/',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    assertFeature(req.user!, 'lock_custom_category', 'Custom categories are a Pro feature. Upgrade to create your own categories.');
    const name = cleanName(req.body?.name);
    assertNotSystem(name);
    if ((db.prepare('SELECT COUNT(*) c FROM user_categories WHERE user_id = ?').get(uid) as any).c >= MAX_PER_USER) throw conflict(`You can create at most ${MAX_PER_USER} categories`);
    if (db.prepare('SELECT 1 FROM user_categories WHERE user_id = ? AND name_key = ?').get(uid, key(name))) throw conflict('You already have a category with this name');
    const id = Number(db.prepare('INSERT INTO user_categories(user_id, name, name_key, sort_order) VALUES (?,?,?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM user_categories WHERE user_id = ?))').run(uid, name, key(name), uid).lastInsertRowid);
    logActivity({ userId: uid, event: 'user_category_create', entityType: 'user_category', entityId: id });
    res.status(201).json({ id, name, count: 0 });
  }),
);

/** Priority order of the caller's categories (sidebar / lists follow it). Unlisted categories keep their relative order after the listed ones. */
userCategoriesRouter.put(
  '/order',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > MAX_PER_USER) throw badRequest('ids must be an array');
    const want = [...new Set(ids.map((x) => Number(x)))];
    const all = (db.prepare('SELECT id FROM user_categories WHERE user_id = ? ORDER BY sort_order, id').all(uid) as { id: number }[]).map((r) => r.id);
    if (want.some((x) => !all.includes(x))) throw notFound('Category not found');
    const final = [...want, ...all.filter((x) => !want.includes(x))];
    const upd = db.prepare('UPDATE user_categories SET sort_order = ? WHERE id = ? AND user_id = ?');
    db.transaction(() => final.forEach((id, i) => upd.run(i + 1, id, uid)))();
    res.json({ ids: final });
  }),
);

function own(uid: number, id: number) {
  const c = getDb().prepare('SELECT * FROM user_categories WHERE id = ? AND user_id = ?').get(id, uid) as any;
  if (!c) throw notFound('Category not found');
  return c;
}

userCategoriesRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const c = own(uid, intParam(req.params.id, 'id', { required: true })!);
    const name = cleanName(req.body?.name);
    assertNotSystem(name);
    if (db.prepare('SELECT 1 FROM user_categories WHERE user_id = ? AND name_key = ? AND id <> ?').get(uid, key(name), c.id)) throw conflict('You already have a category with this name');
    db.prepare('UPDATE user_categories SET name = ?, name_key = ? WHERE id = ? AND user_id = ?').run(name, key(name), c.id, uid);
    res.json({ ok: true, name });
  }),
);

userCategoriesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const uid = req.user!.id;
    const c = own(uid, intParam(req.params.id, 'id', { required: true })!);
    getDb().prepare('DELETE FROM user_categories WHERE id = ? AND user_id = ?').run(c.id, uid); // assignments cascade
    logActivity({ userId: uid, event: 'user_category_delete', entityType: 'user_category', entityId: c.id });
    res.json({ ok: true });
  }),
);

/** The caller's categories assigned to one parameter. */
userCategoriesRouter.get(
  '/for-parameter/:pid',
  ah(async (req, res) => {
    const pid = intParam(req.params.pid, 'pid', { required: true })!;
    const ids = getDb()
      .prepare('SELECT x.user_category_id id FROM parameter_user_categories x JOIN user_categories c ON c.id = x.user_category_id WHERE x.parameter_id = ? AND c.user_id = ?')
      .all(pid, req.user!.id)
      .map((r: any) => r.id);
    res.json({ ids });
  }),
);

/** Replaces the caller's category set for one parameter (any number of categories). */
userCategoriesRouter.put(
  '/for-parameter/:pid',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    assertFeature(req.user!, 'lock_custom_category', 'Custom categories are a Pro feature. Upgrade to assign your own categories.');
    const pid = intParam(req.params.pid, 'pid', { required: true })!;
    if (!db.prepare('SELECT 1 FROM parameters WHERE id = ?').get(pid)) throw notFound('Parameter not found');
    const ids: unknown = req.body?.categoryIds;
    if (!Array.isArray(ids) || ids.length > MAX_PER_USER) throw badRequest('categoryIds must be an array');
    const want = [...new Set(ids.map((x) => Number(x)))];
    if (want.some((x) => !Number.isInteger(x))) throw badRequest('categoryIds must be integers');
    const owned = new Set((db.prepare('SELECT id FROM user_categories WHERE user_id = ?').all(uid) as { id: number }[]).map((r) => r.id));
    if (want.some((x) => !owned.has(x))) throw notFound('Category not found');
    db.transaction(() => {
      db.prepare('DELETE FROM parameter_user_categories WHERE parameter_id = ? AND user_category_id IN (SELECT id FROM user_categories WHERE user_id = ?)').run(pid, uid);
      const ins = db.prepare('INSERT INTO parameter_user_categories(user_category_id, parameter_id) VALUES (?,?)');
      for (const c of want) ins.run(c, pid);
    })();
    res.json({ ids: want });
  }),
);
