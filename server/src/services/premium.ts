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
  lock_text_mapping: boolean; // selectable text layer over manual page images needs Pro
  lock_highlight_matched: boolean; // cited words marked on the manual page image need Pro
  trial_days: number; // full access for a newly registered user, in days (0 = none)
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
  lock_text_mapping: false,
  lock_highlight_matched: false,
  trial_days: 2,
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

/** Next full hour (a time already on the hour stays as it is). 10:35:45 → 11:00:00. */
export function ceilHour(d: Date): Date {
  const x = new Date(d);
  if (x.getMinutes() || x.getSeconds() || x.getMilliseconds()) { x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); }
  return x;
}
/** One calendar month / year after `start` (31 Jan + 1 month = 28/29 Feb, never a date in the month after). */
export function addPeriod(start: Date, billing: 'monthly' | 'yearly'): Date {
  const e = new Date(start);
  const day = e.getDate();
  e.setDate(1);
  if (billing === 'monthly') e.setMonth(e.getMonth() + 1); else e.setFullYear(e.getFullYear() + 1);
  e.setDate(Math.min(day, new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate()));
  return e;
}

export interface PricingPlan { id: number; name: string; monthly_original: number; monthly_price: number; yearly_original: number; yearly_price: number; currency: string; active: number }
export const activePricingPlans = () => getDb().prepare('SELECT id, name, monthly_original, monthly_price, yearly_original, yearly_price, currency, active FROM pricing_plans WHERE active = 1 ORDER BY id').all() as PricingPlan[];
export const priceOf = (p: PricingPlan, billing: 'monthly' | 'yearly') => (billing === 'monthly' ? p.monthly_price : p.yearly_price);

const SUB_COLS = 's.id, s.plan billing, s.amount, s.currency, s.status, s.pricing_plan_id, p.name plan_name, p.active plan_active, s.subscribed_at, s.starts_at, s.ends_at, s.migrate_to';
/**
 * The subscription that gives the user Pro right now: approved, not soft-deleted, not expired, already started
 * (a start up to an hour ahead counts, because the start time is rounded up to the next full hour).
 */
export function activeSubscription(userId: number) {
  const now = new Date();
  return getDb()
    .prepare(`SELECT ${SUB_COLS} FROM subscriptions s LEFT JOIN pricing_plans p ON p.id = s.pricing_plan_id
      WHERE s.user_id = ? AND s.status = 'active' AND s.deleted_at IS NULL AND s.ends_at > ? AND s.starts_at <= ? ORDER BY s.ends_at DESC LIMIT 1`)
    .get(userId, now.toISOString(), new Date(now.getTime() + 3_600_000).toISOString()) as (SubView & { plan: 'monthly' | 'yearly' }) | undefined;
}
interface SubView { id: number; billing: 'monthly' | 'yearly'; amount: number; currency: string; status: string; pricing_plan_id: number | null; plan_name: string | null; plan_active: number | null; subscribed_at: string | null; starts_at: string; ends_at: string; migrate_to: 'monthly' | 'yearly' | null }
/** The next paid period (approved, starts after the running one ends). */
export function queuedSubscription(userId: number) {
  return getDb()
    .prepare(`SELECT ${SUB_COLS} FROM subscriptions s LEFT JOIN pricing_plans p ON p.id = s.pricing_plan_id
      WHERE s.user_id = ? AND s.status = 'active' AND s.deleted_at IS NULL AND s.starts_at > ? ORDER BY s.starts_at LIMIT 1`)
    .get(userId, new Date(Date.now() + 3_600_000).toISOString()) as SubView | undefined;
}
/** State shown to people: pending | active | scheduled | expired | rejected | cancelled. */
export function subState(r: { status: string; outcome?: string | null; starts_at?: string | null; ends_at?: string | null; deleted_at?: string | null }): string {
  if (r.status === 'draft') return 'pending';
  if (r.status === 'cancelled') return r.outcome === 'rejected' ? 'rejected' : 'cancelled';
  if (r.deleted_at) return 'cancelled';
  const now = Date.now();
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return 'expired';
  if (r.starts_at && new Date(r.starts_at).getTime() > now + 3_600_000) return 'scheduled';
  return 'active';
}

/** The end of a user's free full-access period, when it is still running. */
export function activeTrialEnd(userId: number): string | null {
  const r = getDb().prepare('SELECT full_access_until FROM users WHERE id = ?').get(userId) as { full_access_until: string | null } | undefined;
  return r?.full_access_until && r.full_access_until > new Date().toISOString() ? r.full_access_until : null;
}
/** Full access date for a user who registers now (null when the Super Admin set 0 days). */
export function newUserTrialEnd(): string | null {
  const days = getPremiumConfig().trial_days;
  return days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
}
export const isPro = (userId: number, role?: string) => role === 'super_admin' || !!activeSubscription(userId) || !!activeTrialEnd(userId);

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
