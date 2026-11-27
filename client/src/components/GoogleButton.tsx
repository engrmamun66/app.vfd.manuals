import { useEffect, useRef, useState } from 'react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';

declare global { interface Window { google?: any } }

let gsi: Promise<void> | null = null;
/** Google Identity Services script, loaded once. */
const loadGsi = () => (gsi ??= new Promise<void>((ok, bad) => {
  if (window.google?.accounts?.id) return ok();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = () => ok();
  s.onerror = () => { gsi = null; bad(new Error('Google sign-in could not be loaded')); };
  document.head.appendChild(s);
}));

/** "Continue with Google" — only shown when the Super Admin has turned Google sign-in on. */
export function GoogleButton({ onDone, onError, first }: { onDone: () => void; onError: (e: unknown) => void; first?: boolean }) {
  const { loginWithGoogle } = useAuth();
  const [cfg, setCfg] = useState<{ enabled: boolean; clientId: string | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { get('/auth/google-config').then(setCfg).catch(() => setCfg({ enabled: false, clientId: null })); }, []);
  useEffect(() => {
    if (!cfg?.enabled || !cfg.clientId) return;
    let dead = false;
    loadGsi().then(() => {
      if (dead || !box.current) return;
      window.google.accounts.id.initialize({
        client_id: cfg.clientId,
        callback: async (r: { credential: string }) => { try { await loginWithGoogle(r.credential); onDone(); } catch (e) { onError(e); } },
      });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: Math.min(340, box.current.clientWidth || 340) });
    }).catch(onError);
    return () => { dead = true; };
  }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg?.enabled) return null;
  const or = <div className="row" style={{ alignItems: 'center', gap: 10, margin: first ? '12px 0 4px' : '0 0 12px' }}><hr style={{ flex: 1, margin: 0 }} /><span className="small-text muted">or {first ? 'fill in the form' : ''}</span><hr style={{ flex: 1, margin: 0 }} /></div>;
  return (
    <div style={{ margin: first ? '0 0 6px' : '14px 0 4px' }}>
      {!first && or}
      <div ref={box} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      {first && or}
    </div>
  );
}
