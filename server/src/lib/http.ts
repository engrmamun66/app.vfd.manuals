import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details, code: (err.details as { code?: string } | undefined)?.code });
    return;
  }
  const e = err as { code?: string; message?: string; type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  if (e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File exceeds the maximum allowed upload size' });
    return;
  }
  if (typeof e?.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) {
    res.status(409).json({ error: 'Database constraint violation', details: e.message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}

// ---- small validation helpers ----
export function str(v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  const s = v.trim();
  if (opts.required && !s) throw badRequest(`${field} is required`);
  if (opts.max && s.length > opts.max) throw badRequest(`${field} must be at most ${opts.max} characters`);
  return s || null;
}
export function intParam(v: unknown, field: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${field} is required`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw badRequest(`${field} must be an integer`);
  if (opts.min !== undefined && n < opts.min) throw badRequest(`${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw badRequest(`${field} must be <= ${opts.max}`);
  return n;
}
export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], def?: T): T {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  return v as T;
}
export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}
export function paging(q: Record<string, unknown>, defLimit = 50, maxLimit = 500) {
  const limit = Math.min(intParam(q.limit, 'limit', { min: 1 }) ?? defLimit, maxLimit);
  const page = intParam(q.page, 'page', { min: 1 }) ?? 1;
  return { limit, offset: (page - 1) * limit, page };
}
