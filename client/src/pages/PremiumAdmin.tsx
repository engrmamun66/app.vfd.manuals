import { toast } from '../components/toast';
import { useEffect, useState } from 'react';
import { del, get, patch, post, put, fmtDate } from '../lib/api';
import { confirmDialog } from '../components/dialogs';
import { Crumbs, DateField, ErrorBox, Loading, Modal, Pager, SearchBox, useAsync } from '../components/ui';
import { mainSections } from '../lib/nav';
import { usePremium, type PremiumConfig } from '../lib/premium';

const PLAN = { monthly: 'Monthly', yearly: 'Yearly' } as const;

/** Super Admin: subscription requests. Check the payment receipt, then make the user Premium or cancel the request. */
export function SubscriptionsAdmin() {
  const [status, setStatus] = useState('draft');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useAsync(() => get('/premium-admin/subscriptions', { status, page, limit: 20 }), [status, page]);
  const [big, setBig] = useState<number | null>(null);
  const counts: Record<string, number> = Object.fromEntries((data?.counts ?? []).map((c: any) => [c.status, c.n]));
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Superadmin Panel' }, { label: 'Subscriptions' }]} />
      <h1>Subscriptions</h1>
      <p className="muted prose">Open the receipt, confirm the payment arrived, then press <b>Make premium</b>. The user becomes Pro for the plan period (a running period is extended). <b>Cancel</b> rejects a request or ends a subscription.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter">
          <option value="">All</option>
          <option value="draft">Waiting for review{counts.draft ? ` (${counts.draft})` : ''}</option>
          <option value="active">Active{counts.active ? ` (${counts.active})` : ''}</option>
          <option value="cancelled">Cancelled{counts.cancelled ? ` (${counts.cancelled})` : ''}</option>
        </select>
      </div>
      <ErrorBox e={error} />
      {!data && !error && <Loading />}
      {data && data.rows.length === 0 && <div className="empty">No subscription requests.</div>}
      <div className="stack">{data?.rows.map((r: any) => <SubscriptionCard key={r.id} r={r} onSaved={reload} onReceipt={setBig} />)}</div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      {big !== null && <Modal title="Payment receipt" onClose={() => setBig(null)} wide><img src={`/api/premium/receipt/${big}`} alt="Payment receipt" style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} /></Modal>}
    </div>
  );
}

function SubscriptionCard({ r, onSaved, onReceipt }: { r: any; onSaved: () => void; onReceipt: (id: number) => void }) {
  const [note, setNote] = useState(r.admin_note ?? '');
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: 'activate' | 'cancel') => {
    setErr(null); setBusy(true);
    try { await patch(`/premium-admin/subscriptions/${r.id}`, { action, note }); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className={`card fb-card ${r.status}`}>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <div className="row">
          <span className={`badge ${r.status === 'active' ? 'solid' : r.status === 'draft' ? 'strong' : 'dashed'}`}>{r.status === 'draft' ? 'Waiting for review' : r.status === 'active' ? 'Active' : 'Cancelled'}</span>
          <b>{r.display_name ?? r.email}</b>
          <span className="small-text muted">{r.email}</span>
        </div>
        <span className="small-text muted">{fmtDate(r.created_at)}</span>
      </div>
      <div className="small-text" style={{ marginTop: 6 }}>
        <b>{PLAN[r.plan as 'monthly' | 'yearly']}</b> · ৳{r.amount} {r.currency}
        {r.phone && <> · ☎ <a href={`tel:${r.phone}`}>{r.phone}</a></>}
        {r.status === 'active' && <> · valid {fmtDate(r.starts_at)} → {fmtDate(r.ends_at)}</>}
      </div>
      {r.user_note && <p className="small-text" style={{ margin: '6px 0' }}><b>User note:</b> {r.user_note}</p>}
      {r.receipt_upload_id && (
        <div className="thumbs"><button type="button" className="thumb" onClick={() => onReceipt(r.receipt_upload_id)} title="Open the receipt"><img src={`/api/premium/receipt/${r.receipt_upload_id}?thumb=1`} alt="Payment receipt" /></button></div>
      )}
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Note to the user (optional)" aria-label="Admin note" style={{ flex: 1, minWidth: 200 }} />
        {r.status !== 'active' && <button className="primary small" disabled={busy} onClick={() => act('activate')}>Make premium</button>}
        {r.status !== 'cancelled' && <button className="small" disabled={busy} onClick={() => act('cancel')}>{r.status === 'active' ? 'Cancel subscription' : 'Cancel request'}</button>}
      </div>
      <ErrorBox e={err} />
    </div>
  );
}

