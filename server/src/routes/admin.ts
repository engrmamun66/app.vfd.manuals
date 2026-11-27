import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { ah, badRequest, conflict, intParam, notFound, oneOf, paging, str, bool } from '../lib/http.js';
import { audit, logActivity } from '../lib/audit.js';
import { hashPassword, isValidEmail, normalizeEmail, passwordProblems } from '../auth/password.js';
import { createImpersonationSession, IMPERSONATION_TTL_MS, revokeSessions } from '../auth/sessions.js';
import { getAllAppSettings, setAppSetting, userLimits } from '../services/settings.js';
import { ensureUserDirs, reconcileStorage, storageUsage } from '../services/storage.js';
import { presenceSnapshot } from '../services/presence.js';
import { createBackup, listBackups, verifyBackup } from '../services/backup.js';
import { parseJson } from '../lib/util.js';

/** Super Admin only (router mounted behind requireSuperAdmin). */
export const adminRouter = Router();

const activeSuperAdmins = () => (getDb().prepare("SELECT COUNT(*) c FROM users WHERE role='super_admin' AND status='enabled'").get() as any).c as number;

// ---------------- users ----------------
adminRouter.get(
  '/users',
  ah(async (req, res) => {
    const db = getDb();
    const q = req.query as any;
    const where = ['1=1'];
    const args: unknown[] = [];
    if (q.q) (where.push('(u.email LIKE ? OR u.display_name LIKE ? OR u.company LIKE ?)'), args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`));
    if (q.status) (where.push('u.status = ?'), args.push(String(q.status)));
    if (q.role) (where.push('u.role = ?'), args.push(String(q.role)));
    const now = new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.role, u.status, u.phone, u.company, u.designation, u.created_at, u.last_login_at, u.login_count, u.must_change_password, u.full_access_until,
           (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at > ?) active_sessions,
           (SELECT COUNT(*) FROM research_annotations a WHERE a.user_id=u.id) annotations_total,
           (SELECT COUNT(*) FROM research_annotations a WHERE a.user_id=u.id AND a.comment_text IS NOT NULL AND a.deletion_status='active') comments_active,
           (SELECT COUNT(*) FROM research_annotations a WHERE a.user_id=u.id AND a.deletion_status='trashed') annotations_trashed,
           (SELECT COUNT(*) FROM research_annotations a WHERE a.user_id=u.id AND a.highlight_color IS NOT NULL AND a.deletion_status='active') highlights,
           (SELECT COUNT(*) FROM research_bookmarks b WHERE b.user_id=u.id) bookmarks,
           (SELECT COUNT(*) FROM research_bookmark_folders f WHERE f.user_id=u.id) folders,
           (SELECT COUNT(*) FROM user_uploads up WHERE up.user_id=u.id AND up.purged_at IS NULL) files,
           (SELECT COALESCE(SUM(size_bytes + thumbnail_bytes),0) FROM user_uploads up WHERE up.user_id=u.id AND up.purged_at IS NULL) storage_bytes
         FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id`,
      )
      .all(now, ...args) as any[];
    const sortKey = String(q.sort || '');
    if (['storage_bytes', 'last_login_at', 'created_at', 'files', 'comments_active'].includes(sortKey)) rows.sort((a, b) => (b[sortKey] ?? '') > (a[sortKey] ?? '') ? 1 : -1);
    res.json(rows.map((r) => ({ ...r, quota_bytes: userLimits(r.id).quotaBytes })));
  }),
);

