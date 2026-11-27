import { getAppSetting } from './settings.js';
import { HttpError } from '../lib/http.js';

/** Google sign-in settings: the Super Admin sets them in Application Settings; GOOGLE_CLIENT_ID in the environment also works. */
export function googleConfig(): { enabled: boolean; clientId: string } {
  const clientId = (process.env.GOOGLE_CLIENT_ID || String(getAppSetting<string>('google_client_id') || '')).trim();
  const enabled = !!clientId && (!!process.env.GOOGLE_CLIENT_ID || getAppSetting<boolean>('google_login_enabled') === true);
  return { enabled, clientId };
}

export interface GoogleClaims { sub: string; email: string; name: string | null }

/**
 * Checks an ID token ("credential") issued by Google Identity Services. Google validates the signature and expiry;
 * we then check that it was issued for OUR client id, by Google, and that the e-mail address is verified.
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleClaims> {
  if (!idToken || idToken.length > 4096) throw new HttpError(401, 'Google sign-in failed. Please try again.');
  let c: any;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('rejected');
    c = await r.json();
  } catch {
    throw new HttpError(401, 'Google sign-in failed. Please try again.');
  }
  const issuerOk = c.iss === 'accounts.google.com' || c.iss === 'https://accounts.google.com';
  if (c.aud !== clientId || !issuerOk || !c.sub || !c.email || Number(c.exp) * 1000 < Date.now()) throw new HttpError(401, 'Google sign-in failed. Please try again.');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new HttpError(403, 'Your Google e-mail address is not verified.');
  return { sub: String(c.sub), email: String(c.email), name: c.name ? String(c.name).slice(0, 100) : null };
}
