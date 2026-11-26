import { getDb } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { getAppSetting } from './settings.js';

/**
 * Free vs. paid ("Pro") access. The Super Admin decides which features are limited for free users;
 * a user with an active subscription (and every Super Admin) is never limited.
 */
export interface BankAccount { bank: string; account_name: string; account_number: string; branch: string }
export interface PremiumConfig {
  locked_menus: string[]; // sidebar paths that need Pro (main and sub menus)
  locked_models: number[]; // VFD model ids that need Pro
  lock_search: boolean;
  lock_custom_category: boolean;
  lock_requests: boolean; // "request" messages (new manual / model requests)
  text_mapping: boolean; // selectable text layer over manual page images
  highlight_matched: boolean; // cited words marked on the manual page image
  max_upload_mb: number | null; // largest comment image a free user may upload (null = no limit)
  max_comments: number | null;
  max_highlights: number | null;
  max_bookmarks: number | null;
  plans: { monthly: { price: number; days: number }; yearly: { price: number; days: number } };
  payment: { bkash_number: string; bkash_type: string; banks: BankAccount[]; receipt_email: string; instructions: string };
}

export const PREMIUM_DEFAULTS: PremiumConfig = {
  locked_menus: [],
  locked_models: [],
  lock_search: false,
  lock_custom_category: false,
  lock_requests: true,
  text_mapping: true,
  highlight_matched: true,
  max_upload_mb: 2,
  max_comments: 20,
  max_highlights: 50,
  max_bookmarks: 20,
  plans: { monthly: { price: 99, days: 30 }, yearly: { price: 450, days: 365 } },
  payment: {
    bkash_number: '',
    bkash_type: 'Personal (Send Money)',
    banks: [],
    receipt_email: '',
    instructions: 'Pay the plan amount to the bKash number or a bank account shown here. Then attach the payment receipt (screenshot) in this form, or e-mail it to the receipt address. Your account becomes Pro after the administrator checks the payment.',
  },
};

export function getPremiumConfig(): PremiumConfig {
  const stored = getAppSetting<Partial<PremiumConfig> | null>('premium_config');
  const s = (stored && typeof stored === 'object' ? stored : {}) as any;
  return {
    ...PREMIUM_DEFAULTS,
    ...s,
    plans: { monthly: { ...PREMIUM_DEFAULTS.plans.monthly, ...s.plans?.monthly }, yearly: { ...PREMIUM_DEFAULTS.plans.yearly, ...s.plans?.yearly } },
    payment: { ...PREMIUM_DEFAULTS.payment, ...s.payment },
  };
}

/** The active subscription of a user, if any (ends in the future). */
export function activeSubscription(userId: number) {
  return getDb().prepare("SELECT id, plan, starts_at, ends_at FROM subscriptions WHERE user_id = ? AND status = 'active' AND ends_at > ? ORDER BY ends_at DESC LIMIT 1").get(userId, new Date().toISOString()) as { id: number; plan: 'monthly' | 'yearly'; starts_at: string; ends_at: string } | undefined;
}
export const isPro = (userId: number, role?: string) => role === 'super_admin' || !!activeSubscription(userId);

export function usage(userId: number) {
  const db = getDb();
  const n = (sql: string) => (db.prepare(sql).get(userId) as { c: number }).c;
  return {
    comments: n("SELECT COUNT(*) c FROM research_annotations WHERE user_id = ? AND deletion_status = 'active' AND comment_text IS NOT NULL AND comment_text <> ''"),
    highlights: n("SELECT COUNT(*) c FROM research_annotations WHERE user_id = ? AND deletion_status = 'active' AND highlight_color IS NOT NULL"),
    bookmarks: n('SELECT COUNT(*) c FROM research_bookmarks WHERE user_id = ?'),
  };
}

/** HTTP 402 the client turns into the pricing dialog. */
export const premiumRequired = (message: string) => new HttpError(402, message, { code: 'PREMIUM_REQUIRED' });

type Counted = 'comments' | 'highlights' | 'bookmarks';
const LABEL: Record<Counted, string> = { comments: 'comments', highlights: 'highlights', bookmarks: 'bookmarks' };
const KEY = { comments: 'max_comments', highlights: 'max_highlights', bookmarks: 'max_bookmarks' } as const;

/** Throws 402 when a free user would exceed the free limit by adding one more. */
export function assertWithinLimit(user: { id: number; role?: string }, what: Counted) {
  if (isPro(user.id, user.role)) return;
  const max = getPremiumConfig()[KEY[what]];
  if (max === null || max === undefined) return;
  if (usage(user.id)[what] >= max) throw premiumRequired(`Free plan allows up to ${max} ${LABEL[what]}. Upgrade to Pro for unlimited ${LABEL[what]}.`);
}
export function assertFeature(user: { id: number; role?: string }, flag: 'lock_search' | 'lock_custom_category' | 'lock_requests', message: string) {
  if (isPro(user.id, user.role)) return;
  if (getPremiumConfig()[flag]) throw premiumRequired(message);
}
export function assertUploadSize(user: { id: number; role?: string }, bytes: number) {
  if (isPro(user.id, user.role)) return;
  const mb = getPremiumConfig().max_upload_mb;
  if (mb !== null && mb !== undefined && bytes > mb * 1024 * 1024) throw premiumRequired(`Free plan allows uploads up to ${mb} MB. Upgrade to Pro for larger files.`);
}
