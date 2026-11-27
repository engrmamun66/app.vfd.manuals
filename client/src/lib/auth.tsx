import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ApiError, get, patch as patchApi, post, setCsrf, setUnauthorizedHandler } from './api';

export interface User {
  id: number;
  email: string;
  role: 'super_admin' | 'user';
  mustChangePassword: boolean;
  displayName: string | null;
  phone?: string | null;
  company?: string | null;
  designation?: string | null;
}
export interface Settings {
  annotation_display: { showOthersPublic: boolean; showOwn: boolean; showHighlightBackgrounds: boolean };
  highlight_mode: boolean;
  default_highlight_color: string;
  split_view: { enabled: boolean; ratio: number; collapsed: 'left' | 'right' | null };
  language: 'en' | 'bn';
  theme: 'light' | 'dark' | 'system';
  page_transition?: string;
  page_transition_ms?: number;
  [k: string]: any;
}

interface Ctx {
  user: User | null;
  settings: Settings | null;
  loading: boolean;
  notice: string | null;
  socket: Socket | null;
  /** set while a Super Admin is signed in as this user */
  impersonation: { byUserId: number; byEmail: string; byName: string | null } | null;
  stopImpersonation(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(data: Record<string, string>): Promise<{ otpRequired: true; email: string; expiresInMinutes: number; resendAfterSeconds: number } | void>;
  verifyRegistration(email: string, otp: string): Promise<void>;
  loginWithGoogle(credential: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  clearNotice(): void;
  setPasswordChanged(csrf: string): Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

/** Optional UI toggles from Settings → UI settings (all default to off). */
export function useUiSettings() {
  const { settings } = useAuth();
  const u = (settings?.ui_settings ?? {}) as { show_verification_filter?: boolean; show_evidence_filter?: boolean; show_export_csv?: boolean; show_export_json?: boolean; show_searchable_text?: boolean; show_verification_column?: boolean; importance_filter_style?: 'dropdown' | 'stars'; access_filter_style?: 'dropdown' | 'buttons' };
  return { showVerificationCol: u.show_verification_column !== false, showSearchableText: u.show_searchable_text === true, showVerification: u.show_verification_filter === true, showEvidence: u.show_evidence_filter === true, showExportCsv: u.show_export_csv === true, showExportJson: u.show_export_json === true, showStars: u.importance_filter_style === 'stars', accessButtons: u.access_filter_style === 'buttons' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<Ctx['impersonation']>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const hb = useRef<number | null>(null);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const apply = (r: { user: User; csrfToken: string; settings: Settings; impersonation?: Ctx['impersonation'] }) => {
    setImpersonation(r.impersonation ?? null);
    setCsrf(r.csrfToken);
    setUser(r.user);
    setSettings(r.settings);
  };
  const clearAuth = useCallback((msg?: string) => {
    setCsrf('');
    setUser(null);
    setSettings(null);
    if (msg) setNotice(msg);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await get('/auth/me'));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      clearAuth();
    } finally {
      setLoading(false);
    }
  }, [clearAuth]);

  useEffect(() => {
    setUnauthorizedHandler((code) => {
      if (code === 'MUST_CHANGE_PASSWORD') return;
      // only announce an ended session if someone was actually signed in (not for failed logins / first load)
      clearAuth(userRef.current ? 'Your session has ended. Please sign in again.' : undefined);
    });
    refresh();
  }, [refresh, clearAuth]);

  // real-time session: revocation notices + heartbeat for presence
  useEffect(() => {
    if (!user) {
      setSocket(null);
      return;
    }
    const s = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    s.on('session:revoked', (p: { reason?: string }) => {
      s.disconnect();
      clearAuth(p?.reason === 'account_disabled' ? 'Your account has been disabled.' : 'You were signed out by an administrator or your session expired.');
    });
    hb.current = window.setInterval(() => s.emit('heartbeat'), 30_000);
    setSocket(s);
    return () => {
      if (hb.current) clearInterval(hb.current);
      s.disconnect();
    };
  }, [user?.id, clearAuth]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = settings?.theme === 'dark' || (settings?.theme === 'system' && mq?.matches) ? 'dark' : 'light'; };
    apply();
    document.documentElement.dataset.accent = settings?.accent && settings.accent !== 'mono' ? settings.accent : '';
    if (settings?.theme !== 'system' || !mq) return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings?.theme, settings?.accent]);

  const value: Ctx = {
    user,
    settings,
    loading,
    notice,
    socket,
    impersonation,
    async stopImpersonation() {
      await post('/auth/stop-impersonation');
      window.location.assign('/admin/users'); // full reload: new cookie, fresh state
    },
    async login(email, password) {
      apply(await post('/auth/login', { email, password }));
      setNotice(null);
    },
    async register(data) {
      const r = await post('/auth/register', data);
      if (r?.otpRequired) return r; // an e-mail code has to be entered first
      apply(r);
      setNotice(null);
    },
    async verifyRegistration(email, otp) {
      apply(await post('/auth/register/verify', { email, otp }));
      setNotice(null);
    },
    async loginWithGoogle(credential) {
      apply(await post('/auth/google', { credential }));
      setNotice(null);
    },
    async logout() {
      try {
        await post('/auth/logout');
      } finally {
        clearAuth();
      }
    },
    refresh,
    async updateSettings(p) {
      // optimistic: UI reacts immediately, then reconciles with the server (source of truth)
      setSettings((s) => (s ? { ...s, ...p } : s));
      try {
        setSettings(await patchApi('/me/settings', p));
      } catch (e) {
        await refresh();
        throw e;
      }
    },
    clearNotice: () => setNotice(null),
    async setPasswordChanged(csrf) {
      setCsrf(csrf);
      await refresh();
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
