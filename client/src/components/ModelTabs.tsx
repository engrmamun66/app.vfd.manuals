import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useModels } from '../lib/models';

interface TipState { text: string; x: number; y: number }

/** Horizontal model tabs shown under a page title. The selection is global, persisted per user, and filters every query. */
export interface RecordTabs {
  kind: 'parameter' | 'register';
  /** model of the record being viewed */
  modelId: number;
  /** the same common function in other models (from the record API) */
  counterparts: { id: number; model_id: number; code?: string; original_address?: string }[];
}

/**
 * On a record page (`record` given) the tabs also navigate: a tab opens the equivalent record of that model
 * (same common function) when one is documented; tabs without an equivalent are dimmed and lead to the list for that model.
 */
export function ModelTabs({ record }: { record?: RecordTabs } = {}) {
  const { models, selected, select, label } = useModels();
  const nav = useNavigate();
  const counterpart = (modelId: number) => record?.counterparts.find((c) => c.model_id === modelId);
  const choose = async (id: number | null) => {
    hide();
    await select(id);
    if (!record || id === null || id === record.modelId) return;
    const c = counterpart(id);
    nav(c ? `/${record.kind}/${c.id}` : record.kind === 'parameter' ? '/parameters' : '/modbus/registers');
  };
  const [tip, setTip] = useState<TipState | null>(null);
  if (!models.length) return null;
  // standard tooltip: shown on hover AND keyboard focus, rendered in a portal so the scrolling tab bar cannot clip it
  const show = (e: React.SyntheticEvent<HTMLElement>, text: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: r.left + r.width / 2, y: r.bottom + 8 });
  };
  const hide = () => setTip(null);
  const props = (text: string) => ({ 'aria-label': text, 'aria-describedby': undefined, onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e, text), onFocus: (e: React.FocusEvent<HTMLElement>) => show(e, text), onMouseLeave: hide, onBlur: hide });
  return (
    <>
      <div className="model-tabs" role="tablist" aria-label="Model filter" onScroll={hide}>
        <button role="tab" aria-selected={selected === null} className={selected === null ? 'active' : ''} onClick={() => choose(null)} {...props('Show all models')}>All</button>
        {models.map((m) => {
          const isCurrent = record?.modelId === m.id;
          const missing = !!record && !isCurrent && !counterpart(m.id);
          const tip = !record ? `${m.brand} ${m.name}` : isCurrent ? `${m.brand} ${m.name} (this record)` : missing ? `${m.brand} ${m.name} — no equivalent record documented, opens the list` : `${m.brand} ${m.name} — open the equivalent record`;
          return (
            <button key={m.id} role="tab" aria-selected={selected === m.id} className={`${selected === m.id ? 'active' : ''} ${isCurrent ? 'current' : ''} ${missing ? 'dim' : ''}`} onClick={() => choose(m.id)} {...props(tip)}>
              {label(m)}
            </button>
          );
        })}
      </div>
      {tip && createPortal(<div className="tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>, document.body)}
    </>
  );
}
