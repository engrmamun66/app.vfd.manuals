import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { ah, badRequest, conflict, HttpError, intParam, notFound, oneOf, paging, str } from '../lib/http.js';
import { audit, logActivity } from '../lib/audit.js';
import { safeResolve, saveUserImage, userRoot } from '../services/storage.js';
import { setAppSetting } from '../services/settings.js';
import { activeSubscription, getPremiumConfig, isPro, usage, type PremiumConfig } from '../services/premium.js';
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
    const pending = db.prepare("SELECT id, plan, amount, created_at FROM subscriptions WHERE user_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1").get(u.id) ?? null;
    const me = db.prepare('SELECT phone, display_name FROM users WHERE id = ?').get(u.id) as { phone: string | null; display_name: string | null };
    res.json({
      isPro: isPro(u.id, u.role),
      plan: u.role === 'super_admin' ? 'admin' : sub?.plan ?? null,
      endsAt: sub?.ends_at ?? null,
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
    res.json({ rows: getDb().prepare('SELECT id, plan, amount, currency, status, receipt_upload_id, admin_note, starts_at, ends_at, created_at FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user!.id) });
  }),
);

premiumRouter.post(
  '/subscribe',
  upload.single('receipt'),
  ah(async (req, res) => {
    const db = getDb();
    const uid = req.user!.id;
    const plan = oneOf(req.body.plan, 'plan', ['monthly', 'yearly'] as const);
    const me = db.prepare('SELECT email, phone, display_name FROM users WHERE id = ?').get(uid) as { email: string; phone: string | null; display_name: string | null };
    if (!me.email || !me.phone || !me.display_name?.trim()) throw new HttpError(400, 'Please complete your profile (full name, email and phone number) first.', { code: 'PROFILE_INCOMPLETE' });
    if (db.prepare("SELECT 1 FROM subscriptions WHERE user_id = ? AND status = 'draft'").get(uid)) throw conflict('You already have a subscription request waiting for review. Withdraw it first to send a new one.');
    if (!req.file) throw badRequest('Please attach your payment receipt (JPEG, PNG or WebP image).');
    const note = str(req.body.note, 'note', { max: 500 });
    const amount = getPremiumConfig().plans[plan].price;
    const id = Number(db.prepare('INSERT INTO subscriptions(user_id, plan, amount, user_note) VALUES (?,?,?,?)').run(uid, plan, amount, note).lastInsertRowid);
    try {
      const uploadId = await saveUserImage({ userId: uid, buf: req.file.buffer, originalName: req.file.originalname, kind: 'upload', subdir: `subscriptions/${id}` });
      db.prepare('UPDATE subscriptions SET receipt_upload_id = ? WHERE id = ?').run(uploadId, id);
    } catch (e) {
      db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
      throw e;
    }
    logActivity({ userId: uid, event: 'subscription_request', entityType: 'subscription', entityId: id, meta: { plan, amount } });
    res.status(201).json({ id, plan, amount });
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
    db.prepare("UPDATE subscriptions SET status = 'cancelled', admin_note = 'Withdrawn by the user', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
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
      text_mapping: b.text_mapping !== false,
      highlight_matched: b.highlight_matched !== false,
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
    const rows = db
      .prepare(`SELECT s.*, u.email, u.display_name, u.phone FROM subscriptions s JOIN users u ON u.id = s.user_id ${w} ORDER BY (s.status = 'draft') DESC, s.id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    const counts = db.prepare('SELECT status, COUNT(*) n FROM subscriptions GROUP BY status').all();
    res.json({ total, page, limit, rows, counts });
  }),
);

/** activate = the user becomes Pro for the plan's period (extends a period that is still running); cancel = reject a request / end a subscription. */
premiumAdminRouter.patch(
  '/subscriptions/:id',
  ah(async (req, res) => {
    const db = getDb();
    const id = intParam(req.params.id, 'id', { required: true })!;
    const cur = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Subscription not found');
    const action = oneOf(req.body.action, 'action', ['activate', 'cancel'] as const);
    const note = str(req.body.note, 'note', { max: 500 });
    const now = new Date();
    if (action === 'activate') {
      if (cur.status === 'active') throw conflict('Already active');
      const running = db.prepare("SELECT MAX(ends_at) e FROM subscriptions WHERE user_id = ? AND status = 'active' AND ends_at > ?").get(cur.user_id, now.toISOString()) as { e: string | null };
      const start = running.e ? new Date(running.e) : now;
      const days = getPremiumConfig().plans[cur.plan as 'monthly' | 'yearly'].days;
      const end = new Date(start.getTime() + days * 86_400_000);
      db.prepare("UPDATE subscriptions SET status = 'active', starts_at = ?, ends_at = ?, admin_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(start.toISOString(), end.toISOString(), note, req.user!.id, now.toISOString(), now.toISOString(), id);
      if (!db.prepare('SELECT 1 FROM payments WHERE subscription_id = ?').get(id)) {
        const u = db.prepare('SELECT display_name, phone FROM users WHERE id = ?').get(cur.user_id) as { display_name: string | null; phone: string | null };
        db.prepare("INSERT INTO payments(user_id, subscription_id, payer_name, payer_phone, amount, method, paid_at, note, created_by) VALUES (?,?,?,?,?,'other',?,?,?)").run(cur.user_id, id, u.display_name, u.phone, cur.amount, now.toISOString(), 'Recorded automatically when the subscription was activated. Set the payment method and transaction ID.', req.user!.id);
      }
    } else {
      if (cur.status === 'cancelled') throw conflict('Already cancelled');
      db.prepare("UPDATE subscriptions SET status = 'cancelled', ends_at = CASE WHEN status = 'active' THEN ? ELSE ends_at END, admin_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(now.toISOString(), note, req.user!.id, now.toISOString(), now.toISOString(), id);
    }
    audit({ entityType: 'subscription', entityId: id, operation: 'update', previous: { status: cur.status }, next: { status: action === 'activate' ? 'active' : 'cancelled' }, userId: req.user!.id, source: 'admin' });
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
    const from_ = 'FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN subscriptions s ON s.id = p.subscription_id';
    const { limit, offset, page } = paging(req.query as any, 25, 200);
    const t = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN p.status = 'received' THEN p.amount END), 0) received, COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN p.amount END), 0) refunded ${from_} ${w}`).get(...args) as any;
    const rows = db.prepare(`SELECT p.*, u.email user_email, u.display_name user_name, s.plan subscription_plan ${from_} ${w} ORDER BY p.paid_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
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
