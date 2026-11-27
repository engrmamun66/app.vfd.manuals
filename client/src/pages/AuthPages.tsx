import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox, PasswordInput } from '../components/ui';
import { VfdAnimation } from '../components/VfdAnimation';
import { GoogleButton } from '../components/GoogleButton';

function Wrap({ title, children, top, sub, footer }: { title: string; children: React.ReactNode; top?: React.ReactNode; sub?: string; footer?: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-art" aria-label="Product overview">
        <div className="auth-art-brand"><img src="/favicon.svg" alt="" width="38" height="38" /><div><b>VFD Knowledge Base</b><span>Technical Research Explorer</span></div></div>
        {top ?? (title !== 'Sign in' && <Link to="/login" className="btn auth-art-login">Sign in now</Link>)}
        <VfdAnimation />
        <p className="auth-art-tag">Parameters, Modbus registers and manual pages for every drive, verified against the original documentation.</p>
      </aside>
      <main className="auth-pane">
        <div className="auth-card">
          <header className="auth-head">
            <img src="/favicon.svg" alt="" width="40" height="40" />
            <div><b>VFD Knowledge Base</b><span>Technical Research Explorer</span></div>
          </header>
          <h1 className="auth-title">{title}</h1>
          {sub && <p className="auth-sub">{sub}</p>}
          {children}
          <footer className="auth-foot">
            {footer}
            <div className="auth-legal">By continuing you accept our <Link to="/privacy">Privacy Policy &amp; Service Terms</Link></div>
          </footer>
        </div>
      </main>
    </div>
  );
}

export function Login() {
  const { login, notice, clearNotice } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [regOn, setRegOn] = useState(true);
  useEffect(() => {
    get('/auth/registration-status').then((r) => setRegOn(r.registrationEnabled)).catch(() => {});
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, pw);
      nav('/', { replace: true });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Wrap title="Sign in" sub="Welcome back. Sign in to continue." footer={<p>{regOn ? <>No account? <Link to="/register">Create one</Link></> : 'New registrations are currently disabled.'}</p>} top={regOn ? <Link to="/register" className="btn auth-art-login">Register now</Link> : null}>
      {notice && <div className="ok-box" role="status">{notice} <button className="small ghost" onClick={clearNotice}>Dismiss</button></div>}
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Password</label><PasswordInput id="pw" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <ErrorBox e={err} />
        <button className="primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <GoogleButton onDone={() => nav('/', { replace: true })} onError={setErr} />
    </Wrap>
  );
}

export function Register() {
  const { register, verifyRegistration } = useAuth();
  const [otp, setOtp] = useState<null | { email: string; minutes: number }>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0); // seconds until a new code may be asked for
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', displayName: '', password: '', confirmPassword: '', phone: '', company: '', designation: '' });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [regOn, setRegOn] = useState(true);
  useEffect(() => {
    get('/auth/registration-status').then((r) => setRegOn(r.registrationEnabled)).catch(() => {});
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const mismatch = f.confirmPassword.length > 0 && f.password !== f.confirmPassword;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirmPassword) return setErr(new Error('Password and Confirm Password do not match.'));
    setBusy(true);
    setErr(null);
    try {
      const r = await register(f);
      if (r && r.otpRequired) { setOtp({ email: r.email, minutes: r.expiresInMinutes }); setWait(r.resendAfterSeconds); setCode(''); return; }
      nav('/', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? new Error(`${e.message}`) : e);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return;
    setBusy(true);
    setErr(null);
    try { await verifyRegistration(otp.email, code.trim()); nav('/', { replace: true }); } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  const resend = async () => {
    if (!otp) return;
    setErr(null);
    try { const r = await post('/auth/register/resend', { email: otp.email }); setWait(r.resendAfterSeconds); setCode(''); } catch (e2) { setErr(e2); }
  };
  if (otp)
    return (
      <Wrap title="Check your e-mail">
        <form onSubmit={confirm}>
          <p>We sent a 6-digit code to <b>{otp.email}</b>. Enter it to finish creating your account. It is valid for {otp.minutes} minutes.</p>
          <div className="field"><label htmlFor="r-otp">Verification code</label><input id="r-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: '.4em', fontSize: '1.3rem', textAlign: 'center' }} /></div>
          <ErrorBox e={err} />
          <button className="primary" disabled={busy || code.length !== 6} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Checking…' : 'Verify and create account'}</button>
        </form>
        <div className="row between" style={{ marginTop: 12 }}>
          <button type="button" className="small" onClick={() => { setOtp(null); setErr(null); }}>← Change details</button>
          <button type="button" className="small" disabled={wait > 0} onClick={resend}>{wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'}</button>
        </div>
      </Wrap>
    );
  if (!regOn)
    return (
      <Wrap title="Registration closed">
        <p>New registrations are currently disabled by the administrator.</p>
        <Link to="/login">Back to sign in</Link>
      </Wrap>
    );
  return (
    <Wrap title="Create account" sub="Free to start. Pro features are included for a trial period." footer={<p>Already registered? <Link to="/login">Sign in</Link></p>}>
      <GoogleButton first onDone={() => nav('/', { replace: true })} onError={setErr} />
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="r-name">Full name *</label><input id="r-name" required minLength={2} maxLength={100} autoComplete="name" value={f.displayName} onChange={set('displayName')} /></div>
        <div className="field"><label htmlFor="r-email">Email address *</label><input id="r-email" type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></div>
        <div className="field">
          <label htmlFor="r-pw">Password *</label><PasswordInput id="r-pw" required autoComplete="new-password" value={f.password} onChange={set('password')} />
        </div>
        <div className="field">
          <label htmlFor="r-pw2">Confirm password *</label><PasswordInput id="r-pw2" required autoComplete="new-password" value={f.confirmPassword} onChange={set('confirmPassword')} aria-invalid={mismatch} />
          {mismatch && <div className="small-text" role="alert">Passwords do not match.</div>}
        </div>
        <div className="field"><label htmlFor="r-ph">Phone number (optional)</label><input id="r-ph" type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></div>
        <ErrorBox e={err} />
        <button className="primary" disabled={busy || mismatch} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </Wrap>
  );
}

export function ChangePassword({ forced, embedded }: { forced?: boolean; embedded?: boolean }) {
  const { setPasswordChanged, logout } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [err, setErr] = useState<any>(null);
  const [ok, setOk] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await post('/auth/change-password', f);
      await setPasswordChanged(r.csrfToken);
      setOk(true);
      if (forced) nav('/', { replace: true });
    } catch (e) {
      setErr(e);
    }
  };
  const form = (
    <form onSubmit={submit}>
      {forced && <div className="ok-box">You must change your password before continuing.</div>}
      <div className="field"><label htmlFor="cp1">Current password</label><PasswordInput id="cp1" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></div>
      <div className="field"><label htmlFor="cp2">New password</label><PasswordInput id="cp2" autoComplete="new-password" required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></div>
      <div className="field"><label htmlFor="cp3">Confirm new password</label><PasswordInput id="cp3" autoComplete="new-password" required value={f.confirmPassword} onChange={(e) => setF({ ...f, confirmPassword: e.target.value })} /></div>
      <ErrorBox e={err} />
      {ok && <div className="ok-box" role="status">Password changed. Other sessions were signed out.</div>}
      <div className="row"><button className="primary">Change password</button>{forced && <button type="button" onClick={logout}>Sign out</button>}</div>
    </form>
  );
  return forced ? <Wrap title="Change password">{form}</Wrap> : embedded ? <div style={{ maxWidth: 460 }}>{form}</div> : <div className="page narrow"><h1>Change password</h1>{form}</div>;
}
