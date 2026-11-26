import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox, PasswordInput } from '../components/ui';
import { VfdAnimation } from '../components/VfdAnimation';

function Wrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-art" aria-label="Product overview">
        <div className="auth-art-brand"><img src="/favicon.svg" alt="" width="38" height="38" /><div><b>VFD Knowledge Base</b><span>Technical Research Explorer</span></div></div>
        <VfdAnimation />
        <p className="auth-art-tag">Parameters, Modbus registers and manual pages for every drive, verified against the original documentation.</p>
      </aside>
      <main className="auth-pane">
        <div className="auth-card">
          <div style={{ marginBottom: 16 }}>
            <b style={{ fontSize: '1.05rem' }}>VFD Knowledge Base</b>
            <div className="muted small-text">Technical Research Explorer</div>
          </div>
          <h1>{title}</h1>
          {children}
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
    <Wrap title="Sign in">
      {notice && <div className="ok-box" role="status">{notice} <button className="small ghost" onClick={clearNotice}>Dismiss</button></div>}
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Password</label><PasswordInput id="pw" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <ErrorBox e={err} />
        <button className="primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="muted small-text" style={{ marginTop: 14 }}>
        {regOn ? <>No account? <Link to="/register">Create one</Link></> : 'New registrations are currently disabled.'}
      </p>
    </Wrap>
  );
}

export function Register() {
  const { register } = useAuth();
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
      await register(f);
      nav('/', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? new Error(`${e.message}`) : e);
    } finally {
      setBusy(false);
    }
  };
  if (!regOn)
    return (
      <Wrap title="Registration closed">
        <p>New registrations are currently disabled by the administrator.</p>
        <Link to="/login">Back to sign in</Link>
      </Wrap>
    );
  return (
    <Wrap title="Create account">
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
        <div className="field"><label htmlFor="r-co">Current company (optional)</label><input id="r-co" autoComplete="organization" value={f.company} onChange={set('company')} /></div>
        <div className="field"><label htmlFor="r-de">Designation (optional)</label><input id="r-de" autoComplete="organization-title" value={f.designation} onChange={set('designation')} /></div>
        <ErrorBox e={err} />
        <button className="primary" disabled={busy || mismatch} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="muted small-text" style={{ marginTop: 14 }}>Already registered? <Link to="/login">Sign in</Link></p>
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
