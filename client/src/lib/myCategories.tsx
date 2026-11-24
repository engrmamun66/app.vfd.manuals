import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { del, get, patch, post, put } from './api';

export interface MyCategory { id: number; name: string; count: number }

interface Ctx {
  categories: MyCategory[];
  loaded: boolean;
  reload: () => Promise<void>;
  create: (name: string) => Promise<MyCategory>;
  rename: (id: number, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  assign: (parameterId: number, categoryIds: number[]) => Promise<number[]>;
  openManager: () => void;
  managerOpen: boolean;
  closeManager: () => void;
}

const MyCategoriesCtx = createContext<Ctx | null>(null);

/** The signed-in user's personal parameter categories (private to the user; the server scopes every query). */
export function MyCategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<MyCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const reload = useCallback(async () => {
    try {
      const r = await get<{ rows: MyCategory[] }>('/my-categories');
      setCategories(r.rows);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { reload().catch(() => setLoaded(true)); }, [reload]);
  const value = useMemo<Ctx>(() => ({
    categories, loaded, reload, managerOpen,
    openManager: () => setManagerOpen(true),
    closeManager: () => setManagerOpen(false),
    create: async (name) => { const c = await post<MyCategory>('/my-categories', { name }); await reload(); return c; },
    rename: async (id, name) => { await patch(`/my-categories/${id}`, { name }); await reload(); },
    remove: async (id) => { await del(`/my-categories/${id}`); await reload(); },
    assign: async (parameterId, categoryIds) => { const r = await put<{ ids: number[] }>(`/my-categories/for-parameter/${parameterId}`, { categoryIds }); await reload(); return r.ids; },
  }), [categories, loaded, reload, managerOpen]);
  return <MyCategoriesCtx.Provider value={value}>{children}</MyCategoriesCtx.Provider>;
}

export function useMyCategories(): Ctx {
  const c = useContext(MyCategoriesCtx);
  if (!c) throw new Error('useMyCategories must be used inside <MyCategoriesProvider>');
  return c;
}
