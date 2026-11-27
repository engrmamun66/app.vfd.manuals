import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { ah, badRequest, conflict, HttpError, intParam, notFound, oneOf, paging, str } from '../lib/http.js';
import { audit, logActivity } from '../lib/audit.js';
import { safeResolve, saveUserImage, userRoot } from '../services/storage.js';
import { setAppSetting } from '../services/settings.js';
import { notifyAdmin } from '../services/mailer.js';
import { activePricingPlans, activeSubscription, activeTrialEnd, addPeriod, ceilHour, getPremiumConfig, isPro, priceOf, queuedSubscription, subState, usage, type PremiumConfig } from '../services/premium.js';
import { isValidEmail, normalizeEmail } from '../auth/password.js';

/** Pricing and subscription requests (with a payment receipt) for every user. */
export const premiumRouter = Router();
/** Super Admin: premium settings and subscription review. */
export const premiumAdminRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

premiumRouter.get(
  '/status',
  ah(async (req, res) => {
    const u = req.user!;
    const db = getDb();
    const sub = activeSubscription(u.id);
    const queued = queuedSubscription(u.id) ?? null;
    const trial = activeTrialEnd(u.id);
    const pending = db.prepare("SELECT s.id, s.plan, s.amount, s.created_at, s.pricing_plan_id, p.name plan_name FROM subscriptions s LEFT JOIN pricing_plans p ON p.id = s.pricing_plan_id WHERE s.user_id = ? AND s.status = 'draft' ORDER BY s.id DESC LIMIT 1").get(u.id) ?? null;
    const me = db.prepare('SELECT phone, display_name FROM users WHERE id = ?').get(u.id) as { phone: string | null; display_name: string | null };
    res.json({
      isPro: isPro(u.id, u.role),
      plan: u.role === 'super_admin' ? 'admin' : sub?.billing ?? (trial ? 'trial' : null),
      endsAt: sub?.ends_at ?? null,
      trialEndsAt: trial,
      subscription: sub ?? null,
      queued,
      // the plan the user is on was disabled: the next payment has to be for one of the active plans
      needsPlanMigration: !!sub && !sub.plan_active,
      pricingPlans: activePricingPlans(),
      pending,
      profileComplete: !!me.phone && !!me.display_name?.trim() && !!u.email,
      config: getPremiumConfig(),
      usage: usage(u.id),
    });
  }),
);

premiumRouter.get(
  '/mine',
  ah(async (req, res) => {
    const rows = getDb()
      .prepare(`SELECT s.id, s.plan, s.amount, s.currency, s.status, s.outcome, s.receipt_upload_id, s.admin_note, s.subscribed_at, s.starts_at, s.ends_at, s.deleted_at, s.cancelled_at, s.migrate_to, s.created_at, s.pricing_plan_id, p.name plan_name
        FROM subscriptions s LEFT JOIN pricing_plans p ON p.id = s.pricing_plan_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 100`)
      .all(req.user!.id) as any[];
    res.json({ rows: rows.map((r) => ({ ...r, state: subState(r) })) });
  }),
);

/**
 * Billing-type change (monthly ↔ yearly). It only schedules the change: the running subscription stays as it is,
 * the new type applies from the next billing cycle (when the running period ends). `to: null` withdraws a scheduled change.
 */
