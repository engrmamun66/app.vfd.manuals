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
  theme: 'light' | 'dark';
  [k: string]: any;
}

interface Ctx {
  user: User | null;
  settings: Settings | null;
  loading: boolean;
  notice: string | null;
  socket: Socket | null;
  login(email: string, password: string): Promise<void>;
  register(data: Record<string, string>): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  clearNotice(): void;
  setPasswordChanged(csrf: string): Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const hb = useRef<number | null>(null);

  const apply = (r: { user: User; csrfToken: string; settings: Settings }) => {
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
      clearAuth('Your session has ended. Please sign in again.');
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
    document.documentElement.dataset.theme = settings?.theme === 'dark' ? 'dark' : 'light';
  }, [settings?.theme]);

  const value: Ctx = {
    user,
    settings,
    loading,
    notice,
    socket,
    async login(email, password) {
      apply(await post('/auth/login', { email, password }));
      setNotice(null);
    },
    async register(data) {
      apply(await post('/auth/register', data));
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