adminRouter.get(
  '/users/summary',
  ah(async (_req, res) => {
    const db = getDb();
    const now = new Date().toISOString();
    res.json({
      total: (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c,
      enabled: (db.prepare("SELECT COUNT(*) c FROM users WHERE status='enabled'").get() as any).c,
      disabled: (db.prepare("SELECT COUNT(*) c FROM users WHERE status='disabled'").get() as any).c,
      neverLoggedIn: (db.prepare('SELECT COUNT(*) c FROM users WHERE last_login_at IS NULL').get() as any).c,
      recentRegistrations: db.prepare('SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 10').all(),
      activeSessions: (db.prepare('SELECT COUNT(*) c FROM user_sessions WHERE revoked_at IS NULL AND expires_at > ?').get(now) as any).c,
      lastLogins: db.prepare('SELECT id, email, last_login_at FROM users WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 10').all(),
      presence: presenceSnapshot(),
    });
  }),
);

adminRouter.get(
  '/users/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const u = db.prepare('SELECT id, email, display_name, role, status, phone, company, designation, created_at, updated_at, last_login_at, login_count, failed_login_count, must_change_password, full_access_until FROM users WHERE id = ?').get(id) as any;
    if (!u) throw notFound('User not found');
    const lim = userLimits(id);
    const usage = storageUsage(id);
    res.json({
      ...u,
      limits: lim,
      storage: { ...usage, remaining: Math.max(0, lim.quotaBytes - usage.total), percent: +((usage.total / lim.quotaBytes) * 100).toFixed(2) },
      sessions: db.prepare('SELECT id, created_at, expires_at, last_seen_at, user_agent, ip, revoked_at, revoke_reason FROM user_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(id),
      loginHistory: db.prepare('SELECT success, reason, ip, user_agent, created_at FROM user_login_history WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(id),
      // counts only — private content itself is not exposed here
      counts: db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM research_annotations WHERE user_id=@id) annotations,
                  (SELECT COUNT(*) FROM research_annotations WHERE user_id=@id AND visibility='public') public_annotations,
                  (SELECT COUNT(*) FROM research_bookmarks WHERE user_id=@id) bookmarks,
                  (SELECT COUNT(*) FROM research_bookmark_folders WHERE user_id=@id) folders`,
        )
        .get({ id }),
      presence: presenceSnapshot().connections.filter((c) => c.userId === id),
    });
  }),
);

adminRouter.get(
  '/users/:id/storage/reconcile',
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    if (!getDb().prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound();
    res.json({ metadata: storageUsage(id), filesystem: reconcileStorage(id) });
  }),
);

adminRouter.post(
  '/users',
  ah(async (req, res) => {
    const db = getDb();
    const emailRaw = str(req.body.email, 'email', { required: true, max: 254 })!;
    const email = normalizeEmail(emailRaw);
    if (!isValidEmail(email)) throw badRequest('Invalid email');
    const role = oneOf(req.body.role, 'role', ['user', 'super_admin'] as const, 'user');
    const pw = String(req.body.password || '');
    const problems = passwordProblems(pw, email);
    if (problems.length) throw badRequest(problems.join(' '));
    if (db.prepare('SELECT 1 FROM users WHERE email_normalized = ?').get(email)) throw conflict('A user with this email already exists');
    // only one Super Admin is active at a time: a new one starts inactive and has to be activated explicitly
    const startStatus = role === 'super_admin' && activeSuperAdmins() > 0 ? 'disabled' : 'enabled';
    const id = Number(
      db
        .prepare("INSERT INTO users(email, email_normalized, password_hash, role, status, must_change_password, display_name, company, designation, phone) VALUES (?,?,?,?, ?, 1, ?,?,?,?)")
        .run(emailRaw, email, await hashPassword(pw), role, startStatus, str(req.body.displayName, 'Full name', { required: true, max: 100 })!, str(req.body.company, 'company', { max: 150 }), str(req.body.designation, 'designation', { max: 150 }), str(req.body.phone, 'phone', { max: 30 })).lastInsertRowid,
    );
    ensureUserDirs(id);
    logActivity({ userId: id, actorUserId: req.user!.id, event: 'admin_create_user', entityType: 'user', entityId: id, meta: { role } });
    res.status(201).json({ id });
  }),
);

adminRouter.patch(
  '/users/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!u) throw notFound();
    const reason = str(req.body.reason, 'reason', { max: 500 });
    const changes: Record<string, unknown> = {};
    if (req.body.status !== undefined) changes.status = oneOf(req.body.status, 'status', ['enabled', 'disabled'] as const);
    if (req.body.role !== undefined) changes.role = oneOf(req.body.role, 'role', ['user', 'super_admin'] as const);
    if (req.body.displayName !== undefined) changes.display_name = str(req.body.displayName, 'displayName', { max: 100 });
    // free full-access end date (null / empty = none)
    if (req.body.fullAccessUntil !== undefined) {
      const raw = req.body.fullAccessUntil;
      if (raw === null || raw === '') changes.full_access_until = null;
      else {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) throw badRequest('Invalid full-access date');
        changes.full_access_until = d.toISOString();
      }
    }
    // promoting someone to Super Admin does not make a second active Super Admin: the account stays inactive until it is activated
    if (changes.role === 'super_admin' && u.role !== 'super_admin' && changes.status === undefined && u.status === 'enabled' && activeSuperAdmins() > 0) changes.status = 'disabled';
    const losingAdmin = u.role === 'super_admin' && u.status === 'enabled' && (changes.status === 'disabled' || changes.role === 'user');
    if (losingAdmin && activeSuperAdmins() <= 1) throw conflict('This is the last active Super Admin. Create or enable another Super Admin first.');
    if (!Object.keys(changes).length) throw badRequest('Nothing to update');
    db.prepare(`UPDATE users SET ${Object.keys(changes).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(changes), new Date().toISOString(), id);
    // only one Super Admin is active: activating one deactivates every other Super Admin (their sessions end at once)
    const deactivated: number[] = [];
    if (changes.status === 'enabled' && (changes.role ?? u.role) === 'super_admin') {
      for (const o of db.prepare("SELECT id FROM users WHERE role = 'super_admin' AND status = 'enabled' AND id <> ?").all(id) as { id: number }[]) {
        db.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), o.id);
        revokeSessions({ userId: o.id }, 'superadmin_deactivated');
        logActivity({ userId: o.id, actorUserId: req.user!.id, event: 'admin_disable_account', entityType: 'user', entityId: o.id, meta: { reason: 'another Super Admin was activated' } });
        deactivated.push(o.id);
      }
    }
    let revoked: number[] = [];
    if (changes.status === 'disabled') revoked = revokeSessions({ userId: id }, 'account_disabled');
    else if (changes.role && changes.role !== u.role) revoked = revokeSessions({ userId: id }, 'role_changed'); // privilege change → new session required
    for (const k of Object.keys(changes))
      logActivity({
        userId: id,
        actorUserId: req.user!.id,
        event: k === 'status' ? (changes.status === 'disabled' ? 'admin_disable_account' : 'admin_enable_account') : k === 'role' ? 'admin_role_change' : 'admin_profile_change',
        entityType: 'user',
        entityId: id,
        meta: { from: u[k === 'display_name' ? 'display_name' : k], to: changes[k], reason, revokedSessions: revoked.length },
      });
    res.json({ ok: true, revokedSessions: revoked.length, deactivatedSuperAdmins: deactivated });
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const u = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as any;
    if (!u) throw notFound();
    // explicit password chosen by the Super Admin (validated like any password), or a generated one-time temporary password
    const chosen = typeof req.body?.password === 'string' && req.body.password !== '' ? req.body.password : null;
    if (chosen) {
      const problems = passwordProblems(chosen, u.email);
      if (problems.length) throw badRequest(problems.join(' '));
    }
    const mustChange = chosen ? req.body.mustChange !== false : true;
    const temp = chosen ?? crypto.randomBytes(9).toString('base64url') + 'a1!';
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(await hashPassword(temp), mustChange ? 1 : 0, new Date().toISOString(), id);
    revokeSessions({ userId: id }, 'admin_password_reset');
    logActivity({ userId: id, actorUserId: req.user!.id, event: 'admin_password_reset', entityType: 'user', entityId: id, meta: { chosenByAdmin: !!chosen, mustChange } });
    if (chosen) return res.json({ ok: true, mustChangePassword: mustChange, note: 'Password set. All sessions of this user were ended.' });
    res.json({ temporaryPassword: temp, note: 'Share this securely. It is not stored in plain text and will not be shown again.' });
  }),
);

