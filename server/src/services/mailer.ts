import '../config.js'; // loads .env
import nodemailer, { type Transporter } from 'nodemailer';
import { getAppSetting } from './settings.js';

/**
 * E-mail to the administrator (SMTP). Server settings come from .env (the password never goes into the database):
 * SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM. The recipient and which events send mail
 * are set by the Super Admin in Application Settings (NOTIFY_EMAIL in .env is the fallback recipient).
 */
export type NotifyEvent = 'register' | 'payment' | 'message' | 'subscription';

export function smtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const from = (process.env.SMTP_FROM || user).trim();
  const capture = String(process.env.MAIL_CAPTURE || '').toLowerCase() === 'true'; // development: print mails to the console instead of sending
  return { host, port, secure, user, pass, from, capture, configured: capture || (!!host && !!from) };
}

export const notifyRecipient = () => String(getAppSetting<string>('notify_email') || process.env.NOTIFY_EMAIL || '').trim();

let cached: { key: string; t: Transporter } | null = null;
function transport() {
  const c = smtpConfig();
  const key = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass]);
  if (cached?.key === key) return cached.t;
  const t = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  cached = { key, t };
  return t;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 150);

/** Sends now and reports the error (used by the "Send test e-mail" button). */
export async function sendMail(to: string, subject: string, text: string) {
  const c = smtpConfig();
  if (!c.configured) throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM in .env and restart the server.');
  if (c.capture) { console.log(`[mail-capture] to=${to} subject=${oneLine(subject)}\n${text}`); return; }
  await transport().sendMail({ from: c.from, to, subject: oneLine(subject), text });
}

/** Mail to the administrator about something a user did. Never blocks or breaks the request: failures are only logged. */
export function notifyAdmin(event: NotifyEvent, subject: string, lines: Record<string, string | number | null | undefined>, body?: string) {
  try {
    if (!smtpConfig().configured) return;
    if (getAppSetting<boolean>(`notify_on_${event}`) === false) return;
    const to = notifyRecipient();
    if (!to) return;
    const text = [
      ...Object.entries(lines).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`),
      ...(body ? ['', body.slice(0, 3000)] : []),
      '',
      process.env.PUBLIC_URL ? `Open: ${process.env.PUBLIC_URL}/superadmin` : '',
    ].join('\n');
    sendMail(to, `[VFD KB] ${subject}`, text).catch((e) => console.warn(`[mail] ${event} notification failed: ${e?.message ?? e}`));
  } catch (e) {
    console.warn('[mail] notification skipped:', (e as Error).message);
  }
}
