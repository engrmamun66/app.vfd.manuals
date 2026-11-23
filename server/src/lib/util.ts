import crypto from 'node:crypto';

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}
export const sha256 = (buf: Buffer | string) => crypto.createHash('sha256').update(buf).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
export function parseJson<T>(s: string | null | undefined, def: T): T {
  if (!s) return def;
  try {
    return JSON.parse(s) as T;
  } catch {
    return def;
  }
}
/** Whitespace/quote-normalized text used to compare evidence quotes with extracted page text. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}
