import { useEffect, useMemo, useRef, useState } from 'react';
import { api, del, fmtDate, get, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePremium, type PremiumConfig } from '../lib/premium';
import { ErrorBox, Loading, Modal } from './ui';

const PLAN_LABEL = { monthly: 'Monthly', yearly: 'Yearly' } as const;
const PRO_FEATURES = [
  'Unlimited comments and highlighting',
  'Unlimited bookmarks and your own categories',
  'All VFD models and every menu unlocked',
  'All future updates included',
  'Send requests for new VFD manuals (we act within 24 hours, Monday to Thursday; Friday to Sunday we try our best)',
  '24/7 customer support',
];
type Stage = 'plans' | 'profile' | 'pay' | 'done';

const limit = (n: number | null, what: string, unit = '') => (n === null ? `Unlimited ${what}` : `Up to ${n}${unit} ${what}`);

/** "Get Pro" dialog: compare plans, complete the profile, pay, attach the receipt and send the request for review. */
export function PlansModal({ reason, onClose }: { reason?: string; onClose: () => void }) {
  const { user, refresh } = useAuth();
  const { status, reload, isPro } = usePremium();
  const [stage, setStage] = useState<Stage>('plans');
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly');
  const [planId, setPlanId] = useState<number | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [name, setName] = useState(user?.displayName ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!status) return <Modal title="Get Pro" onClose={onClose}><Loading /></Modal>;
  const cfg = status.config;
  const plans = status.pricingPlans ?? [];
  const chosen = plans.find((p) => p.id === planId) ?? plans[0];
  const sub = status.subscription;
  const migrateTo = sub?.migrate_to ?? null; // a billing-type change is scheduled: the next payment has to be for it
  const monthly = chosen?.monthly_price ?? 0;
  const yearly = chosen?.yearly_price ?? 0;
  const saving = monthly > 0 ? Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100)) : 0;
  // a paid period is running: the new payment is for the next billing cycle, which starts when the running one ends
  const startsAt = sub ? status.queued?.ends_at ? null : sub.ends_at : null;

  const choose = (p: 'monthly' | 'yearly') => {
    if (!chosen) return setError('No pricing plan is available right now.');
    if (migrateTo && p !== migrateTo) return setError(`You scheduled a change to the ${migrateTo} subscription. Your next payment has to be a ${migrateTo} one.`);
    setPlan(p);
    setError(null);
    // an account needs an e-mail address and a phone number before it can become a paid account
    setStage(status.profileComplete ? 'pay' : 'profile');
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Full name is required.');
    if (!phone.trim()) return setError('Phone number is required.');
    setBusy(true);
    setError(null);
    try {
      await patch('/auth/profile', { phone: phone.trim(), displayName: name.trim() });
      await refresh();
      await reload();
      setStage('pay');
    } catch (err: any) {
      setError(err.message || 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setError('The receipt must be a JPEG, PNG or WebP image.');
    if (f.size > 10 * 1024 * 1024) return setError('The receipt image is larger than 10 MB.');
    setError(null);
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError('Please attach your payment receipt.');
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('plan', plan);
      form.append('pricing_plan_id', String(chosen?.id ?? ''));
      form.append('receipt', file);
      if (note.trim()) form.append('note', note.trim());
      await api('/premium/subscribe', { method: 'POST', form });
      await reload();
      setStage('done');
    } catch (err: any) {
      setError(err.message || 'Could not send your request.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!status.pending) return;
    setBusy(true);
    try { await del(`/premium/subscriptions/${status.pending.id}`); await reload(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const pay = cfg.payment;
  const amount = plan === 'monthly' ? monthly : yearly;

  return (
    <Modal title={stage === 'plans' ? 'Get Pro' : stage === 'done' ? 'Request sent' : stage === 'profile' ? 'Complete your profile' : `${PLAN_LABEL[plan]} plan`} onClose={onClose} wide={stage === 'plans'}>
      {stage === 'plans' && (
        <div className="stack">
          {reason && <div className="err" role="status"><b>Upgrade needed.</b> {reason}</div>}
          {isPro && (
            <div className="ok-box" role="status"><b>You have Pro access</b>{status.plan === 'admin' ? ' (administrator).' : status.plan === 'trial' ? <> — free full access until {fmtDate(status.trialEndsAt)}. Subscribe to keep Pro after that.</> : <> — {status.plan} plan, valid until {fmtDate(status.endsAt)}.</>}</div>
          )}
          {status.needsPlanMigration && (
            <div className="err" role="status"><b>Your pricing plan ({sub?.plan_name}) was discontinued.</b> Your paid period stays valid until {fmtDate(sub?.ends_at)}. For your next payment please choose one of the plans below.</div>
          )}
          {sub && !status.needsPlanMigration && (
            <div className="ok-box" role="status">
              {status.queued ? <>Your next billing period is already paid ({PLAN_LABEL[status.queued.billing]}, {fmtDate(status.queued.starts_at)} → {fmtDate(status.queued.ends_at)}).</> : <>A new payment now is for your <b>next billing cycle</b>, starting {fmtDate(sub.ends_at)}.</>}
            </div>
          )}
          {status.pending && (
            <div className="ok-box" role="status">
              Your <b>{PLAN_LABEL[status.pending.plan]}</b> request (sent {fmtDate(status.pending.created_at)}) is waiting for the administrator.
              <div style={{ marginTop: 6 }}><button className="small" disabled={busy} onClick={withdraw}>Withdraw this request</button></div>
            </div>
          )}
          {plans.length > 1 && (
            <div className="field" style={{ maxWidth: 360 }}><label htmlFor="pp-sel">Pricing plan</label>
              <select id="pp-sel" value={chosen?.id} onChange={(e) => setPlanId(Number(e.target.value))}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} (ID {p.id})</option>)}</select></div>
          )}
          <div className="plans">
            <div className={`plan ${!isPro ? 'current' : ''}`}>
              <h3>Free <span className="faint" style={{ fontWeight: 400 }}>(limited use)</span></h3>
              <div className="plan-price">৳0</div>
              <ul>
                <li>{limit(cfg.max_comments, 'comments')}</li>
                <li>{limit(cfg.max_highlights, 'highlights')}</li>
                <li>{limit(cfg.max_bookmarks, 'bookmarks')}</li>
                <li>{cfg.max_upload_mb === null ? 'No limit on comment image size' : `Comment images up to ${cfg.max_upload_mb} MB`}</li>
                {cfg.lock_custom_category && <li>No custom categories</li>}
                {cfg.lock_search && <li>No search</li>}
                {(cfg.locked_menus.length > 0 || cfg.locked_models.length > 0) && <li>Some menus / VFD models are locked</li>}
              </ul>
              {!isPro && <div className="small-text muted">Your use: {status.usage.comments} comments · {status.usage.highlights} highlights · {status.usage.bookmarks} bookmarks</div>}
              <div className="plan-foot"><span className="badge dashed">{isPro ? 'Included' : 'Your plan'}</span></div>
            </div>
            <div className="plan pro">
              <h3>Monthly</h3>
              <div className="plan-price">{chosen && chosen.monthly_original > monthly && <s className="faint">৳{chosen.monthly_original}</s>} ৳{monthly}<span> / month</span></div>
              <ul>{PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
              <div className="plan-foot"><button className="primary" disabled={!!status.pending || !chosen || (!!migrateTo && migrateTo !== 'monthly')} onClick={() => choose('monthly')}>Choose Monthly</button></div>
            </div>
            <div className="plan pro best">
              <h3>Yearly {saving > 0 && <span className="badge solid">Save {saving}%</span>}</h3>
              <div className="plan-price">{chosen && chosen.yearly_original > yearly && <s className="faint">৳{chosen.yearly_original}</s>} ৳{yearly}<span> / year</span></div>
              <ul>{PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
              <div className="plan-foot"><button className="primary" disabled={!!status.pending || !chosen || (!!migrateTo && migrateTo !== 'yearly')} onClick={() => choose('yearly')}>Choose Yearly</button></div>
            </div>
          </div>
          <PaymentSummary cfg={cfg} compact />
        </div>
      )}

      {stage === 'profile' && (
        <form className="stack" onSubmit={saveProfile}>
          <p>To become a paid customer we need your <b>full name</b>, <b>e-mail</b> and <b>phone number</b>, so we can reach you about your subscription. Please complete your profile first.</p>
          <div className="field"><label htmlFor="pf-email">E-mail</label><input id="pf-email" value={user?.email ?? ''} readOnly style={{ width: '100%' }} /></div>
          <div className="field"><label htmlFor="pf-name">Full name</label><input id="pf-name" value={name} maxLength={100} minLength={2} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} autoFocus={!name.trim()} required /></div>
          <div className="field"><label htmlFor="pf-phone">Phone number</label><input id="pf-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} placeholder="+880 1XXX-XXXXXX" style={{ width: '100%' }} required autoFocus={!!name.trim()} /></div>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" onClick={() => { setError(null); setStage('plans'); }}>← Back</button>
            <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
          </div>
        </form>
      )}

      {stage === 'pay' && (
        <form className="stack" onSubmit={submit}>
          <table className="pay-info"><tbody>
            <tr><th>Pricing plan ID</th><td>{chosen?.id}</td></tr>
            <tr><th>Pricing plan name</th><td>{chosen?.name}</td></tr>
            <tr><th>Pricing type</th><td>{PLAN_LABEL[plan]} ({plan === 'monthly' ? 'one month' : 'one year'})</td></tr>
            <tr><th>Payment amount</th><td><b>৳{amount}</b> {chosen && (plan === 'monthly' ? chosen.monthly_original : chosen.yearly_original) > amount && <s className="faint">৳{plan === 'monthly' ? chosen.monthly_original : chosen.yearly_original}</s>}</td></tr>
            <tr><th>Starts</th><td>{startsAt ? <b>{fmtDate(startsAt)} (your next billing cycle)</b> : 'At the next full hour after the administrator approves the payment'}</td></tr>
          </tbody></table>
          <p className="small-text muted" style={{ margin: 0 }}>By submitting you accept our <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy &amp; Service Terms</a>.</p>
          <div className="err" role="note">Please transfer <b>at least ৳{amount}</b>. If the amount you pay is lower than the payable amount, the payment may be rejected.</div>
          <PaymentSummary cfg={cfg} />
          <div className="field">
            <label htmlFor="rc-file">Payment receipt <span className="faint">(required — screenshot or photo, JPEG / PNG / WebP)</span></label>
            <div className="dropzone" tabIndex={0} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }} onPaste={(e) => pickFile(e.clipboardData.files[0])}>
              <button type="button" className="small" onClick={() => input.current?.click()}>{file ? 'Change image' : 'Choose image'}</button>
              <span className="small-text faint">{file ? file.name : 'or drag & drop / paste here'}</span>
              <input id="rc-file" ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Payment receipt" />
            </div>
            {preview && <div className="thumbs"><div className="thumb"><img src={preview} alt="Receipt preview" /></div></div>}
          </div>
          <div className="field"><label htmlFor="rc-note">Note <span className="faint">(optional, e.g. transaction ID)</span></label><input id="rc-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} /></div>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" onClick={() => { setError(null); setStage('plans'); }}>← Back</button>
            <button className="primary" disabled={busy}>{busy ? 'Sending…' : `Submit ${PLAN_LABEL[plan]} request`}</button>
          </div>
        </form>
      )}

      {stage === 'done' && (
        <div className="stack">
          <p role="status">
            <b>Thank you for selecting the {PLAN_LABEL[plan]} subscription.</b> Your payment is now <b>pending verification</b>. The administrator will check it. If everything is okay, your account will be active with all premium features within 3 days at maximum. You can follow the status in Settings → Submit Payment.
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={onClose}>Close</button></div>
        </div>
      )}
      {stage === 'plans' && <ErrorBox e={error ? { message: error } : null} />}
      {stage === 'plans' && <MyRequests />}
    </Modal>
  );
}

/** bKash number, bank accounts and the instructions the administrator configured. */
export function PaymentSummary({ cfg, compact }: { cfg: PremiumConfig; compact?: boolean }) {
  const p = cfg.payment;
  const hasBank = p.banks.length > 0;
  if (!p.bkash_number && !hasBank && !p.receipt_email && compact) return null;
  return (
    <div className="card alt pay-box">
      <b>How to pay</b>
      {p.instructions && <p className="small-text" style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{p.instructions}</p>}
      <div className="pay-grid">
        {p.bkash_number && (
          <div><div className="small-text muted">bKash</div><div className="mono pay-num">{p.bkash_number}</div>{p.bkash_type && <div className="small-text faint">{p.bkash_type}</div>}</div>
        )}
        {p.banks.map((b, i) => (
          <div key={i}>
            <div className="small-text muted">{b.bank || 'Bank'}</div>
            {b.account_number && <div className="mono pay-num">{b.account_number}</div>}
            <div className="small-text faint">{[b.account_name, b.branch].filter(Boolean).join(' · ')}</div>
          </div>
        ))}
        {p.receipt_email && <div><div className="small-text muted">Send the receipt to</div><div className="mono">{p.receipt_email}</div></div>}
      </div>
      {!p.bkash_number && !hasBank && <p className="small-text faint" style={{ margin: 0 }}>Payment details have not been added yet. Please contact the administrator.</p>}
    </div>
  );
}

/** The user's submitted payments with their state. */
export function MyRequests({ open }: { open?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { get('/premium/mine').then((r) => setRows(r.rows)).catch(() => setRows([])); }, []);
  if (!rows || !rows.length) return null;
  return (
    <details open={open}>
      <summary className="small-text">My payment submissions ({rows.length})</summary>
      <div className="table-wrap"><table><thead><tr><th>Submitted</th><th>Plan</th><th>Type</th><th>Amount</th><th>Status</th><th>Period</th><th>Note</th></tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.plan_name ?? '—'}{r.pricing_plan_id ? <span className="faint"> #{r.pricing_plan_id}</span> : null}</td><td>{PLAN_LABEL[r.plan as 'monthly' | 'yearly']}</td><td>৳{r.amount}</td>
            <td><span className={`badge ${r.state === 'active' ? 'solid' : r.state === 'pending' ? 'strong' : 'dashed'}`}>{STATE_TEXT[r.state] ?? r.state}</span></td>
            <td className="small-text">{r.starts_at ? `${fmtDate(r.starts_at)} → ${fmtDate(r.ends_at)}` : '—'}</td><td className="small-text">{r.admin_note ?? ''}</td></tr>))}
      </tbody></table></div>
    </details>
  );
}
export const STATE_TEXT: Record<string, string> = { pending: 'Pending verification', active: 'Active', scheduled: 'Scheduled', expired: 'Expired', rejected: 'Rejected', cancelled: 'Cancelled' };