premiumRouter.post(
  '/migrate',
  ah(async (req, res) => {
    const db = getDb();
    const sub = activeSubscription(req.user!.id);
    if (!sub) throw conflict('You have no running subscription to change.');
    const to = req.body?.to === null ? null : oneOf(req.body?.to, 'to', ['monthly', 'yearly'] as const);
    if (to && to === sub.billing) throw badRequest(`You are already on the ${to} subscription.`);
    if (to && queuedSubscription(req.user!.id)) throw conflict('Your next billing period is already paid. It cannot be changed.');
    db.prepare("UPDATE subscriptions SET migrate_to = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(to, sub.id);
    logActivity({ userId: req.user!.id, event: to ? 'subscription_migrate_schedule' : 'subscription_migrate_clear', entityType: 'subscription', entityId: sub.id, meta: { from: sub.billing, to, effective: sub.ends_at } });
    const who = db.prepare('SELECT email, display_name, phone FROM users WHERE id = ?').get(req.user!.id) as { email: string; display_name: string | null; phone: string | null };
    notifyAdmin('subscription', to ? `Subscription change scheduled: ${sub.billing} → ${to} (${who.display_name || who.email})` : `Subscription change withdrawn (${who.display_name || who.email})`,
      { User: who.display_name, Email: who.email, Phone: who.phone, 'Pricing plan': sub.plan_name ? `${sub.plan_name} (ID ${sub.pricing_plan_id})` : null, 'Current type': sub.billing, 'Change to': to ?? '(withdrawn)', 'Effective from': to ? sub.ends_at : null, Time: new Date().toISOString() });
    res.json({ ok: true, migrate_to: to, effective_at: sub.ends_at });
  }),
);

/** Cancellation: immediate. The user becomes a Free user now; the subscription rows are soft-deleted (kept for audit). */
premiumRouter.post(
  '/cancel',
  ah(async (req, res) => {
    const db = getDb();
    const now = new Date().toISOString();
    const r = db
      .prepare("UPDATE subscriptions SET status = 'cancelled', outcome = 'cancelled_by_user', cancelled_at = ?, deleted_at = ?, migrate_to = NULL, updated_at = ? WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL AND ends_at > ?")
      .run(now, now, now, req.user!.id, now);
    if (!r.changes) throw conflict('You have no active subscription to cancel.');
    logActivity({ userId: req.user!.id, event: 'subscription_cancel', entityType: 'user', entityId: req.user!.id, meta: { subscriptions: r.changes } });
    res.json({ ok: true, cancelled: r.changes });
  }),
);

premiumRouter.post(
  '/subscribe',
  upload.single('receipt'),
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const plan = oneOf(req.body.plan, 'plan', ['monthly', 'yearly'] as const);
    const planId = intParam(req.body.pricing_plan_id, 'pricing_plan_id', { required: true, min: 1 })!;
    const pricing = activePricingPlans().find((p) => p.id === planId);
    if (!pricing) throw badRequest('This pricing plan is not available. Please choose one of the active plans.');
    const running = activeSubscription(uid);
    if (running?.migrate_to && plan !== running.migrate_to) throw badRequest(`You scheduled a change to the ${running.migrate_to} subscription. The next payment has to be a ${running.migrate_to} one.`);
    if (running && queuedSubscription(uid)) throw conflict('Your next billing period is already paid.');
    const me = db.prepare('SELECT email, phone, display_name FROM users WHERE id = ?').get(uid) as { email: string; phone: string | null; display_name: string | null };
    if (!me.email || !me.phone || !me.display_name?.trim()) throw new HttpError(400, 'Please complete your profile (full name, email and phone number) first.', { code: 'PROFILE_INCOMPLETE' });
    if (db.prepare("SELECT 1 FROM subscriptions WHERE user_id = ? AND status = 'draft'").get(uid)) throw conflict('You already have a subscription request waiting for review. Withdraw it first to send a new one.');
    if (!req.file) throw badRequest('Please attach your payment receipt (JPEG, PNG or WebP image).');
    const note = str(req.body.note, 'note', { max: 500 });
    const amount = priceOf(pricing, plan);
    const id = Number(db.prepare('INSERT INTO subscriptions(user_id, plan, amount, user_note, pricing_plan_id) VALUES (?,?,?,?,?)').run(uid, plan, amount, note, planId).lastInsertRowid);
    try {
      const uploadId = await saveUserImage({ userId: uid, buf: req.file.buffer, originalName: req.file.originalname, kind: 'upload', subdir: `subscriptions/${id}` });
      db.prepare('UPDATE subscriptions SET receipt_upload_id = ? WHERE id = ?').run(uploadId, id);
    } catch (e) {
      db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
      throw e;
    }
    logActivity({ userId: uid, event: 'subscription_request', entityType: 'subscription', entityId: id, meta: { plan, amount, pricingPlanId: planId } });
    notifyAdmin('payment', `Payment submitted: ৳${amount} (${plan}) by ${me.display_name || me.email}`, { User: me.display_name, Email: me.email, Phone: me.phone, 'Pricing plan': `${pricing.name} (ID ${planId})`, Type: plan, 'Payable amount': `৳${amount}`, Note: note, Status: 'Pending verification', Time: new Date().toISOString() });
    res.status(201).json({ id, plan, amount, pricing_plan_id: planId });
  }),
);

