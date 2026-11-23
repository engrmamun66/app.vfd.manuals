import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index.js';
import { clientIp } from './clientIp.js';

/**
 * SQLite-persisted sliding-window limiter (survives restarts, no Redis).
 * Counts every request that reaches the endpoint (success or failure).
 */
export function sqliteRateLimit(opts: { bucket: string; max: () => number; windowMinutes: () => number; message: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const db = getDb();
    const key = clientIp(req);
    const now = Date.now();
    const windowMs = opts.windowMinutes() * 60_000;
    const since = now - windowMs;
    const result = db.transaction(() => {
      db.prepare('DELETE FROM rate_limit_hits WHERE bucket = ? AND created_at < ?').run(opts.bucket, since);
      const rows = db
        .prepare('SELECT created_at FROM rate_limit_hits WHERE bucket = ? AND key = ? AND created_at >= ? ORDER BY created_at ASC')
        .all(opts.bucket, key, since) as { created_at: number }[];
      if (rows.length >= opts.max()) return { blocked: true, retryAfterMs: rows[0].created_at + windowMs - now };
      db.prepare('INSERT INTO rate_limit_hits(bucket, key, created_at) VALUES (?,?,?)').run(opts.bucket, key, now);
      return { blocked: false, retryAfterMs: 0 };
    })();
    if (result.blocked) {
      const secs = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader('Retry-After', String(secs));
      res.status(429).json({ error: opts.message, retryAfterSeconds: secs });
      return;
    }
    next();
  };
}