// "Login as": Super Admin opens a short session as another user (their own session stays alive for "Return to admin")
adminRouter.post(
  '/users/:id/impersonate',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const u = db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(id) as any;
    if (!u) throw notFound();
    if (id === req.user!.id) throw badRequest('You are already signed in as this user.');
    if (u.role === 'super_admin') throw badRequest('Cannot sign in as another Super Admin.');
    if (u.status !== 'enabled') throw badRequest('This account is disabled. Enable it first.');
    if (req.sessionRow!.impersonator_user_id) throw badRequest('Already inside an impersonated session.');
    const s = createImpersonationSession(req, res, id, { userId: req.user!.id, sessionId: req.sessionRow!.id, expiresAt: req.sessionRow!.expires_at });
    logActivity({ userId: id, actorUserId: req.user!.id, event: 'impersonation_start', entityType: 'session', entityId: s.sessionId, meta: { ttlMinutes: IMPERSONATION_TTL_MS / 60000 } });
    res.json({ ok: true, email: u.email, expiresInMinutes: IMPERSONATION_TTL_MS / 60000 });
  }),
);

adminRouter.put(
  '/users/:id/limits',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound();
    const prev = userLimits(id);
    const q = intParam(req.body.quotaBytes, 'quotaBytes', { min: 0 });
    const f = intParam(req.body.maxFileBytes, 'maxFileBytes', { min: 1024 });
    const a = intParam(req.body.maxAttachmentsPerComment, 'maxAttachmentsPerComment', { min: 0, max: 100 });
    db.prepare(
      `INSERT INTO user_storage_limits(user_id, quota_bytes, max_file_bytes, max_attachments_per_comment, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET quota_bytes=excluded.quota_bytes, max_file_bytes=excluded.max_file_bytes, max_attachments_per_comment=excluded.max_attachments_per_comment, updated_at=excluded.updated_at`,
    ).run(id, q, f, a, new Date().toISOString());
    logActivity({ userId: id, actorUserId: req.user!.id, event: 'admin_quota_change', entityType: 'user', entityId: id, meta: { from: prev, to: userLimits(id) } });
    res.json(userLimits(id));
  }),
);

