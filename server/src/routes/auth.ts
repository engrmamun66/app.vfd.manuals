import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { ah, badRequest, HttpError, intParam, str } from '../lib/http.js';
import { logActivity } from '../lib/audit.js';
import { hashPassword, isValidEmail, isValidPhone, normalizeEmail, passwordProblems, verifyPassword } from '../auth/password.js';
import { clearSessionCookie, createSession, revokeSessions, stopImpersonation } from '../auth/sessions.js';
import { requireAuth, requireCsrf, requireJson } from '../auth/middleware.js';
import { sqliteRateLimit } from '../auth/rateLimit.js';
import { clientIp } from '../auth/clientIp.js';
import { getAppSetting, getUserSettings } from '../services/settings.js';
import { ensureUserDirs } from '../services/storage.js';
import { newUserTrialEnd } from '../services/premium.js';
import { googleConfig, verifyGoogleIdToken } from '../services/google.js';
import crypto from 'node:crypto';

export const authRouter = Router();

const regLimiter = sqliteRateLimit({
  bucket: 'register',
  max: () => config.regRateMax,
  windowMinutes: () => config.regRateWindowMin,
  message: 'Too many registration attempts from this network address. Please try again later.',
});
const loginLimiter = sqliteRateLimit({
  bucket: 'login',
  max: () => config.loginRateMax,
  windowMinutes: () => config.loginRateWindowMin,
  message: 'Too many login attempts. Please wait and try again.',
});

// dummy hash for constant-ish timing when the email does not exist
let dummyHash: string | null = null;
const getDummy = async () => (dummyHash ??= await hashPassword('dummy-password-for-timing-1A!'));

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    mustChangePassword: !!u.must_change_password,
    displayName: u.display_name,
    phone: u.phone,
    company: u.company,
    designation: u.designation,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

authRouter.get(
  '/registration-status',
  ah(async (_req, res) => {
    res.json({ registrationEnabled: !!getAppSetting<boolean>('registration_enabled') });
  }),
);

authRouter.post(
  '/register',
  regLimiter,
  requireJson,
  ah(async (req, res) => {
    const db = getDb();
    if (!getAppSetting<boolean>('registration_enabled')) throw new HttpError(403, 'New registrations are currently disabled by the administrator.');
    const emailRaw = str(req.body.email, 'Email', { required: true, max: 254 })!;
    const email = normalizeEmail(emailRaw);
    if (!isValidEmail(email)) throw badRequest('Please enter a valid email address.');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const confirm = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
    if (password !== confirm) throw badRequest('Password and Confirm Password do not match.');
    const problems = passwordProblems(password, email);
    if (problems.length) throw badRequest(problems.join(' '), { password: problems });
    const fullName = str(req.body.displayName, 'Full name', { required: true, max: 100 })!;
    if (fullName.length < 2) throw badRequest('Full name is required.');
    const phone = str(req.body.phone, 'Phone', { max: 30 });
    if (phone && !isValidPhone(phone)) throw badRequest('Phone number format is invalid.');
    const company = str(req.body.company, 'Current Company', { max: 150 });
    const designation = str(req.body.designation, 'Designation', { max: 150 });
    // Role is NEVER taken from the request: new registrations are always Normal User.
    const hash = await hashPassword(password);
    let userId: number;
    try {
      userId = Number(
        db
          .prepare(
            `INSERT INTO users(email, email_normalized, password_hash, role, status, phone, company, designation, display_name, login_count, last_login_at, full_access_until)
             VALUES (?,?,?,'user','enabled',?,?,?,?,1,?,?)`,
          )
          .run(emailRaw, email, hash, phone, company, designation, fullName, new Date().toISOString(), newUserTrialEnd()).lastInsertRowid,
      );
    } catch (e) {
      if ((e as any).code?.startsWith('SQLITE_CONSTRAINT'))
        // generic message: does not confirm whether this email belongs to someone
        throw badRequest('Registration could not be completed with these details. If you already have an account, please sign in.');
      throw e;
    }
    ensureUserDirs(userId);
    const s = createSession(req, res, userId);
    db.prepare('INSERT INTO user_login_history(user_id, success, reason, ip, user_agent) VALUES (?,?,?,?,?)').run(userId, 1, 'registration', clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300));
    logActivity({ userId, event: 'register', ip: clientIp(req) });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({ user: publicUser(u), csrfToken: s.csrf, settings: getUserSettings(userId) });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  requireJson,
  ah(async (req, res) => {
    const db = getDb();
    const email = normalizeEmail(String(req.body.email || ''));
    const password = String(req.body.password || '');
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const u = db.prepare('SELECT * FROM users WHERE email_normalized = ?').get(email) as any;
    const fail = (reason: string, userId: number | null) => {
      db.prepare('INSERT INTO user_login_history(user_id, success, reason, ip, user_agent) VALUES (?,?,?,?,?)').run(userId, 0, reason, ip, ua);
      if (userId) logActivity({ userId, event: 'login_failed', meta: { reason }, ip });
    };
    if (!u) {
      await verifyPassword(await getDummy(), password);
      fail('unknown_email', null);
      throw new HttpError(401, 'Invalid email or password.');
    }
    if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
      fail('locked', u.id);
      throw new HttpError(429, 'Too many failed attempts. This account is temporarily locked; try again later.');
    }
    const ok = await verifyPassword(u.password_hash, password);
    if (!ok) {
      const n = u.failed_login_count + 1;
      // progressive backoff: lock after 5 failures, doubling up to 1 hour
      const lockMin = n >= 5 ? Math.min(60, 2 ** (n - 5)) : 0;
      db.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?').run(n, lockMin ? new Date(Date.now() + lockMin * 60_000).toISOString() : null, u.id);
      fail('bad_password', u.id);
      throw new HttpError(401, 'Invalid email or password.');
    }
    if (u.status !== 'enabled') {
      fail('account_disabled', u.id);
      throw new HttpError(403, 'This account is disabled. Contact the administrator.');
    }
    db.prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL, login_count = login_count + 1, last_login_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    db.prepare('INSERT INTO user_login_history(user_id, success, reason, ip, user_agent) VALUES (?,?,?,?,?)').run(u.id, 1, 'login', ip, ua);
    ensureUserDirs(u.id);
    const s = createSession(req, res, u.id);
    logActivity({ userId: u.id, event: 'login', entityType: 'session', entityId: s.sessionId, ip });
    res.json({ user: publicUser(u), csrfToken: s.csrf, settings: getUserSettings(u.id) });
  }),
);

