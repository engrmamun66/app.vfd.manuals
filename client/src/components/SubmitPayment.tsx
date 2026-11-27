import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, post } from '../lib/api';
import { usePremium } from '../lib/premium';
import { ErrorBox, Modal } from './ui';
import { MyRequests } from './PlansModal';
import { confirmDialog } from './dialogs';
import { toast } from './toast';

const LABEL = { monthly: 'Monthly', yearly: 'Yearly' } as const;

/** Settings → Submit Payment: the user's subscription, payment submission, billing-type change (next cycle) and cancellation. */
export function SubmitPayment() {
  const { status, reload, openPlans } = usePremium();
  const [migrate, setMigrate] = useState<null | 'monthly' | 'yearly'>(null);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  if (!status) return <p className="muted">Loading…</p>;
  const sub = status.subscription;
  const next = sub ? (sub.billing === 'monthly' ? 'yearly' : 'monthly') : null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); setVersion((v) => v + 1); toast(done); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!(await confirmDialog('Cancel your subscription now? The cancellation takes effect immediately: your account becomes a Free account (limited use) at once and the rest of the paid period is not kept. If you subscribe again later, it is a completely new subscription.', { confirmLabel: 'Cancel subscription', danger: true }))) return;
    await run(() => post('/premium/cancel', {}), 'Subscription cancelled');
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Your plan</h3>
        {sub ? (
          <table className="pay-info"><tbody>
            <tr><th>Pricing plan</th><td>{sub.plan_name ?? '—'} <span className="faint">(ID {sub.pricing_plan_id ?? '—'})</span>{status.needsPlanMigration && <span className="badge dashed" style={{ marginLeft: 8 }}>Plan discontinued</span>}</td></tr>
            <tr><th>Pricing type</th><td>{LABEL[sub.billing]}</td></tr>
            <tr><th>Paid amount</th><td>৳{sub.amount}</td></tr>
            <tr><th>Subscribed</th><td>{fmtDate(sub.subscribed_at)}</td></tr>
            <tr><th>Started</th><td>{fmtDate(sub.starts_at)}</td></tr>
            <tr><th>Expires</th><td><b>{fmtDate(sub.ends_at)}</b> — after that you become a Free user (limited use) unless you pay for the next period</td></tr>
            {status.queued && <tr><th>Next period</th><td>{LABEL[status.queued.billing]} · paid · {fmtDate(status.queued.starts_at)} → {fmtDate(status.queued.ends_at)}</td></tr>}
            {sub.migrate_to && <tr><th>Scheduled change</th><td><span className="hl-note">Switches to {LABEL[sub.migrate_to]} from {fmtDate(sub.ends_at)}</span> (your next billing cycle)</td></tr>}
          </tbody></table>
        ) : status.plan === 'trial' ? (
          <p style={{ margin: 0 }}>You have <b>free full access</b> until <b>{fmtDate(status.trialEndsAt)}</b>. After that, a subscription is needed for the Pro features.</p>
        ) : status.plan === 'admin' ? (
          <p style={{ margin: 0 }}>Administrator accounts have every feature.</p>
        ) : (
          <p style={{ margin: 0 }}>You are on the <b>Free</b> plan (limited use).</p>
        )}
        {status.needsPlanMigration && <div className="err" role="status">The pricing plan you subscribed to was discontinued. Your paid period stays valid, but your next payment has to be for one of the current plans.</div>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {status.pending
            ? <span className="badge strong">Payment pending verification</span>
            : <button className="primary" onClick={() => openPlans()}>{sub ? 'Pay for the next billing cycle' : 'Submit payment'}</button>}
          {sub && next && !sub.migrate_to && !status.queued && <button disabled={busy} onClick={() => setMigrate(next)}>Switch to {LABEL[next]}</button>}
          {sub?.migrate_to && <button disabled={busy} onClick={() => run(() => post('/premium/migrate', { to: null }), 'Scheduled change withdrawn')}>Withdraw scheduled change</button>}
          {sub && <button disabled={busy} onClick={cancel}>Cancel subscription</button>}
        </div>
        <ErrorBox e={err} />
      </div>

      <div className="err" role="note">
        <b>Payment is checked by hand.</b> Transfer at least the payable amount shown for the plan you choose. If the amount you transfer is lower than the payable amount, the administrator can <b>reject</b> the payment.
        A submitted payment is <b>pending verification</b> until the administrator confirms it; you can follow its status below.
      </div>

      <MyRequests key={version} open />

      <p className="small-text muted">See our <Link to="/privacy" onClick={() => window.dispatchEvent(new Event('close-settings'))}>Privacy Policy and service terms</Link>.</p>

      {migrate && sub && (
        <Modal title={`Switch to ${LABEL[migrate]}`} onClose={() => setMigrate(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>You are on the <b>{LABEL[sub.billing]}</b> subscription. Switching to <b>{LABEL[migrate]}</b> takes effect <b>only from your next billing cycle</b>:</p>
            <div className="ok-box" style={{ fontSize: '1.05rem' }}>Effective from <b>{fmtDate(sub.ends_at)}</b></div>
            <p className="small-text muted" style={{ margin: 0 }}>Until then your current subscription stays exactly as it is. For the next cycle you will pay for the {LABEL[migrate]} subscription.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setMigrate(null)}>Keep {LABEL[sub.billing]}</button>
              <button className="primary" disabled={busy} onClick={async () => { await run(() => post('/premium/migrate', { to: migrate }), `Switch to ${LABEL[migrate]} scheduled`); setMigrate(null); }}>Confirm — switch from {fmtDate(sub.ends_at)}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
