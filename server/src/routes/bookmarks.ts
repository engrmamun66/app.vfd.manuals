import { Router } from 'express';
import { getDb, type DB } from '../db/index.js';
import { ah, badRequest, bool, conflict, intParam, notFound, oneOf, str } from '../lib/http.js';
import { logActivity } from '../lib/audit.js';
import { json, parseJson } from '../lib/util.js';

/** Research bookmarks: private per user. Every query is scoped by the session user id (IDOR-safe). */
export const bookmarksRouter = Router();

function ownFolder(db: DB, userId: number, id: number | null) {
  if (id === null) return null;
  const f = db.prepare('SELECT * FROM research_bookmark_folders WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!f) throw notFound('Folder not found');
  return f;
}
function ownBookmark(db: DB, userId: number, id: number) {
  const b = db.prepare('SELECT * FROM research_bookmarks WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!b) throw notFound('Bookmark not found');
  return b;
}
function isDescendant(db: DB, userId: number, folderId: number, possibleAncestor: number): boolean {
  const row = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM research_bookmark_folders WHERE id = ? AND user_id = ?
         UNION ALL SELECT f.id, f.parent_id FROM research_bookmark_folders f JOIN up ON f.id = up.parent_id WHERE f.user_id = ?)
       SELECT 1 FROM up WHERE id = ? LIMIT 1`,
    )
    .get(folderId, userId, userId, possibleAncestor);
  return !!row;
}
const safeUrl = (u: string) => {
  if (!u.startsWith('/') || u.startsWith('//')) throw badRequest('research_url must be an internal application path');
  return u.slice(0, 2000);
};

bookmarksRouter.get(
  '/folders',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    res.json(
      db
        .prepare(
          `SELECT f.*, (SELECT COUNT(*) FROM research_bookmarks b WHERE b.folder_id = f.id AND b.user_id = f.user_id) bookmark_count
           FROM research_bookmark_folders f WHERE f.user_id = ? ORDER BY f.parent_id, f.display_order, f.name`,
        )
        .all(uid),
    );
  }),
);

bookmarksRouter.post(
  '/folders',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const name = str(req.body.name, 'name', { required: true, max: 150 })!;
    const parent = intParam(req.body.parent_id, 'parent_id');
    ownFolder(db, uid, parent);
    const max = db.prepare('SELECT COALESCE(MAX(display_order),0) m FROM research_bookmark_folders WHERE user_id = ? AND parent_id IS ?').get(uid, parent) as any;
    const id = Number(
      db.prepare('INSERT INTO research_bookmark_folders(user_id, parent_id, name, description, display_order) VALUES (?,?,?,?,?)').run(uid, parent, name, str(req.body.description, 'description', { max: 1000 }), max.m + 10).lastInsertRowid,
    );
    logActivity({ userId: uid, event: 'bookmark_folder_create', entityType: 'bookmark_folder', entityId: id });
    res.status(201).json({ id });
  }),
);

bookmarksRouter.patch(
  '/folders/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const id = intParam(req.params.id, 'id', { required: true })!;
    const f = ownFolder(db, uid, id);
    let parent = f.parent_id;
    if ('parent_id' in req.body) {
      parent = intParam(req.body.parent_id, 'parent_id');
      ownFolder(db, uid, parent);
      if (parent !== null && (parent === id || isDescendant(db, uid, parent, id))) throw badRequest('A folder cannot be moved into itself or one of its subfolders');
    }
    const name = req.body.name !== undefined ? str(req.body.name, 'name', { required: true, max: 150 }) : f.name;
    const desc = req.body.description !== undefined ? str(req.body.description, 'description', { max: 1000 }) : f.description;
    const order = req.body.display_order !== undefined ? intParam(req.body.display_order, 'display_order') : f.display_order;
    db.prepare('UPDATE research_bookmark_folders SET name = ?, description = ?, parent_id = ?, display_order = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      name,
      desc,
      parent,
      order,
      new Date().toISOString(),
      id,
      uid,
    );
    logActivity({ userId: uid, event: parent !== f.parent_id ? 'bookmark_folder_move' : 'bookmark_folder_update', entityType: 'bookmark_folder', entityId: id });
    res.json({ ok: true });
  }),
);

/** Reorder siblings: body { parent_id, orderedIds: [folderId...] } */
bookmarksRouter.post(
  '/folders/reorder',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const ids: number[] = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(Number) : [];
    db.transaction(() => ids.forEach((id, i) => db.prepare('UPDATE research_bookmark_folders SET display_order = ? WHERE id = ? AND user_id = ?').run((i + 1) * 10, id, uid)))();
    res.json({ ok: true });
  }),
);

/** Delete a folder. Non-empty folders require an explicit destination for their contents (never silent deletion). */
bookmarksRouter.delete(
  '/folders/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const id = intParam(req.params.id, 'id', { required: true })!;
    const f = ownFolder(db, uid, id);
    const children = (db.prepare('SELECT COUNT(*) c FROM research_bookmark_folders WHERE parent_id = ? AND user_id = ?').get(id, uid) as any).c;
    const marks = (db.prepare('SELECT COUNT(*) c FROM research_bookmarks WHERE folder_id = ? AND user_id = ?').get(id, uid) as any).c;
    const moveTo = req.query.moveTo === 'parent' ? f.parent_id : req.query.moveTo === 'root' ? null : req.query.moveTo !== undefined ? intParam(req.query.moveTo, 'moveTo') : undefined;
    if ((children || marks) && moveTo === undefined)
      throw conflict('Folder is not empty. Choose where to move its contents (moveTo=parent | root | <folderId>).', { subfolders: children, bookmarks: marks });
    if (moveTo !== undefined && moveTo !== null) {
      ownFolder(db, uid, moveTo);
      if (moveTo === id || isDescendant(db, uid, moveTo, id)) throw badRequest('Destination cannot be the folder being deleted or one of its subfolders');
    }
    db.transaction(() => {
      if (moveTo !== undefined) {
        db.prepare('UPDATE research_bookmark_folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?').run(moveTo, id, uid);
        db.prepare('UPDATE research_bookmarks SET folder_id = ? WHERE folder_id = ? AND user_id = ?').run(moveTo, id, uid);
      }
      db.prepare('DELETE FROM research_bookmark_folders WHERE id = ? AND user_id = ?').run(id, uid);
    })();
    logActivity({ userId: uid, event: 'bookmark_folder_delete', entityType: 'bookmark_folder', entityId: id, meta: { movedContentsTo: moveTo ?? null } });
    res.json({ ok: true });
  }),
);

function withTags(db: DB, rows: any[]) {
  const tagStmt = db.prepare('SELECT t.name FROM research_bookmark_tag_relations r JOIN research_bookmark_tags t ON t.id=r.tag_id WHERE r.bookmark_id = ?');
  return rows.map((b) => ({ ...b, context: parseJson(b.context_json, null), context_json: undefined, tags: (tagStmt.all(b.id) as any[]).map((t) => t.name) }));
}
function setTags(db: DB, uid: number, bookmarkId: number, tags: unknown) {
  if (!Array.isArray(tags)) return;
  db.prepare('DELETE FROM research_bookmark_tag_relations WHERE bookmark_id = ?').run(bookmarkId);
  for (const t of tags.slice(0, 20)) {
    const name = String(t).trim().slice(0, 50);
    if (!name) continue;
    db.prepare('INSERT OR IGNORE INTO research_bookmark_tags(user_id, name) VALUES (?,?)').run(uid, name);
    const tag = db.prepare('SELECT id FROM research_bookmark_tags WHERE user_id = ? AND name = ?').get(uid, name) as any;
    db.prepare('INSERT OR IGNORE INTO research_bookmark_tag_relations(bookmark_id, tag_id) VALUES (?,?)').run(bookmarkId, tag.id);
  }
}

/** Resolves whether the bookmark's underlying record still exists (never redirects to a different record). */
function targetStatus(db: DB, b: any) {
  const tables: Record<string, string> = { parameter: 'parameters', modbus_register: 'modbus_registers', model: 'models', document_page: 'document_revisions', common_function: 'common_functions', brand: 'brands' };
  const t = tables[b.entity_type];
  if (!t || !b.entity_id) return 'ok';
  return db.prepare(`SELECT 1 FROM ${t} WHERE id = ?`).get(b.entity_id) ? 'ok' : 'unavailable';
}

bookmarksRouter.get(
  '/',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const q = req.query as any;
    const where = ['b.user_id = ?'];
    const args: unknown[] = [uid];
    if (q.folder === 'root') where.push('b.folder_id IS NULL');
    else if (q.folder) (where.push('b.folder_id = ?'), args.push(Number(q.folder)));
    if (q.favorite === '1') where.push('b.favorite = 1');
    if (q.q) {
      const like = `%${String(q.q).slice(0, 100)}%`;
      where.push('(b.name LIKE ? OR b.description LIKE ? OR b.notes LIKE ? OR EXISTS (SELECT 1 FROM research_bookmark_tag_relations r JOIN research_bookmark_tags t ON t.id=r.tag_id WHERE r.bookmark_id=b.id AND t.name LIKE ?))');
      args.push(like, like, like, like);
    }
    const sort = q.sort === 'name' ? 'b.name COLLATE NOCASE' : q.sort === 'date' ? 'b.created_at DESC' : q.sort === 'opened' ? 'b.last_opened_at DESC' : 'b.display_order, b.created_at DESC';
    const limit = Math.min(Number(q.limit) || 500, 2000);
    const rows = db
      .prepare(
        `SELECT b.*, br.name brand_name, m.name model_name FROM research_bookmarks b LEFT JOIN brands br ON br.id=b.brand_id LEFT JOIN models m ON m.id=b.model_id
         WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ?`,
      )
      .all(...args, limit) as any[];
    res.json(withTags(db, rows).map((b) => ({ ...b, target_status: targetStatus(db, b) })));
  }),
);

bookmarksRouter.post(
  '/',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const name = str(req.body.name, 'name', { required: true, max: 200 })!;
    const url = safeUrl(str(req.body.research_url, 'research_url', { required: true, max: 2000 })!);
    const folder = intParam(req.body.folder_id, 'folder_id');
    ownFolder(db, uid, folder);
    const dup = db.prepare('SELECT id FROM research_bookmarks WHERE user_id = ? AND research_url = ? AND name = ? AND folder_id IS ?').get(uid, url, name, folder);
    if (dup && !bool(req.body.allowDuplicate)) throw conflict('An identical bookmark (same name, URL and folder) already exists', { existingId: (dup as any).id });
    const ctx = req.body.context && typeof req.body.context === 'object' ? req.body.context : null;
    const brandId = intParam(ctx?.brandId ?? req.body.brand_id, 'brand_id');
    const modelId = intParam(ctx?.modelId ?? req.body.model_id, 'model_id');
    const entityType = ctx?.entityType ? String(ctx.entityType).slice(0, 40) : null;
    const entityId = intParam(ctx?.entityId, 'entityId');
    const max = db.prepare('SELECT COALESCE(MAX(display_order),0) m FROM research_bookmarks WHERE user_id = ? AND folder_id IS ?').get(uid, folder) as any;
    const id = db.transaction(() => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO research_bookmarks(user_id, folder_id, name, description, notes, research_url, context_json, brand_id, model_id, entity_type, entity_id, research_depth, favorite, display_order)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            uid,
            folder,
            name,
            str(req.body.description, 'description', { max: 2000 }),
            str(req.body.notes, 'notes', { max: 10000 }),
            url,
            json(ctx),
            brandId && db.prepare('SELECT 1 FROM brands WHERE id=?').get(brandId) ? brandId : null,
            modelId && db.prepare('SELECT 1 FROM models WHERE id=?').get(modelId) ? modelId : null,
            entityType,
            entityId,
            ctx?.depth ? String(ctx.depth).slice(0, 40) : null,
            bool(req.body.favorite) ? 1 : 0,
            max.m + 10,
          ).lastInsertRowid,
      );
      setTags(db, uid, id, req.body.tags);
      return id;
    })();
    logActivity({ userId: uid, event: 'bookmark_create', entityType: 'bookmark', entityId: id });
    res.status(201).json({ id });
  }),
);

bookmarksRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const id = intParam(req.params.id, 'id', { required: true })!;
    const b = ownBookmark(db, uid, id);
    const folder = 'folder_id' in req.body ? intParam(req.body.folder_id, 'folder_id') : b.folder_id;
    ownFolder(db, uid, folder);
    db.transaction(() => {
      db.prepare('UPDATE research_bookmarks SET name = ?, description = ?, notes = ?, folder_id = ?, favorite = ?, display_order = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
        req.body.name !== undefined ? str(req.body.name, 'name', { required: true, max: 200 }) : b.name,
        req.body.description !== undefined ? str(req.body.description, 'description', { max: 2000 }) : b.description,
        req.body.notes !== undefined ? str(req.body.notes, 'notes', { max: 10000 }) : b.notes,
        folder,
        req.body.favorite !== undefined ? (bool(req.body.favorite) ? 1 : 0) : b.favorite,
        req.body.display_order !== undefined ? intParam(req.body.display_order, 'display_order') : b.display_order,
        new Date().toISOString(),
        id,
        uid,
      );
      setTags(db, uid, id, req.body.tags);
    })();
    logActivity({ userId: uid, event: folder !== b.folder_id ? 'bookmark_move' : 'bookmark_update', entityType: 'bookmark', entityId: id });
    res.json({ ok: true });
  }),
);

bookmarksRouter.post(
  '/reorder',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const ids: number[] = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(Number) : [];
    db.transaction(() => ids.forEach((id, i) => db.prepare('UPDATE research_bookmarks SET display_order = ? WHERE id = ? AND user_id = ?').run((i + 1) * 10, id, uid)))();
    res.json({ ok: true });
  }),
);

bookmarksRouter.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const b = ownBookmark(db, uid, intParam(req.params.id, 'id', { required: true })!);
    const newName = str(req.body.name, 'name', { max: 200 }) ?? `${b.name} (copy)`;
    const id = Number(
      db
        .prepare(
          `INSERT INTO research_bookmarks(user_id, folder_id, name, description, notes, research_url, context_json, brand_id, model_id, entity_type, entity_id, research_depth, favorite, display_order)
           SELECT user_id, folder_id, ?, description, notes, research_url, context_json, brand_id, model_id, entity_type, entity_id, research_depth, 0, display_order + 1 FROM research_bookmarks WHERE id = ? AND user_id = ?`,
        )
        .run(newName, b.id, uid).lastInsertRowid,
    );
    logActivity({ userId: uid, event: 'bookmark_duplicate', entityType: 'bookmark', entityId: id });
    res.status(201).json({ id });
  }),
);

bookmarksRouter.post(
  '/:id/open',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const b = ownBookmark(db, uid, intParam(req.params.id, 'id', { required: true })!);
    const now = new Date().toISOString();
    db.prepare('UPDATE research_bookmarks SET last_opened_at = ? WHERE id = ? AND user_id = ?').run(now, b.id, uid);
    db.prepare('INSERT INTO research_bookmark_history(user_id, bookmark_id) VALUES (?,?)').run(uid, b.id);
    res.json({ research_url: b.research_url, target_status: targetStatus(db, b) });
  }),
);

bookmarksRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const b = ownBookmark(db, uid, intParam(req.params.id, 'id', { required: true })!);
    db.transaction(() => {
      db.prepare('DELETE FROM research_bookmark_tag_relations WHERE bookmark_id = ?').run(b.id);
      db.prepare('DELETE FROM research_bookmark_history WHERE bookmark_id = ? AND user_id = ?').run(b.id, uid);
      db.prepare('DELETE FROM research_bookmarks WHERE id = ? AND user_id = ?').run(b.id, uid);
    })();
    logActivity({ userId: uid, event: 'bookmark_delete', entityType: 'bookmark', entityId: b.id, meta: { name: b.name } });
    res.json({ ok: true });
  }),
);

bookmarksRouter.get(
  '/recent-opened',
  ah(async (req, res) => {
    res.json(
      getDb()
        .prepare(
          `SELECT b.id, b.name, b.research_url, MAX(h.opened_at) opened_at FROM research_bookmark_history h JOIN research_bookmarks b ON b.id=h.bookmark_id
           WHERE h.user_id = ? AND b.user_id = ? GROUP BY b.id ORDER BY opened_at DESC LIMIT 20`,
        )
        .all(req.user!.id, req.user!.id),
    );
  }),
);

export const _test = { isDescendant, oneOf };