/** Public: is "Sign in with Google" on, and with which client id (the id is public by design). */
authRouter.get(
  '/google-config',
  ah(async (_req, res) => {
    const g = googleConfig();
    res.json({ enabled: g.enabled, clientId: g.enabled ? g.clientId : null });
  }),
);

/**
 * Sign in (or sign up) with a Google ID token. A user is matched by Google account id, else by the verified e-mail address
 * (and then linked). A new e-mail address creates a Normal User (when registration is open) with the free full-access period.
 */
authRouter.post(
  '/google',
  loginLimiter,
  requireJson,
  ah(async (req, res) => {
    const db = getDb();
    const g = googleConfig();
    if (!g.enabled) throw new HttpError(403, 'Google sign-in is not enabled.');
    const claims = await verifyGoogleIdToken(String(req.body?.credential || ''), g.clientId);
    const email = normalizeEmail(claims.email);
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const now = new Date().toISOString();
    let u = (db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub) ?? db.prepare('SELECT * FROM users WHERE email_normalized = ?').get(email)) as any;
    const fail = (reason: string, userId: number | null) => {
      db.prepare('INSERT INTO user_login_history(user_id, success, reason, ip, user_agent) VALUES (?,?,?,?,?)').run(userId, 0, reason, ip, ua);
      if (userId) logActivity({ userId, event: 'login_failed', meta: { reason }, ip });
    };
    if (u) {
      if (u.google_sub && u.google_sub !== claims.sub) { fail('google_mismatch', u.id); throw new HttpError(403, 'This account is linked to a different Google account.'); }
      if (u.status !== 'enabled') { fail('account_disabled', u.id); throw new HttpError(403, 'This account is disabled. Contact the administrator.'); }
      if (!u.google_sub) db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(claims.sub, u.id);
      db.prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL, login_count = login_count + 1, last_login_at = ? WHERE id = ?').run(now, u.id);
      db.prepare('INSERT INTO user_login_history(user_id, success, reason, ip, user_agent) VALUES (?,?,?,?,?)').run(u.id, 1, 'google_login', ip, ua);
    } else {
      if (!getAppSetting<boolean>('registration_enabled')) throw new HttpError(403, 'New registrations are currently disabled by the administrator.');
      const name = claims.name?.trim() || claims.email.split('@')[0];
      // no password is ever used for this account: a random one is stored (it can be replaced from "Forgot / change password" by the admin)
      const hash = await hashPassword(crypto.randomBytes(24).toString('base64url') + 'aA1!');
      const id = Number(
        db
          .prepare("INSERT INTO users(email, email_normalized, password_hash, role, status, display_name, login_count, last_login_at, full_access_until, google_sub) VALUES (?,?,?,'user','enabled',?,1,?,?,?)")
          .run(claims.email, email, hash, name, now, newUserTrialEnd(), claims.sub).lastInsertRowid,
      );
      ensureUserDirs(id);
      db.prepare('INSERT INTO user_login_history(user_id, success, reason, ip, user_agent) VALUES (?,?,?,?,?)').run(id, 1, 'google_registration', ip, ua);
      logActivity({ userId: id, event: 'register', meta: { via: 'google' }, ip });
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }
    ensureUserDirs(u.id);
    const s = createSession(req, res, u.id);
    logActivity({ userId: u.id, event: 'login', entityType: 'session', entityId: s.sessionId, meta: { via: 'google' }, ip });
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    res.json({ user: publicUser(fresh), csrfToken: s.csrf, settings: getUserSettings(u.id) });
  }),
);

