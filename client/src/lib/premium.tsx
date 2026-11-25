import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, setPremiumHandler } from './api';
import { PlansModal } from '../components/PlansModal';

export interface BankAccount { bank: string; account_name: string; account_number: string; branch: string }
export interface PremiumConfig {
  locked_menus: string[];
  locked_models: number[];
  lock_search: boolean;
  lock_custom_category: boolean;
  lock_requests: boolean;
  max_upload_mb: number | null;
  max_comments: number | null;
  max_highlights: number | null;
  max_bookmarks: number | null;
  plans: { monthly: { price: number; days: number }; yearly: { price: number; days: number } };
  payment: { bkash_number: string; bkash_type: string; banks: BankAccount[]; receipt_email: string; instructions: string };
}
export interface PremiumStatus {
  isPro: boolean;
  plan: 'monthly' | 'yearly' | 'admin' | null;
  endsAt: string | null;
  pending: { id: number; plan: 'monthly' | 'yearly'; amount: number; created_at: string } | null;
  profileComplete: boolean;
  config: PremiumConfig;
  usage: { comments: number; highlights: number; bookmarks: number };
}

interface Ctx {
  status: PremiumStatus | null;
  isPro: boolean;
  /** Opens the pricing dialog (optionally with the reason that brought the user here). */
  openPlans: (reason?: string) => void;
  reload: () => Promise<void>;
  menuLocked: (path: string) => boolean;
  modelLocked: (id: number) => boolean;
  searchLocked: boolean;
  categoryLocked: boolean;
}

const PremiumCtx = createContext<Ctx>({ status: null, isPro: false, openPlans: () => {}, reload: async () => {}, menuLocked: () => false, modelLocked: () => false, searchLocked: false, categoryLocked: false });
export const usePremium = () => useContext(PremiumCtx);

export function PremiumProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [open, setOpen] = useState<{ reason?: string } | null>(null);
  const reload = useCallback(async () => {
    try { setStatus(await get('/premium/status')); } catch { /* the app keeps working without premium info */ }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const openPlans = useCallback((reason?: string) => { setOpen({ reason }); reload(); }, [reload]);
  // the server answers 402 when a free user crosses a limit: show the plans instead of leaving a bare error
  useEffect(() => { setPremiumHandler((message) => openPlans(message)); return () => setPremiumHandler(null); }, [openPlans]);

  const value = useMemo<Ctx>(() => {
    const pro = status?.isPro ?? true; // until the status is known nothing is treated as locked
    const cfg = status?.config;
    return {
      status,
      isPro: pro,
      openPlans,
      reload,
      menuLocked: (path) => !pro && !!cfg && cfg.locked_menus.some((m) => path === m || (m !== '/' && path.startsWith(m + '/'))),
      modelLocked: (id) => !pro && !!cfg && cfg.locked_models.includes(id),
      searchLocked: !pro && !!cfg?.lock_search,
      categoryLocked: !pro && !!cfg?.lock_custom_category,
    };
  }, [status, openPlans, reload]);
  return (
    <PremiumCtx.Provider value={value}>
      {children}
      {open && <PlansModal reason={open.reason} onClose={() => setOpen(null)} />}
    </PremiumCtx.Provider>
  );
}