/** A user withdraws their own request that is still waiting for review. */
premiumRouter.delete(
  '/subscriptions/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const s = db.prepare("SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND status = 'draft'").get(id, req.user!.id) as any;
    if (!s) throw notFound('Request not found');
    db.prepare("UPDATE subscriptions SET status = 'cancelled', outcome = 'withdrawn', admin_note = 'Withdrawn by the user', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
    logActivity({ userId: req.user!.id, event: 'subscription_withdraw', entityType: 'subscription', entityId: id });
    res.json({ ok: true });
  }),
);

/** Receipt image: its owner or the Super Admin only. */
premiumRouter.get(
  '/receipt/:uploadId',
  ah(async (req, res) => {
    const row = getDb()
      .prepare('SELECT s.user_id sender, u.stored_rel_path, u.thumbnail_rel_path, u.mime FROM subscriptions s JOIN user_uploads u ON u.id = s.receipt_upload_id WHERE s.receipt_upload_id = ? AND u.purged_at IS NULL')
      .get(intParam(req.params.uploadId, 'uploadId', { required: true })) as any;
    if (!row || (row.sender !== req.user!.id && req.user!.role !== 'super_admin')) throw notFound('Receipt not found');
    const thumb = req.query.thumb === '1' && row.thumbnail_rel_path;
    const abs = safeResolve(userRoot(row.sender), thumb ? row.thumbnail_rel_path : row.stored_rel_path);
    if (!fs.existsSync(abs)) throw new HttpError(410, 'Receipt file is missing on the server');
    res.setHeader('Content-Type', thumb ? 'image/webp' : row.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(abs);
  }),
);

// ================= Super Admin =================
const limitVal = (v: unknown, field: string, max: number, float = false): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max || (!float && !Number.isInteger(n))) throw badRequest(`${field} must be ${float ? 'a number' : 'a whole number'} between 0 and ${max}, or empty for no limit`);
  return n;
};

premiumAdminRouter.get('/config', ah(async (_req, res) => res.json(getPremiumConfig())));

