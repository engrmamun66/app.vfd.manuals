import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { parseCookies, resolveSession, type SessionRow, type SessionUser } from './sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionRow?: SessionRow;
    }
  }
}

/** Every protected route requires a valid server-side session (§35.1). */
export function requireAuth(opts: { allowMustChange?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[config.sessionCookie];
    const r = resolveSession(token);
    if (!r) {
      res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }
    req.user = r.user;
    req.sessionRow = r.session;
    if (r.user.must_change_password && !opts.allowMustChange && !r.session.impersonator_user_id) {
      res.status(403).json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' });
      return;
    }
    next();
  };
}

/** CSRF: state-changing requests must carry the per-session token in X-CSRF-Token. */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const t = req.headers['x-csrf-token'];
  if (!req.sessionRow || typeof t !== 'string' || t !== req.sessionRow.csrf_token) {
    res.status(403).json({ error: 'Invalid or missing CSRF token', code: 'CSRF' });
    return;
  }
  next();
}

/** Login/registration have no session yet: require a JSON body so cross-site HTML forms cannot submit. */
export function requireJson(req: Request, res: Response, next: NextFunction) {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json' });
    return;
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Super Admin permission required' });
    return;
  }
  next();
}
