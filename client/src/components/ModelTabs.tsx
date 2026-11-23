import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useModels } from '../lib/models';

interface TipState { text: string; x: number; y: number }

/** Horizontal model tabs shown under a page title. The selection is global, persisted per user, and filters every query. */
export function ModelTabs() {
  const { models, selected, select, label } = useModels();
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
        <button role="tab" aria-selected={selected === null} className={selected === null ? 'active' : ''} onClick={() => { hide(); select(null); }} {...props('Show all models')}>All</button>
        {models.map((m) => (
          <button key={m.id} role="tab" aria-selected={selected === m.id} className={selected === m.id ? 'active' : ''} onClick={() => { hide(); select(m.id); }} {...props(`${m.brand} ${m.name}`)}>
            {label(m)}
          </button>
        ))}
      </div>
      {tip && createPortal(<div className="tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>, document.body)}
    </>
  );
}
