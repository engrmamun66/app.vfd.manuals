/** Thin API client. CSRF token is kept in memory only (never localStorage); session is an HttpOnly cookie. */
let csrf = '';
export const setCsrf = (t: string) => {
  csrf = t;
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) {
    super(message);
  }
}

let onUnauthorized: ((code?: string) => void) | null = null;
export const setUnauthorizedHandler = (fn: (code?: string) => void) => {
  onUnauthorized = fn;
};

let onPremium: ((message: string) => void) | null = null;
/** Called when the server refuses an action because it needs a Pro plan (HTTP 402). */
export const setPremiumHandler = (fn: ((message: string) => void) | null) => {
  onPremium = fn;
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData; query?: Record<string, unknown> } = {}): Promise<T> {
  let url = '/api' + path;
  if (opts.query) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    const s = p.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers: Record<string, string> = {};
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if ((res.status === 401 || (res.status === 403 && data?.code === 'MUST_CHANGE_PASSWORD')) && onUnauthorized) onUnauthorized(data?.code);
    if (res.status === 402 && data?.code === 'PREMIUM_REQUIRED' && onPremium) onPremium(data.error);
    throw new ApiError(res.status, data?.error || res.statusText, data?.code, data?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string, query?: Record<string, unknown>) => api<T>(p, { query });
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string, query?: Record<string, unknown>) => api<T>(p, { method: 'DELETE', query });

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');
