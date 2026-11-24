import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { get } from '../lib/api';
import { useMyCategories } from '../lib/myCategories';
import { confirmDialog } from './dialogs';
import { Modal } from './ui';

/** Small folder/tag icon that marks a category as the user's own. */
export function MineIcon({ size = 13 }: { size?: number }) {
  return (
    <svg className="mine-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7" cy="7" r="1.2" />
    </svg>
  );
}

/** Add / rename / delete the user's own categories. */
export function MyCategoriesModal() {
  const { categories, create, rename, remove, closeManager, managerOpen } = useMyCategories();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  if (!managerOpen) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); return true; } catch (e: any) { setError(e.message || 'Something went wrong'); return false; }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run(() => create(name))) setName('');
  };
  return (
    <Modal title="My categories" onClose={closeManager}>
      <p className="small-text muted" style={{ marginTop: 0 }}>Your own categories are private to you. Names must be different from the system categories.</p>
      <form className="row" onSubmit={add} style={{ marginBottom: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New category name" aria-label="New category name" style={{ flex: 1 }} autoFocus />
        <button className="primary" disabled={!name.trim()}>Add</button>
      </form>
      {error && <div className="err" role="alert">{error}</div>}
      {categories.length === 0 && <div className="empty">No personal categories yet.</div>}
      <ul className="mycat-list">
        {categories.map((c) => (
          <li key={c.id} className="mycat">
            <MineIcon />
            {editing?.id === c.id ? (
              <form className="row" style={{ flex: 1 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => rename(c.id, editing.name))) setEditing(null); }}>
                <input value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} maxLength={60} aria-label="Category name" style={{ flex: 1 }} autoFocus />
                <button className="small primary">Save</button>
                <button type="button" className="small" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span style={{ flex: 1 }}>{c.name} <span className="faint small-text">({c.count})</span></span>
                <button className="small" onClick={() => { setError(null); setEditing({ id: c.id, name: c.name }); }}>Rename</button>
                <button className="small danger" onClick={async () => (await confirmDialog(`Delete category “${c.name}”? Parameters are not deleted, they only lose this category.`, { danger: true, confirmLabel: 'Delete' })) && run(() => remove(c.id))}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Checklist of the user's categories for one parameter (with quick "new category"). */
export function CategoryChecklist({ value, onToggle, onCreated }: { value: number[]; onToggle: (id: number, on: boolean) => void; onCreated: (id: number) => void }) {
  const { categories, create, openManager } = useMyCategories();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try { const c = await create(name); setName(''); onCreated(c.id); } catch (err: any) { setError(err.message || 'Could not create'); }
  };
  return (
    <div className="cat-checklist">
      {categories.length === 0 && <div className="small-text faint" style={{ padding: '4px 2px' }}>No categories yet — create your first one below.</div>}
      {categories.map((c) => (
        <label key={c.id} className={`cat-opt mycat ${value.includes(c.id) ? 'on' : ''}`}>
          <input type="checkbox" checked={value.includes(c.id)} onChange={(e) => onToggle(c.id, e.target.checked)} />
          <MineIcon /> <span>{c.name}</span>
        </label>
      ))}
      <form className="row" onSubmit={add} style={{ marginTop: 6 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="+ New category" aria-label="New category name" style={{ flex: 1, minWidth: 0 }} />
        <button className="small" disabled={!name.trim()}>Add</button>
      </form>
      {error && <div className="err small-text" role="alert">{error}</div>}
      <button type="button" className="small ghost" style={{ marginTop: 6 }} onClick={openManager}>Manage categories…</button>
    </div>
  );
}

/** Action-column control: a button that opens a popover to assign any number of own categories to one parameter. */
export function CategoryPicker({ parameterId, value, onChange }: { parameterId: number; value: number[]; onChange: (ids: number[]) => void }) {
  const { assign, categories } = useMyCategories();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    const scroll = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const save = async (ids: number[]) => {
    setErr(null);
    const before = local;
    setLocal(ids); // optimistic
    try { const saved = await assign(parameterId, ids); setLocal(saved); onChange(saved); } catch (e: any) { setLocal(before); setErr(e.message || 'Could not save'); }
  };
  const names = categories.filter((c) => local.includes(c.id)).map((c) => c.name);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`small cat-btn ${local.length ? 'has' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={names.length ? `My categories: ${names.join(', ')}` : 'Add to my categories'}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setPos(open ? null : { x: Math.max(8, Math.min(r.right - 260, window.innerWidth - 276)), y: r.bottom + 6 });
        }}
      >
        <MineIcon /> {local.length ? local.length : 'Add'}
      </button>
      {pos && createPortal(
        <div ref={pop} className="popover cat-pop" role="dialog" aria-label="My categories" style={{ position: 'fixed', left: pos.x, top: pos.y, width: 260 }} onClick={(e) => e.stopPropagation()}>
          <div className="small-text muted" style={{ marginBottom: 4 }}><b>My categories</b></div>
          <CategoryChecklist value={local} onToggle={(id, on) => save(on ? [...local, id] : local.filter((x) => x !== id))} onCreated={(id) => save([...local, id])} />
          {err && <div className="err small-text" role="alert">{err}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Details-view field: shows and edits the categories of one parameter. */
export function ParameterMyCategories({ parameterId }: { parameterId: number }) {
  const { assign, categories } = useMyCategories();
  const [ids, setIds] = useState<number[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get<{ ids: number[] }>(`/my-categories/for-parameter/${parameterId}`).then((r) => setIds(r.ids)).catch((e) => setErr(e.message)); }, [parameterId]);
  const save = async (next: number[]) => {
    setErr(null);
    const before = ids;
    setIds(next); // optimistic
    try { setIds(await assign(parameterId, next)); } catch (e: any) { setIds(before); setErr(e.message || 'Could not save'); }
  };
  if (ids === null) return <span className="faint small-text">{err ?? 'Loading…'}</span>;
  void categories;
  return (
    <div>
      <CategoryChecklist value={ids} onToggle={(id, on) => save(on ? [...ids, id] : ids.filter((x) => x !== id))} onCreated={(id) => save([...ids, id])} />
      {err && <div className="err small-text" role="alert">{err}</div>}
    </div>
  );
}
