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

/** Password policy intentionally minimal (owner request): only non-empty and a sane upper bound. */
export function passwordProblems(pw: string, _email?: string | null): string[] {
  if (typeof pw !== 'string' || pw.length < 1) return ['Password is required.'];
  if (pw.length > 200) return ['Password must be at most 200 characters long.'];
  return [];
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