premiumAdminRouter.put(
  '/config',
  ah(async (req, res) => {
    const b = req.body ?? {};
    const db = getDb();
    const menus: unknown = b.locked_menus ?? [];
    if (!Array.isArray(menus) || menus.length > 200 || menus.some((m) => typeof m !== 'string' || !m.startsWith('/') || m.length > 100)) throw badRequest('locked_menus must be a list of menu paths');
    const models: unknown = b.locked_models ?? [];
    if (!Array.isArray(models) || models.length > 500) throw badRequest('locked_models must be a list of model ids');
    const lockedModels = [...new Set(models.map(Number).filter((n) => Number.isInteger(n) && db.prepare('SELECT 1 FROM models WHERE id = ?').get(n)))];
    const price = (v: unknown, f: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw badRequest(`${f} price must be a whole number of at least 1`);
      return n;
    };
    const p = b.payment ?? {};
    const email = String(p.receipt_email ?? '').trim();
    if (email && !isValidEmail(normalizeEmail(email))) throw badRequest('Receipt e-mail address looks invalid');
    const banks = (Array.isArray(p.banks) ? p.banks : [])
      .slice(0, 10)
      .map((x: any) => ({
        bank: String(x?.bank ?? '').trim().slice(0, 100),
        account_name: String(x?.account_name ?? '').trim().slice(0, 100),
        account_number: String(x?.account_number ?? '').trim().slice(0, 60),
        branch: String(x?.branch ?? '').trim().slice(0, 100),
      }))
      .filter((x: any) => x.bank || x.account_number);
    const cfg: PremiumConfig = {
      locked_menus: [...new Set(menus as string[])],
      locked_models: lockedModels,
      lock_search: !!b.lock_search,
      lock_custom_category: !!b.lock_custom_category,
      lock_requests: !!b.lock_requests,
      lock_text_mapping: !!b.lock_text_mapping,
      lock_highlight_matched: !!b.lock_highlight_matched,
      trial_days: Number.isFinite(Number(b.trial_days)) && String(b.trial_days).trim() !== '' ? Math.max(0, Math.min(365, Math.round(Number(b.trial_days)))) : 2,
      max_upload_mb: limitVal(b.max_upload_mb, 'Max upload (MB)', 1000, true),
      max_comments: limitVal(b.max_comments, 'Max comments', 1_000_000),
      max_highlights: limitVal(b.max_highlights, 'Max highlights', 1_000_000),
      max_bookmarks: limitVal(b.max_bookmarks, 'Max bookmarks', 1_000_000),
      plans: { monthly: { price: price(b.plans?.monthly?.price, 'Monthly'), days: 30 }, yearly: { price: price(b.plans?.yearly?.price, 'Yearly'), days: 365 } },
      payment: {
        bkash_number: String(p.bkash_number ?? '').trim().slice(0, 40),
        bkash_type: String(p.bkash_type ?? '').trim().slice(0, 60),
        banks,
        receipt_email: email,
        instructions: String(p.instructions ?? '').trim().slice(0, 2000),
      },
    };
    setAppSetting('premium_config', cfg, req.user!.id);
    logActivity({ userId: req.user!.id, event: 'premium_config_update' });
    res.json(getPremiumConfig());
  }),
);

// ================= Pricing plans (created once, never edited; only disabled) =================
const priceInt = (v: unknown, field: string) => intParam(v, field, { required: true, min: 0, max: 10_000_000 })!;

premiumAdminRouter.get(
  '/pricing',
  ah(async (_req, res) => {
    const rows = getDb()
      .prepare(`SELECT p.*, c.email created_by_email, c.display_name created_by_name, d.email disabled_by_email,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.pricing_plan_id = p.id AND s.status = 'active' AND s.deleted_at IS NULL AND s.ends_at > ?) subscribers
        FROM pricing_plans p LEFT JOIN users c ON c.id = p.created_by LEFT JOIN users d ON d.id = p.disabled_by ORDER BY p.active DESC, p.id DESC`)
      .all(new Date().toISOString());
    res.json({ rows });
  }),
);

premiumAdminRouter.post(
  '/pricing',
  ah(async (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, 'Plan name', { required: true, max: 80 })!;
    const f = { mo: priceInt(b.monthly_original, 'Monthly original price'), mp: priceInt(b.monthly_price, 'Monthly discounted price'), yo: priceInt(b.yearly_original, 'Yearly original price'), yp: priceInt(b.yearly_price, 'Yearly discounted price') };
    if (f.mp > f.mo) throw badRequest('The monthly discounted price cannot be higher than the original price.');
    if (f.yp > f.yo) throw badRequest('The yearly discounted price cannot be higher than the original price.');
    const id = Number(getDb().prepare('INSERT INTO pricing_plans(name, monthly_original, monthly_price, yearly_original, yearly_price, created_by) VALUES (?,?,?,?,?,?)').run(name, f.mo, f.mp, f.yo, f.yp, req.user!.id).lastInsertRowid);
    audit({ entityType: 'pricing_plan', entityId: id, operation: 'create', next: { name, ...f }, userId: req.user!.id, source: 'admin' });
    res.status(201).json({ id });
  }),
);