/** Remote logout: one session, or all sessions of a user. */
adminRouter.post(
  '/sessions/:id/revoke',
  ah(async (req, res) => {
    const db = getDb();
    const sid = intParam(req.params.id, 'id', { required: true })!;
    const s = db.prepare('SELECT s.id, s.user_id, u.role FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id = ?').get(sid) as any;
    if (!s) throw notFound('Session not found');
    if (s.id === req.sessionRow!.id) throw badRequest('Use Logout to end your own current session');
    const ids = revokeSessions({ sessionId: sid }, 'admin_remote_logout');
    logActivity({ userId: s.user_id, actorUserId: req.user!.id, event: 'admin_remote_logout', entityType: 'session', entityId: sid, meta: { reason: str(req.body?.reason, 'reason', { max: 500 }), revoked: ids.length } });
    res.json({ revoked: ids.length });
  }),
);
adminRouter.post(
  '/users/:id/revoke-all',
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    if (!getDb().prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound();
    const ids = revokeSessions({ userId: id, exceptSessionId: id === req.user!.id ? req.sessionRow!.id : undefined }, 'admin_remote_logout_all');
    logActivity({ userId: id, actorUserId: req.user!.id, event: 'admin_revoke_all_sessions', entityType: 'user', entityId: id, meta: { reason: str(req.body?.reason, 'reason', { max: 500 }), revoked: ids.length } });
    res.json({ revoked: ids.length });
  }),
);

adminRouter.get('/presence', ah(async (_req, res) => res.json(presenceSnapshot())));

