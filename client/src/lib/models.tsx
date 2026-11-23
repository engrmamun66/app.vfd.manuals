import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { get } from './api';
import { useAuth } from './auth';
import { useAsync } from '../components/ui';

/** Default tab label: model name without the trailing parenthetical, e.g. "FRENIC-Mini (FRN0001 …)" → "FRENIC-Mini". */
export const shortName = (name: string) => name.replace(/\s*\(.*$/, '').trim() || name;
const APP_TITLE = 'VFD Knowledge Base';
export interface ModelRow { id: number; name: string; brand: string; [k: string]: any }
interface Ctx {
  /** Models switched On (shown as tabs). */
  models: ModelRow[];
  /** Every model, including ones the user switched Off (for the settings table). */
  allModels: ModelRow[];
  isOn(id: number): boolean;
  /** Selected model id (persisted per user in the DB); null = all models. */
  selected: number | null;
  select(id: number | null): Promise<void>;
  /** Short tab label: the user's alias, else the model name. */
  label(m: ModelRow): string;
}
const ModelsCtx = createContext<Ctx>({ models: [], allModels: [], isOn: () => true, selected: null, select: async () => {}, label: (m) => m.name });
export const useModels = () => useContext(ModelsCtx);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useAuth();
  const { data } = useAsync<ModelRow[]>(() => get('/models'), []);
  const order = (settings?.model_order ?? []) as number[];
  // personal order first (as saved), models not yet ordered keep the default order after them
  const allModels = [...(data ?? [])].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  const off = ((settings?.hidden_models ?? []) as number[]);
  const models = allModels.filter((m) => !off.includes(m.id));
  const aliases = (settings?.model_aliases ?? {}) as Record<string, string>;
  const stored = (settings?.selected_model ?? null) as number | null;
  const value = useMemo<Ctx>(
    () => ({
      models,
      allModels,
      isOn: (id) => !off.includes(id),
      // a stored id that no longer exists / is hidden falls back to "all"
      selected: data && stored !== null && !models.some((m) => m.id === stored) ? null : stored,
      select: (id) => updateSettings({ selected_model: id }),
      label: (m) => aliases[String(m.id)] || shortName(m.name),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, stored, settings?.model_aliases, settings?.hidden_models, settings?.model_order],
  );
  // browser page title follows the selected model, same text as the tab tooltip: "Brand Model · VFD Knowledge Base"
  const selModel = value.selected !== null ? models.find((m) => m.id === value.selected) : undefined;
  useEffect(() => {
    document.title = selModel ? `${selModel.brand} ${selModel.name} · ${APP_TITLE}` : APP_TITLE;
    return () => { document.title = APP_TITLE; };
  }, [selModel?.id, selModel?.brand, selModel?.name]);
  return <ModelsCtx.Provider value={value}>{children}</ModelsCtx.Provider>;
}