/** Disabling is the only change a plan allows (no edit, no re-enable, no delete). The client asks for confirmation first; `confirm: true` proves it. */
premiumAdminRouter.post(
  '/pricing/:id/disable',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    if (req.body?.confirm !== true) throw badRequest('Disabling a pricing plan has to be confirmed.');
    const cur = db.prepare('SELECT * FROM pricing_plans WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Pricing plan not found');
    if (!cur.active) throw conflict('This pricing plan is already disabled.');
    if ((db.prepare('SELECT COUNT(*) c FROM pricing_plans WHERE active = 1').get() as { c: number }).c <= 1) throw conflict('This is the only active pricing plan. Create another plan first, so users can move to it.');
    db.prepare('UPDATE pricing_plans SET active = 0, disabled_by = ?, disabled_at = ?, disabled_reason = ? WHERE id = ?').run(req.user!.id, new Date().toISOString(), str(req.body?.reason, 'reason', { max: 300 }), id);
    audit({ entityType: 'pricing_plan', entityId: id, operation: 'update', previous: { active: 1 }, next: { active: 0 }, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);

// ================= Subscriptions (manual payment review) =================
const STATUSES = ['draft', 'active', 'cancelled'] as const;

premiumAdminRouter.get(
  '/subscriptions',
  ah(async (req, res) => {
    const db = getDb();
    const where: string[] = [];
    const args: unknown[] = [];
    if (req.query.status) {
      where.push('s.status = ?');
      args.push(oneOf(req.query.status, 'status', STATUSES));
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { limit, offset, page } = paging(req.query as any, 30, 200);
    const total = (db.prepare(`SELECT COUNT(*) c FROM subscriptions s ${w}`).get(...args) as any).c;
    const rows = (
      db
        .prepare(`SELECT s.*, u.email, u.display_name, u.phone, p.name plan_name FROM subscriptions s JOIN users u ON u.id = s.user_id LEFT JOIN pricing_plans p ON p.id = s.pricing_plan_id ${w} ORDER BY (s.status = 'draft') DESC, s.id DESC LIMIT ? OFFSET ?`)
        .all(...args, limit, offset) as any[]
    ).map((r) => ({ ...r, state: subState(r) }));
    const counts = db.prepare('SELECT status, COUNT(*) n FROM subscriptions GROUP BY status').all();
    res.json({ total, page, limit, rows, counts });
  }),
);

/**
 * activate = approve the payment: the subscription starts (rounded up to the next full hour, or when the running period ends),
 * and its payment record is created from the plan price. reject = the payment was not accepted (e.g. too little was transferred).
 * cancel = end an approved subscription now (soft delete).
 */
premiumAdminRouter.patch(
  '/subscriptions/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const cur = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Subscription not found');
    const action = oneOf(req.body.action, 'action', ['activate', 'reject', 'cancel'] as const);
    const note = str(req.body.note, 'note', { max: 500 });
    const now = new Date();
    const nowIso = now.toISOString();
    if (action === 'activate') {
      if (cur.status !== 'draft') throw conflict('Only a payment that waits for review can be approved.');
      const running = db.prepare("SELECT MAX(ends_at) e FROM subscriptions WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL AND ends_at > ?").get(cur.user_id, nowIso) as { e: string | null };
      // a paid period that is still running: the new one follows it (next billing cycle); otherwise it starts at the next full hour
      const start = running.e ? new Date(running.e) : ceilHour(now);
      const end = addPeriod(start, cur.plan);
      db.transaction(() => {
        db.prepare("UPDATE subscriptions SET status = 'active', subscribed_at = ?, starts_at = ?, ends_at = ?, admin_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(nowIso, start.toISOString(), end.toISOString(), note, req.user!.id, nowIso, nowIso, id);
        // the scheduled billing-type change is now carried out by this next period
        if (running.e) db.prepare("UPDATE subscriptions SET migrate_to = NULL WHERE user_id = ? AND status = 'active' AND id <> ?").run(cur.user_id, id);
        if (!db.prepare('SELECT 1 FROM payments WHERE subscription_id = ?').get(id)) {
          const u = db.prepare('SELECT display_name, phone FROM users WHERE id = ?').get(cur.user_id) as { display_name: string | null; phone: string | null };
          db.prepare("INSERT INTO payments(user_id, subscription_id, payer_name, payer_phone, amount, method, paid_at, note, created_by, pricing_plan_id, plan_type) VALUES (?,?,?,?,?,'other',?,?,?,?,?)")
            .run(cur.user_id, id, u.display_name, u.phone, cur.amount, nowIso, `Recorded automatically when the ${cur.plan} subscription payment was approved`, req.user!.id, cur.pricing_plan_id, cur.plan);
        }
      })();
    } else if (action === 'reject') {
      if (cur.status !== 'draft') throw conflict('Only a payment that waits for review can be rejected.');
      db.prepare("UPDATE subscriptions SET status = 'cancelled', outcome = 'rejected', admin_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(note, req.user!.id, nowIso, nowIso, id);
    } else {
      if (cur.status !== 'active' || cur.deleted_at) throw conflict('Only a running subscription can be cancelled.');
      db.prepare("UPDATE subscriptions SET status = 'cancelled', outcome = 'cancelled_by_admin', cancelled_at = ?, deleted_at = ?, migrate_to = NULL, admin_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, note, req.user!.id, nowIso, nowIso, id);
    }
    audit({ entityType: 'subscription', entityId: id, operation: 'update', previous: { status: cur.status }, next: { action }, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);

// ================= Payment collection ledger =================
const METHODS = ['bkash', 'bank', 'cash', 'other'] as const;
const PAY_STATUSES = ['received', 'refunded'] as const;

function payFields(b: any, cur?: any) {
  const db = getDb();
  const pick = <T>(k: string, f: () => T, d: T): T => (b[k] === undefined ? (cur ? cur[k] ?? d : d) : f());
  const amount = b.amount === undefined && cur ? cur.amount : intParam(b.amount, 'amount', { required: true, min: 0, max: 100_000_000 })!;
  const paidRaw = b.paid_at === undefined && cur ? cur.paid_at : str(b.paid_at, 'paid_at', { required: true, max: 40 })!;
  const paid = new Date(paidRaw);
  if (Number.isNaN(paid.getTime())) throw badRequest('paid_at must be a valid date');
  let userId: number | null = cur?.user_id ?? null;
  if (b.user_email !== undefined) {
    const e = String(b.user_email ?? '').trim();
    if (!e) userId = null;
    else {
      const u = db.prepare('SELECT id FROM users WHERE email_normalized = ?').get(normalizeEmail(e)) as { id: number } | undefined;
      if (!u) throw badRequest('No user with this e-mail address. Leave it empty to record a payment without a user.');
      userId = u.id;
    }
  }
  let subId: number | null = cur?.subscription_id ?? null;
  if (b.subscription_id !== undefined) {
    subId = intParam(b.subscription_id, 'subscription_id', { min: 1 });
    if (subId && !db.prepare('SELECT 1 FROM subscriptions WHERE id = ?').get(subId)) throw badRequest('Subscription not found');
  }
  return {
    user_id: userId,
    subscription_id: subId,
    payer_name: pick('payer_name', () => str(b.payer_name, 'payer_name', { max: 120 }), null),
    payer_phone: pick('payer_phone', () => str(b.payer_phone, 'payer_phone', { max: 40 }), null),
    amount,
    method: b.method === undefined && cur ? cur.method : oneOf(b.method, 'method', METHODS, 'bkash'),
    trx_id: pick('trx_id', () => str(b.trx_id, 'trx_id', { max: 80 }), null),
    paid_at: paid.toISOString(),
    status: b.status === undefined && cur ? cur.status : oneOf(b.status, 'status', PAY_STATUSES, 'received'),
    note: pick('note', () => str(b.note, 'note', { max: 1000 }), null),
  };
}

premiumAdminRouter.get(
  '/payments',
  ah(async (req, res) => {
    const db = getDb();
    const where: string[] = [];
    const args: unknown[] = [];
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      where.push("(p.payer_name LIKE ? ESCAPE '\\' OR p.payer_phone LIKE ? ESCAPE '\\' OR p.trx_id LIKE ? ESCAPE '\\' OR p.note LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR CAST(p.amount AS TEXT) = ?)");
      args.push(like, like, like, like, like, like, q);
    }
    if (req.query.method) { where.push('p.method = ?'); args.push(oneOf(req.query.method, 'method', METHODS)); }
    if (req.query.status) { where.push('p.status = ?'); args.push(oneOf(req.query.status, 'status', PAY_STATUSES)); }
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if (from && !Number.isNaN(from.getTime())) { where.push('p.paid_at >= ?'); args.push(from.toISOString()); }
    if (to && !Number.isNaN(to.getTime())) { where.push('p.paid_at < ?'); args.push(new Date(to.getTime() + 86_400_000).toISOString()); } // "to" day included
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const from_ = 'FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN subscriptions s ON s.id = p.subscription_id LEFT JOIN pricing_plans pp ON pp.id = p.pricing_plan_id';
    const { limit, offset, page } = paging(req.query as any, 25, 200);
    const t = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN p.status = 'received' THEN p.amount END), 0) received, COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN p.amount END), 0) refunded ${from_} ${w}`).get(...args) as any;
    const rows = db.prepare(`SELECT p.*, u.email user_email, u.display_name user_name, s.plan subscription_plan, pp.name pricing_plan_name, p.plan_type ${from_} ${w} ORDER BY p.paid_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    res.json({ total: t.total, page, limit, rows, sums: { received: t.received, refunded: t.refunded } });
  }),
);

premiumAdminRouter.post(
  '/payments',
  ah(async (req, res) => {
    const f = payFields(req.body ?? {});
    const id = Number(
      getDb()
        .prepare('INSERT INTO payments(user_id, subscription_id, payer_name, payer_phone, amount, method, trx_id, paid_at, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(f.user_id, f.subscription_id, f.payer_name, f.payer_phone, f.amount, f.method, f.trx_id, f.paid_at, f.status, f.note, req.user!.id).lastInsertRowid,
    );
    audit({ entityType: 'payment', entityId: id, operation: 'create', next: { amount: f.amount, method: f.method }, userId: req.user!.id, source: 'admin' });
    res.status(201).json({ id });
  }),
);

premiumAdminRouter.patch(
  '/payments/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const cur = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Payment not found');
    const f = payFields(req.body ?? {}, cur);
    db.prepare("UPDATE payments SET user_id=?, subscription_id=?, payer_name=?, payer_phone=?, amount=?, method=?, trx_id=?, paid_at=?, status=?, note=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(f.user_id, f.subscription_id, f.payer_name, f.payer_phone, f.amount, f.method, f.trx_id, f.paid_at, f.status, f.note, id);
    audit({ entityType: 'payment', entityId: id, operation: 'update', previous: { amount: cur.amount, status: cur.status }, next: { amount: f.amount, status: f.status }, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);

premiumAdminRouter.delete(
  '/payments/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const cur = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Payment not found');
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    audit({ entityType: 'payment', entityId: id, operation: 'delete', previous: { amount: cur.amount, method: cur.method, trx_id: cur.trx_id }, userId: req.user!.id, source: 'admin' });
    res.json({ ok: true });
  }),
);