// ---------------- logs ----------------
adminRouter.get(
  '/activity',
  ah(async (req, res) => {
    const db = getDb();
    const q = req.query as any;
    const { limit, offset } = paging(q, 100, 1000);
    const where = ['1=1'];
    const args: unknown[] = [];
    if (q.user) (where.push('(l.user_id = ? OR l.actor_user_id = ?)'), args.push(Number(q.user), Number(q.user)));
    if (q.event) (where.push('l.event_type LIKE ?'), args.push(`%${q.event}%`));
    if (q.from) (where.push('l.created_at >= ?'), args.push(String(q.from)));
    const total = (db.prepare(`SELECT COUNT(*) c FROM user_activity_logs l WHERE ${where.join(' AND ')}`).get(...args) as any).c;
    const rows = db
      .prepare(
        `SELECT l.*, u.email user_email, a.email actor_email FROM user_activity_logs l LEFT JOIN users u ON u.id=l.user_id LEFT JOIN users a ON a.id=l.actor_user_id
         WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset)
      .map((r: any) => ({ ...r, metadata: parseJson(r.metadata_json, null), metadata_json: undefined }));
    res.json({ total, rows });
  }),
);

adminRouter.get(
  '/audit',
  ah(async (req, res) => {
    const db = getDb();
    const q = req.query as any;
    const { limit, offset } = paging(q, 100, 1000);
    const where = ['1=1'];
    const args: unknown[] = [];
    if (q.entityType) (where.push('entity_type = ?'), args.push(String(q.entityType)));
    if (q.entityId) (where.push('entity_id = ?'), args.push(Number(q.entityId)));
    if (q.job) (where.push('import_job_id = ?'), args.push(Number(q.job)));
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${where.join(' AND ')}`).get(...args) as any).c;
    res.json({ total, rows: db.prepare(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) });
  }),
);

// ---------------- app settings ----------------
adminRouter.get('/settings', ah(async (_req, res) => res.json(getAllAppSettings())));
adminRouter.patch(
  '/settings',
  ah(async (req, res) => {
    const allowed: Record<string, (v: unknown) => unknown> = {
      registration_enabled: (v) => !!v,
      google_login_enabled: (v) => !!v,
      google_client_id: (v) => {
        const t = String(v ?? '').trim();
        if (t && !/^[A-Za-z0-9._-]{10,200}$/.test(t)) throw badRequest('That does not look like a Google client ID (it ends with .apps.googleusercontent.com).');
        return t;
      },
      app_title: (v) => str(v, 'app_title', { required: true, max: 150 }),
      default_language: (v) => oneOf(v, 'default_language', ['en', 'bn'] as const),
    };
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (!allowed[k]) throw badRequest(`Unknown setting ${k}`);
      setAppSetting(k, allowed[k](v), req.user!.id);
      logActivity({ userId: req.user!.id, event: 'admin_setting_change', meta: { key: k, value: v } });
    }
    res.json(getAllAppSettings());
  }),
);

// ---------------- content display management ----------------
const ENTITY_SQL: Record<string, string> = {
  brand: `SELECT b.id, b.name label, NULL parent FROM brands b`,
  model: `SELECT m.id, m.name label, b.name parent FROM models m JOIN brands b ON b.id=m.brand_id`,
  category: `SELECT c.id, c.name label, NULL parent FROM categories c`,
  common_function: `SELECT f.id, f.name label, c.name parent FROM common_functions f JOIN categories c ON c.id=f.category_id`,
  parameter: `SELECT p.id, p.code || ' — ' || COALESCE(p.name,'') label, b.name || ' ' || m.name parent FROM parameters p JOIN models m ON m.id=p.model_id JOIN brands b ON b.id=m.brand_id`,
  modbus_register: `SELECT r.id, r.original_address || ' — ' || r.name label, b.name || ' ' || m.name parent FROM modbus_registers r JOIN models m ON m.id=r.model_id JOIN brands b ON b.id=m.brand_id`,
  document: `SELECT d.id, d.title label, b.name parent FROM documents d LEFT JOIN brands b ON b.id=d.brand_id`,
};

