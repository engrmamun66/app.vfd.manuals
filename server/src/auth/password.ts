import { hash, verify, Algorithm } from '@node-rs/argon2';

// Argon2id, OWASP-recommended baseline parameters.
const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, OPTS);
export async function verifyPassword(hashStr: string, pw: string) {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}

/** Returns a list of problems; empty list = acceptable. */
export function passwordProblems(pw: string, email?: string | null): string[] {
  const p: string[] = [];
  if (typeof pw !== 'string' || pw.length < 10) p.push('Password must be at least 10 characters long.');
  if (pw && pw.length > 200) p.push('Password must be at most 200 characters long.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw || '')).length;
  if (pw && pw.length < 16 && classes < 3)
    p.push('Use at least 3 of: lowercase, uppercase, digits, symbols (or a passphrase of 16+ characters).');
  if (pw && /^(.)\1+$/.test(pw)) p.push('Password must not be a single repeated character.');
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) p.push('Password must not contain your email name.');
  return p;
}

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}
export function isValidEmail(e: string): boolean {
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
export function isValidPhone(p: string): boolean {
  return /^\+?[0-9 ()-]{6,20}$/.test(p) && (p.match(/[0-9]/g)?.length ?? 0) >= 6;
}
