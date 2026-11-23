import { useModels } from '../lib/models';

/** Horizontal model tabs shown under a page title. The selection is global, persisted per user, and filters every query. */
export function ModelTabs() {
  const { models, selected, select, label } = useModels();
  if (!models.length) return null;
  return (
    <div className="model-tabs" role="tablist" aria-label="Model filter">
      <button role="tab" aria-selected={selected === null} className={selected === null ? 'active' : ''} onClick={() => select(null)} title="Show all models">All</button>
      {models.map((m) => (
        <button key={m.id} role="tab" aria-selected={selected === m.id} className={selected === m.id ? 'active' : ''} onClick={() => select(m.id)} title={`${m.brand} ${m.name}`}>
          {label(m)}
        </button>
      ))}
    </div>
  );
}