adminRouter.get(
  '/content/:type',
  ah(async (req, res) => {
    const type = oneOf(req.params.type, 'type', Object.keys(ENTITY_SQL) as any);
    const q = req.query as any;
    const like = q.q ? `%${q.q}%` : null;
    const rows = getDb()
      .prepare(
        `SELECT x.*, COALESCE(cd.visible,1) visible, COALESCE(cd.active,1) active, COALESCE(cd.show_dashboard,1) show_dashboard, COALESCE(cd.show_nav,1) show_nav,
           COALESCE(cd.show_search,1) show_search, COALESCE(cd.featured,0) featured, COALESCE(cd.display_order,1000) display_order
         FROM (${ENTITY_SQL[type]}) x LEFT JOIN content_display cd ON cd.entity_type = ? AND cd.entity_id = x.id
         ${like ? 'WHERE x.label LIKE ? OR x.parent LIKE ?' : ''} ORDER BY x.parent, COALESCE(cd.display_order,1000), x.label LIMIT 2000`,
      )
      .all(type, ...(like ? [like, like] : []));
    res.json(rows);
  }),
);

adminRouter.patch(
  '/content/:type/:id',
  ah(async (req, res) => {
    const db = getDb();
    const type = oneOf(req.params.type, 'type', Object.keys(ENTITY_SQL) as any);
    const id = intParam(req.params.id, 'id', { required: true })!;
    const flags = ['visible', 'active', 'show_dashboard', 'show_nav', 'show_search', 'featured'];
    db.prepare('INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES (?,?)').run(type, id);
    const prev = db.prepare('SELECT * FROM content_display WHERE entity_type=? AND entity_id=?').get(type, id);
    const sets: Record<string, unknown> = {};
    for (const f of flags) if (f in req.body) sets[f] = bool(req.body[f]) ? 1 : 0;
    if ('display_order' in req.body) sets.display_order = intParam(req.body.display_order, 'display_order');
    if (!Object.keys(sets).length) throw badRequest('Nothing to update');
    db.prepare(`UPDATE content_display SET ${Object.keys(sets).map((k) => `${k} = ?`).join(', ')}, updated_by_user_id = ?, updated_at = ? WHERE entity_type = ? AND entity_id = ?`).run(
      ...Object.values(sets),
      req.user!.id,
      new Date().toISOString(),
      type,
      id,
    );
    audit({ entityType: `content_display:${type}`, entityId: id, operation: 'update', previous: prev, next: sets, userId: req.user!.id, source: 'admin_panel' });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/content/:type/reorder',
  ah(async (req, res) => {
    const db = getDb();
    const type = oneOf(req.params.type, 'type', Object.keys(ENTITY_SQL) as any);
    const ids: number[] = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(Number).filter(Number.isInteger) : [];
    db.transaction(() => {
      ids.forEach((id, i) => {
        db.prepare('INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES (?,?)').run(type, id);
        db.prepare('UPDATE content_display SET display_order = ?, updated_by_user_id = ?, updated_at = ? WHERE entity_type = ? AND entity_id = ?').run((i + 1) * 10, req.user!.id, new Date().toISOString(), type, id);
      });
    })();
    audit({ entityType: `content_display:${type}`, operation: 'reorder', next: ids, userId: req.user!.id, source: 'admin_panel' });
    res.json({ ok: true });
  }),
);

// ---------------- backups ----------------
adminRouter.get('/backups', ah(async (_req, res) => res.json(listBackups(getDb()))));
adminRouter.post(
  '/backups',
  ah(async (req, res) => {
    const b = createBackup(getDb(), 'manual-admin', req.user!.id);
    logActivity({ userId: req.user!.id, event: 'backup_create', meta: { path: b.relPath } });
    res.status(201).json({ id: b.id, path: b.relPath, size: b.size, verified: b.verified });
  }),
);
adminRouter.get(
  '/backups/:id/download',
  ah(async (req, res) => {
    const b = getDb().prepare('SELECT * FROM backups WHERE id = ?').get(intParam(req.params.id, 'id', { required: true })) as any;
    if (!b) throw notFound();
    const abs = path.resolve(config.root, b.file_rel_path);
    if (!abs.startsWith(path.resolve(config.backupDir)) || !fs.existsSync(abs)) throw notFound('Backup file missing');
    if (!verifyBackup(abs)) throw conflict('Backup file failed verification');
    logActivity({ userId: req.user!.id, event: 'backup_download', meta: { id: b.id } });
    res.download(abs, path.basename(abs));
  }),
);
