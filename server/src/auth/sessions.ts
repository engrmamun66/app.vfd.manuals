import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/util.js';
import { clientIp } from './clientIp.js';

export interface SessionUser {
  id: number;
  email: string;
  role: 'super_admin' | 'user';
  status: 'enabled' | 'disabled';
  must_change_password: number;
  display_name: string | null;
}
export interface SessionRow {
  id: number;
  user_id: number;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
}

/** Hook set by the socket layer so revocations disconnect live sockets. */
export const sessionEvents = {
  onRevoke: (_sessionIds: number[], _reason: string) => {},
};

/** Creates a new session (new random id each login = rotation). Cookie and DB expiry use the same TTL. */
export function createSession(req: Request, res: Response, userId: number) {
  const db = getDb();
  const token = randomToken(32);
  const csrf = randomToken(24);
  const ttlMs = config.sessionTtlDays * 86_400_000;
  const expires = new Date(Date.now() + ttlMs);
  const info = db
    .prepare(
      `INSERT INTO user_sessions(token_hash, csrf_token, user_id, expires_at, last_seen_at, user_agent, ip)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(sha256(token), csrf, userId, expires.toISOString(), new Date().toISOString(), String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req));
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires,
    path: '/',
  });
  return { sessionId: Number(info.lastInsertRowid), csrf };
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.sessionCookie, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

/** Validates a raw session token: not revoked, not expired, account enabled. DB state is authoritative. */
export function resolveSession(token: string | undefined): { session: SessionRow; user: SessionUser } | null {
  if (!token || token.length > 200) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.revoked_at, s.last_seen_at,
              u.id AS uid, u.email, u.role, u.status, u.must_change_password, u.display_name
       FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as any;
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.status !== 'enabled') return null;
  if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 60_000)
    db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return {
    session: { id: row.id, user_id: row.user_id, csrf_token: row.csrf_token, expires_at: row.expires_at, revoked_at: row.revoked_at },
    user: { id: row.uid, email: row.email, role: row.role, status: row.status, must_change_password: row.must_change_password, display_name: row.display_name },
  };
}

export function revokeSessions(where: { sessionId?: number; userId?: number; exceptSessionId?: number }, reason: string): number[] {
  const db = getDb();
  let rows: { id: number }[] = [];
  if (where.sessionId) rows = db.prepare('SELECT id FROM user_sessions WHERE id = ? AND revoked_at IS NULL').all(where.sessionId) as any;
  else if (where.userId)
    rows = db.prepare('SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND id != ?').all(where.userId, where.exceptSessionId ?? -1) as any;
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    const stmt = db.prepare('UPDATE user_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ?');
    const now = new Date().toISOString();
    db.transaction(() => ids.forEach((id) => stmt.run(now, reason, id)))();
    sessionEvents.onRevoke(ids, reason);
  }
  return ids;
}