// ---- authenticated (must-change allowed) ----
const authed = Router();
authed.use(requireAuth({ allowMustChange: true }), requireCsrf);

authed.get(
  '/me',
  ah(async (req, res) => {
    const u = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id);
    const imp = req.sessionRow!.impersonator_user_id ? (getDb().prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(req.sessionRow!.impersonator_user_id) as any) : null;
    res.json({ user: publicUser(u), csrfToken: req.sessionRow!.csrf_token, sessionId: req.sessionRow!.id, sessionExpiresAt: req.sessionRow!.expires_at, settings: getUserSettings(req.user!.id), impersonation: imp ? { byUserId: imp.id, byEmail: imp.email, byName: imp.display_name } : null });
  }),
);

authed.post(
  '/logout',
  ah(async (req, res) => {
    if (req.sessionRow!.impersonator_user_id) {
      // signing out of an impersonated session returns to the admin instead of ending everything
      const r = stopImpersonation(req, res);
      logActivity({ userId: r.targetUserId ?? req.user!.id, actorUserId: r.adminUserId, event: 'impersonation_end', entityType: 'session', entityId: req.sessionRow!.id });
      return void res.json({ ok: true, returnedToAdmin: r.ok });
    }
    revokeSessions({ sessionId: req.sessionRow!.id }, 'logout');
    logActivity({ userId: req.user!.id, event: 'logout', entityType: 'session', entityId: req.sessionRow!.id });
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authed.post(
  '/stop-impersonation',
  ah(async (req, res) => {
    if (!req.sessionRow!.impersonator_user_id) throw badRequest('This is not an impersonated session.');
    const target = req.user!.id;
    const sid = req.sessionRow!.id;
    const r = stopImpersonation(req, res);
    logActivity({ userId: target, actorUserId: r.adminUserId, event: 'impersonation_end', entityType: 'session', entityId: sid });
    res.json({ ok: r.ok });
  }),
);

authed.post(
  '/change-password',
  ah(async (req, res) => {
    if (req.sessionRow!.impersonator_user_id) throw new HttpError(403, 'Passwords cannot be changed while signed in as another user.');
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
    const current = String(req.body.currentPassword || '');
    const next = String(req.body.newPassword || '');
    if (next !== String(req.body.confirmPassword || '')) throw badRequest('New password and confirmation do not match.');
    if (!(await verifyPassword(u.password_hash, current))) throw new HttpError(400, 'Current password is incorrect.');
    if (current === next) throw badRequest('New password must differ from the current password.');
    const problems = passwordProblems(next, u.email);
    if (problems.length) throw badRequest(problems.join(' '));
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(await hashPassword(next), new Date().toISOString(), u.id);
    // privilege/credential change: revoke all other sessions and rotate this one
    revokeSessions({ userId: u.id, exceptSessionId: req.sessionRow!.id }, 'password_changed');
    revokeSessions({ sessionId: req.sessionRow!.id }, 'rotated_after_password_change');
    const s = createSession(req, res, u.id);
    logActivity({ userId: u.id, event: 'password_change' });
    res.json({ ok: true, csrfToken: s.csrf });
  }),
);

authed.patch(
  '/profile',
  ah(async (req, res) => {
    const db = getDb();
    const phone = req.body.phone !== undefined ? str(req.body.phone, 'Phone', { max: 30 }) : undefined;
    if (phone && !isValidPhone(phone)) throw badRequest('Phone number format is invalid.');
    const fields: Record<string, unknown> = {};
    if (phone !== undefined) fields.phone = phone;
    if (req.body.company !== undefined) fields.company = str(req.body.company, 'Company', { max: 150 });
    if (req.body.designation !== undefined) fields.designation = str(req.body.designation, 'Designation', { max: 150 });
    if (req.body.displayName !== undefined) fields.display_name = str(req.body.displayName, 'Full name', { required: true, max: 100 });
    if (!Object.keys(fields).length) throw badRequest('Nothing to update');
    db.prepare(`UPDATE users SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), new Date().toISOString(), req.user!.id);
    logActivity({ userId: req.user!.id, event: 'profile_update', meta: { fields: Object.keys(fields) } });
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) });
  }),
);

authed.get(
  '/sessions',
  ah(async (req, res) => {
    res.json(
      getDb()
        .prepare('SELECT id, created_at, expires_at, last_seen_at, user_agent, ip, revoked_at, revoke_reason FROM user_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 50')
        .all(req.user!.id)
        .map((s: any) => ({ ...s, current: s.id === req.sessionRow!.id })),
    );
  }),
);

authed.delete(
  '/sessions/:id',
  ah(async (req, res) => {
    const id = intParam(req.params.id, 'id', { required: true })!;
    const s = getDb().prepare('SELECT id FROM user_sessions WHERE id = ? AND user_id = ?').get(id, req.user!.id);
    if (!s) throw new HttpError(404, 'Session not found');
    revokeSessions({ sessionId: id }, 'user_revoked');
    logActivity({ userId: req.user!.id, event: 'session_revoked', entityType: 'session', entityId: id });
    res.json({ ok: true });
  }),
);

authRouter.use(authed);
