import { Link, useNavigate } from 'react-router-dom';

/** Privacy policy and service terms. Public page (also readable before registering). */
export function PrivacyPolicy() {
  const nav = useNavigate();
  const back = () => (window.history.length > 1 ? nav(-1) : nav('/'));
  return (
    <div className="page" style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 60px' }}>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Privacy Policy &amp; Service Terms</h1>
        <button onClick={back}>← Back</button>
      </div>
      <p className="muted small-text">VFD Knowledge Base · applies to every registered user</p>

      <div className="prose stack" style={{ marginTop: 14 }}>
        <section>
          <h2>1. What we collect</h2>
          <ul>
            <li><b>Account details:</b> e-mail address, full name, phone number, and optionally company and designation. Your password is never stored; only a salted one-way hash of it is.</li>
            <li><b>Your work in the app:</b> comments, highlights, bookmarks, folders, personal categories, settings, and images or files you attach to a comment.</li>
            <li><b>Payment information:</b> the plan and billing type you chose, the amount, the payment receipt image you upload, any note you write, and the payer name and phone shown on your account.</li>
            <li><b>Technical records:</b> sign-in history (time, IP address, browser/device), active sessions, and an activity log of important actions such as sign-in, payment submission and subscription changes.</li>
          </ul>
        </section>

        <section>
          <h2>2. How we use it</h2>
          <ul>
            <li>To run your account and keep your notes, highlights and settings.</li>
            <li>To check manual payments, activate or reject a subscription, and keep payment records for auditing and reporting.</li>
            <li>To contact you about your subscription or a request you sent.</li>
            <li>To keep the service secure (for example limiting repeated failed sign-ins) and to investigate problems.</li>
          </ul>
          <p>We do not sell your personal information and we do not show advertising.</p>
        </section>

        <section>
          <h2>3. Who can see your information</h2>
          <ul>
            <li><b>Private notes</b> are visible only to you. A note you mark <b>public</b> can be seen by other signed-in users.</li>
            <li><b>Your payment receipt</b> can be opened only by you and the administrator.</li>
            <li>The administrator (Super Admin) can see your account details, subscription and payment records, and activity records. For support and troubleshooting the administrator can also open your account with the “Login as” feature; every such use is recorded in the activity log.</li>
            <li>The manual content in this application comes from the manufacturers’ own documentation and remains the property of the respective manufacturers.</li>
          </ul>
        </section>

        <section>
          <h2>4. Subscriptions and payments</h2>
          <ul>
            <li>Pricing plans have a <b>Monthly</b> and a <b>Yearly</b> option, each with an original and a discounted price; you pay the discounted price shown when you submit the payment.</li>
            <li>Payments are made manually (for example bKash or bank transfer) and are <b>checked by hand</b>. A submitted payment is <b>Pending verification</b> until the administrator confirms it.</li>
            <li>If the amount you transfer is <b>lower than the payable amount</b>, the administrator may <b>reject</b> the payment. You can follow the status of every submission in Settings → Submit Payment.</li>
            <li>When a payment is approved your subscription starts at the <b>next full hour</b> (for example, approval at 10:35 starts at 11:00). A <b>Monthly</b> subscription lasts one month and a <b>Yearly</b> subscription one year. When it ends your account becomes a Free account (limited use).</li>
            <li>You can switch between Monthly and Yearly. The change applies <b>only from your next billing cycle</b>; until then your current subscription does not change. The effective date is shown before you confirm.</li>
            <li>You can <b>cancel at any time</b>. Cancellation takes effect <b>immediately</b>: your account becomes a Free account (limited use) at once. The subscription records are kept (soft-deleted) for auditing. A later subscription is a completely new subscription.</li>
            <li>If the pricing plan you are on is discontinued, your paid period stays valid, but your next payment has to be for one of the active plans.</li>
          </ul>
        </section>

        <section>
          <h2>5. Keeping and deleting data</h2>
          <p>We keep your account data while your account exists. Payment and subscription records are kept for accounting and audit purposes and are marked as deleted (not erased) when a subscription is cancelled. To correct information, use Settings → Profile &amp; Preferences. To ask for your account or data to be removed, send us a message from Settings → Send message.</p>
        </section>

        <section>
          <h2>6. Security</h2>
          <p>Sessions use a secure cookie, passwords are stored as salted hashes, and uploaded files are kept in your private storage area. No system is perfectly secure; please use a strong password and sign out on shared devices.</p>
        </section>

        <section>
          <h2>7. Our commitment</h2>
          <p>
            We will certainly uphold our commitment regarding our services; however, should we be unable to provide service due to unforeseen difficulties, illness, or a death, no claims can be made against us. I apologize to all my clients in this regard.
          </p>
        </section>

        <section>
          <h2>8. Changes</h2>
          <p>We may update this page. The version on this page is the one that applies.</p>
        </section>
      </div>
      <div className="row between" style={{ marginTop: 24, flexWrap: 'wrap' }}>
        <button onClick={back}>← Back</button>
        <span className="small-text muted"><Link to="/">Home</Link> · <Link to="/login">Sign in</Link></span>
      </div>
    </div>
  );
}