const numOrEmpty = (v: number | null) => (v === null || v === undefined ? '' : String(v));

/** Super Admin: what is limited for free users, prices and payment details. */
export function PremiumSettings() {
  const { reload: reloadStatus } = usePremium();
  const { data: loaded, error } = useAsync<PremiumConfig>(() => get('/premium-admin/config'), []);
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const { data: models } = useAsync<any[]>(() => get('/models'), []);
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (loaded) setCfg({ ...loaded, max_upload_mb: numOrEmpty(loaded.max_upload_mb), max_comments: numOrEmpty(loaded.max_comments), max_highlights: numOrEmpty(loaded.max_highlights), max_bookmarks: numOrEmpty(loaded.max_bookmarks) }); }, [loaded]);
  if (error) return <div className="page"><ErrorBox e={error} /></div>;
  if (!cfg) return <div className="page"><Loading /></div>;
  const set = (k: string, v: unknown) => setCfg((c: any) => ({ ...c, [k]: v }));
  const setPay = (k: string, v: unknown) => setCfg((c: any) => ({ ...c, payment: { ...c.payment, [k]: v } }));
  const locked = new Set<string>(cfg.locked_menus);
  const toggleMenus = (paths: string[], on: boolean) => { const s = new Set(locked); paths.forEach((p) => (on ? s.add(p) : s.delete(p))); set('locked_menus', [...s]); };
  const sections = mainSections(tax).map((s) => ({ ...s, items: s.items.filter(([to]) => to !== '/' && to !== '/knowledge') })).filter((s) => s.title && s.items.length);
  const lockedModels = new Set<number>(cfg.locked_models);
  const toggleModel = (id: number, on: boolean) => { const s = new Set(lockedModels); on ? s.add(id) : s.delete(id); set('locked_models', [...s]); };
  const banks: any[] = cfg.payment.banks;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const n = (v: string) => (String(v).trim() === '' ? null : Number(v));
      await put('/premium-admin/config', { ...cfg, max_upload_mb: n(cfg.max_upload_mb), max_comments: n(cfg.max_comments), max_highlights: n(cfg.max_highlights), max_bookmarks: n(cfg.max_bookmarks) });
      await reloadStatus();
      setMsg({ ok: true, text: 'Saved.' }); toast('Premium settings saved');
    } catch (e: any) { setMsg({ ok: false, text: e.message }); toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <Crumbs items={[{ label: 'Superadmin Panel' }, { label: 'Premium Settings' }]} />
      <h1>Premium Settings</h1>
      <p className="muted prose">Free users can open everything, but the items you mark here need a Pro plan. When a free user opens a locked menu or model, or reaches a limit, the pricing dialog opens instead.</p>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Locked menus</h2>
        <div className="lock-grid">
          {sections.map((s) => {
            const paths = s.items.map(([to]) => to);
            const all = paths.every((p) => locked.has(p));
            const some = paths.some((p) => locked.has(p));
            return (
              <fieldset key={s.title} className="lock-group">
                <legend><label><input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={(e) => toggleMenus(paths, e.target.checked)} /> <b>{s.title}</b></label></legend>
                {s.items.map(([to, label, sub]) => (
                  <label key={to} className="lock-item" style={{ paddingLeft: sub ? 18 : 0 }}><input type="checkbox" checked={locked.has(to)} onChange={(e) => toggleMenus([to], e.target.checked)} /> {label}</label>
                ))}
              </fieldset>
            );
          })}
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Locked VFD models</h2>
        {!models ? <Loading /> : (
          <div className="lock-grid">
            {models.map((m) => <label key={m.id} className="lock-item"><input type="checkbox" checked={lockedModels.has(m.id)} onChange={(e) => toggleModel(m.id, e.target.checked)} /> {m.brand} {m.name}</label>)}
          </div>
        )}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Manual page images</h2>
        <label className="lock-item"><input type="checkbox" checked={!!cfg.lock_highlight_matched} onChange={(e) => set('lock_highlight_matched', e.target.checked)} /> Highlighting matched words on Manual image needs Pro (the cited value marked in yellow)</label>
        <label className="lock-item"><input type="checkbox" checked={!!cfg.lock_text_mapping} onChange={(e) => set('lock_text_mapping', e.target.checked)} /> Text mapping on manual images needs Pro (selecting, copying, commenting and highlighting text on the page image)</label>
        <div className="small-text faint">Checked = not available to free users. Pro users and Super Admins always have both. The yellow mark needs text mapping.</div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Features and limits for free users</h2>
        <label className="lock-item"><input type="checkbox" checked={cfg.lock_search} onChange={(e) => set('lock_search', e.target.checked)} /> Search needs Pro</label>
        <label className="lock-item"><input type="checkbox" checked={cfg.lock_custom_category} onChange={(e) => set('lock_custom_category', e.target.checked)} /> Custom categories need Pro</label>
        <label className="lock-item"><input type="checkbox" checked={cfg.lock_requests} onChange={(e) => set('lock_requests', e.target.checked)} /> Sending a “Request” (e.g. a new VFD manual) needs Pro</label>
        <div className="field" style={{ maxWidth: 340 }}><label htmlFor="trial-days">Free full access after registration (days)</label><input id="trial-days" type="number" min={0} max={365} step={1} value={cfg.trial_days ?? 1} onChange={(e) => set('trial_days', e.target.value)} /><div className="small-text faint">0 = none. A new user gets Pro features for this many days; you can change the end date of any user in Users &amp; Monitoring.</div></div>
        <div className="limits">
          {([['max_upload_mb', 'Max upload for comments (MB)', 0.1], ['max_comments', 'Max comments (count)', 1], ['max_highlights', 'Max highlights (count)', 1], ['max_bookmarks', 'Max bookmarks (count)', 1]] as const).map(([k, label, step]) => (
            <div className="field" key={k}><label htmlFor={`lim-${k}`}>{label}</label><input id={`lim-${k}`} type="number" min={0} step={step} value={cfg[k]} placeholder="no limit" onChange={(e) => set(k, e.target.value)} /></div>
          ))}
        </div>
        <div className="small-text faint">Leave a limit empty for “no limit”. Pro users and Super Admins are never limited.</div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Prices (৳)</h2>
        <div className="limits">
          <div className="field"><label htmlFor="price-m">Monthly (30 days)</label><input id="price-m" type="number" min={1} value={cfg.plans.monthly.price} onChange={(e) => set('plans', { ...cfg.plans, monthly: { ...cfg.plans.monthly, price: e.target.value } })} /></div>
          <div className="field"><label htmlFor="price-y">Yearly (365 days)</label><input id="price-y" type="number" min={1} value={cfg.plans.yearly.price} onChange={(e) => set('plans', { ...cfg.plans, yearly: { ...cfg.plans.yearly, price: e.target.value } })} /></div>
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Payment details shown to users</h2>
        <div className="limits">
          <div className="field"><label htmlFor="bk-n">bKash number</label><input id="bk-n" value={cfg.payment.bkash_number} onChange={(e) => setPay('bkash_number', e.target.value)} placeholder="01XXXXXXXXX" /></div>
          <div className="field"><label htmlFor="bk-t">bKash account type</label><input id="bk-t" value={cfg.payment.bkash_type} onChange={(e) => setPay('bkash_type', e.target.value)} /></div>
          <div className="field"><label htmlFor="rc-e">Receipt e-mail</label><input id="rc-e" type="email" value={cfg.payment.receipt_email} onChange={(e) => setPay('receipt_email', e.target.value)} placeholder="payments@example.com" /></div>
        </div>
        <b>Bank accounts</b>
        {banks.map((b, i) => (
          <div key={i} className="limits">
            {([['bank', 'Bank'], ['account_name', 'Account name'], ['account_number', 'Account number'], ['branch', 'Branch']] as const).map(([k, label]) => (
              <div className="field" key={k}><label htmlFor={`bank-${i}-${k}`}>{label}</label><input id={`bank-${i}-${k}`} value={b[k]} onChange={(e) => setPay('banks', banks.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></div>
            ))}
            <div className="field"><label>&nbsp;</label><button type="button" className="small" onClick={() => setPay('banks', banks.filter((_, j) => j !== i))}>Remove</button></div>
          </div>
        ))}
        <div><button type="button" className="small" disabled={banks.length >= 10} onClick={() => setPay('banks', [...banks, { bank: '', account_name: '', account_number: '', branch: '' }])}>+ Add bank account</button></div>
        <div className="field"><label htmlFor="pay-ins">Instructions shown to the user</label><textarea id="pay-ins" rows={4} maxLength={2000} value={cfg.payment.instructions} onChange={(e) => setPay('instructions', e.target.value)} /></div>
      </div>

      {msg && <div className={msg.ok ? 'ok-box' : 'err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="row sticky-save"><button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save premium settings'}</button></div>
    </div>
  );
}

// ================= Payment collection =================
const METHOD = { bkash: 'bKash', bank: 'Bank', cash: 'Cash', other: 'Other' } as const;
const taka = (n: number) => `৳${Number(n || 0).toLocaleString()}`;
const toLocalInput = (iso?: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Super Admin: ledger of collected payments — add, search, edit, delete. */
export function PaymentsAdmin() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [err, setErr] = useState<any>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const { data, error, reload } = useAsync(() => get('/premium-admin/payments', { q: dq, method, status, from, to, page, limit: 25 }), [dq, method, status, from, to, page]);
  const remove = async (r: any) => {
    if (!(await confirmDialog(`Delete this payment of ${taka(r.amount)}${r.trx_id ? ` (${r.trx_id})` : ''}? This cannot be undone.`, { danger: true }))) return;
    try { setErr(null); await del(`/premium-admin/payments/${r.id}`); reload(); } catch (e) { setErr(e); }
  };
  const filtered = !!(dq || method || status || from || to);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Superadmin Panel' }, { label: 'Payments' }]} />
      <div className="row between"><h1>Payments</h1><button className="primary" onClick={() => setEdit('new')}>+ Add payment</button></div>
      <p className="muted prose">Every payment collected for subscriptions. Activating a subscription adds its payment here automatically; add the others by hand.</p>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <SearchBox placeholder="Search name, phone, e-mail, transaction ID, note, amount…" value={q} onChange={setQ} aria-label="Search payments" style={{ minWidth: 280, flex: 1 }} />
        <select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} aria-label="Method filter"><option value="">All methods</option>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter"><option value="">All statuses</option><option value="received">Received</option><option value="refunded">Refunded</option></select>
        <label className="row small-text">From <DateField clearable label="From date" value={from} onChange={(v) => { setFrom(v); setPage(1); }} /></label>
        <label className="row small-text">To <DateField clearable label="To date" value={to} onChange={(v) => { setTo(v); setPage(1); }} /></label>
        {filtered && <button className="small" onClick={() => { setQ(''); setMethod(''); setStatus(''); setFrom(''); setTo(''); }}>Clear filters</button>}
      </div>
      <ErrorBox e={error ?? err} />
      {!data && !error && <Loading />}
      {data && (
        <div className="row small-text" style={{ marginBottom: 8, gap: 18, flexWrap: 'wrap' }}>
          <span><b>{data.total}</b> payment{data.total === 1 ? '' : 's'}</span>
          <span>Received: <b>{taka(data.sums.received)}</b></span>
          <span>Refunded: <b>{taka(data.sums.refunded)}</b></span>
        </div>
      )}
      {data && data.rows.length === 0 && <div className="empty">{filtered ? 'No payment matches the search.' : 'No payments recorded yet.'}</div>}
      {data && data.rows.length > 0 && (
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Payer</th><th>Amount</th><th>Method</th><th>Transaction ID</th><th>Plan</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>
          {data.rows.map((r: any) => (
            <tr key={r.id}>
              <td className="small-text">{fmtDate(r.paid_at)}</td>
              <td><b>{r.payer_name || r.user_name || r.user_email || '—'}</b>{r.user_email && <div className="small-text muted">{r.user_email}</div>}{r.payer_phone && <div className="small-text muted">{r.payer_phone}</div>}</td>
              <td><b>{taka(r.amount)}</b></td>
              <td>{METHOD[r.method as keyof typeof METHOD]}</td>
              <td className="mono small-text">{r.trx_id ?? '—'}</td>
              <td>{r.subscription_plan ? PLAN[r.subscription_plan as 'monthly' | 'yearly'] : '—'}</td>
              <td><span className={`badge ${r.status === 'received' ? 'strong' : 'dashed'}`}>{r.status === 'received' ? 'Received' : 'Refunded'}</span></td>
              <td className="small-text">{r.note ?? ''}</td>
              <td><div className="row"><button className="small" onClick={() => setEdit(r)}>Edit</button><button className="small" onClick={() => remove(r)}>Delete</button></div></td>
            </tr>))}
        </tbody></table></div>
      )}
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      {edit && <PaymentForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function PaymentForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    amount: row ? String(row.amount) : '', method: row?.method ?? 'bkash', paid_at: toLocalInput(row?.paid_at), status: row?.status ?? 'received',
    user_email: row?.user_email ?? '', payer_name: row?.payer_name ?? '', payer_phone: row?.payer_phone ?? '', trx_id: row?.trx_id ?? '', subscription_id: row?.subscription_id ? String(row.subscription_id) : '', note: row?.note ?? '',
  });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const body = { ...f, paid_at: new Date(f.paid_at).toISOString(), subscription_id: f.subscription_id.trim() === '' ? null : Number(f.subscription_id) };
      if (row) await patch(`/premium-admin/payments/${row.id}`, body); else await post('/premium-admin/payments', body);
      onSaved();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal title={row ? 'Edit payment' : 'Add payment'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="limits">
          <div className="field"><label htmlFor="pm-amt">Amount (৳)</label><input id="pm-amt" type="number" min={0} step={1} value={f.amount} onChange={set('amount')} required autoFocus /></div>
          <div className="field"><label htmlFor="pm-method">Method</label><select id="pm-method" value={f.method} onChange={set('method')}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="pm-date">Paid at</label><DateField id="pm-date" withTime required label="Paid at" value={f.paid_at} onChange={(v) => setF((x) => ({ ...x, paid_at: v }))} /></div>
          <div className="field"><label htmlFor="pm-status">Status</label><select id="pm-status" value={f.status} onChange={set('status')}><option value="received">Received</option><option value="refunded">Refunded</option></select></div>
        </div>
        <div className="field"><label htmlFor="pm-user">User e-mail <span className="faint">(optional, links the payment to an account)</span></label><input id="pm-user" type="email" value={f.user_email} onChange={set('user_email')} style={{ width: '100%' }} /></div>
        <div className="limits">
          <div className="field"><label htmlFor="pm-name">Payer name</label><input id="pm-name" value={f.payer_name} maxLength={120} onChange={set('payer_name')} /></div>
          <div className="field"><label htmlFor="pm-phone">Payer phone</label><input id="pm-phone" value={f.payer_phone} maxLength={40} onChange={set('payer_phone')} /></div>
          <div className="field"><label htmlFor="pm-trx">Transaction ID</label><input id="pm-trx" value={f.trx_id} maxLength={80} onChange={set('trx_id')} /></div>
          <div className="field"><label htmlFor="pm-sub">Subscription # <span className="faint">(optional)</span></label><input id="pm-sub" type="number" min={1} value={f.subscription_id} onChange={set('subscription_id')} /></div>
        </div>
        <div className="field"><label htmlFor="pm-note">Note</label><textarea id="pm-note" rows={3} maxLength={1000} value={f.note} onChange={set('note')} /></div>
        <ErrorBox e={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}
