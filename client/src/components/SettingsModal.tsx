import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { shortName, useModels } from '../lib/models';
import { AdminSettings, MySettings } from '../pages/Admin';
import { ChangePassword } from '../pages/AuthPages';

function ModelAliases() {
  const { settings, updateSettings } = useAuth();
  const { allModels: models, isOn } = useModels(); // already in the user's personal order
  const aliases = (settings?.model_aliases ?? {}) as Record<string, string>;
  const off = (settings?.hidden_models ?? []) as number[];
  const [err, setErr] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const run = async (p: Record<string, unknown>) => { try { setErr(null); await updateSettings(p); } catch (e: any) { setErr(e.message); } };
  const save = (id: number, value: string) => {
    const v = value.trim();
    if (v === (aliases[String(id)] ?? '')) return;
    const next = { ...aliases };
    if (v) next[String(id)] = v; else delete next[String(id)];
    return run({ model_aliases: next });
  };
  const toggle = (id: number, on: boolean) => run({ hidden_models: on ? off.filter((x) => x !== id) : [...off, id] });

  // FLIP animation: rows slide from their old position to the new one when the order changes
  const body = useRef<HTMLTableSectionElement>(null);
  const tops = useRef(new Map<string, number>());
  const snapshot = () => body.current?.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => tops.current.set(tr.dataset.id!, tr.getBoundingClientRect().top));
  const orderKey = models.map((m) => m.id).join(',');
  useLayoutEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (tops.current.size) {
      body.current?.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
        const old = tops.current.get(tr.dataset.id!);
        const now = tr.getBoundingClientRect().top;
        if (!reduce && old !== undefined && Math.abs(old - now) > 1) {
          tr.style.transition = 'none';
          tr.style.transform = `translateY(${old - now}px)`;
          tr.getBoundingClientRect(); // force reflow
          tr.style.transition = 'transform .3s ease';
          tr.style.transform = '';
        }
      });
      tops.current.clear();
    }
  }, [orderKey]);

  const reorder = (id: number, toIndex: number) => {
    const ids = models.map((m) => m.id);
    const from = ids.indexOf(id);
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return;
    ids.splice(from, 1);
    ids.splice(toIndex, 0, id);
    snapshot();
    return run({ model_order: ids });
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <h2>Model aliases</h2>
      <p className="muted small-text">
        Your personal model list: <b>drag a row</b> (or use ▲ ▼) to choose which model comes first — the tabs follow this order. Alias: a short name (1–16 characters); empty shows the short model name.
        Switch a model Off to hide its tab. Everything here is personal and only affects your view.
      </p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th style={{ width: 90 }}>Order</th><th>Brand</th><th>Model</th><th>Alias</th><th>Status</th><th>Switch</th></tr></thead>
        <tbody ref={body}>
          {models.map((m, i) => (
            <tr key={m.id} data-id={m.id} draggable
              onDragStart={(e) => { setDragId(m.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => { e.preventDefault(); if (dragId !== null) reorder(dragId, i); setDragId(null); }}
              onDragEnd={() => setDragId(null)}
              style={{ opacity: dragId === m.id ? 0.45 : 1 }}>
              <td style={{ whiteSpace: 'nowrap' }}>
                <span aria-hidden="true" style={{ cursor: 'grab', marginRight: 6 }} title="Drag to reorder">⋮⋮</span>
                <button className="ghost small" aria-label={`Move ${m.brand} ${m.name} up`} disabled={i === 0} onClick={() => reorder(m.id, i - 1)}>▲</button>
                <button className="ghost small" aria-label={`Move ${m.brand} ${m.name} down`} disabled={i === models.length - 1} onClick={() => reorder(m.id, i + 1)}>▼</button>
              </td>
              <td>{m.brand}</td><td>{m.name}</td>
              <td><input aria-label={`Alias for ${m.brand} ${m.name}`} maxLength={16} placeholder={shortName(m.name)} defaultValue={aliases[String(m.id)] ?? ''} onBlur={(e) => save(m.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} onDragStart={(e) => e.stopPropagation()} style={{ width: 160 }} /></td>
              <td><span className={`badge ${isOn(m.id) ? 'strong' : 'dashed'}`}>{isOn(m.id) ? 'On' : 'Off'}</span></td>
              <td><button role="switch" aria-checked={isOn(m.id)} aria-label={`Show ${m.brand} ${m.name} tab`} className={`switch ${isOn(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id, !isOn(m.id))}><span /></button></td>
            </tr>))}
          {!models.length && <tr><td colSpan={6} className="empty">No models yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function UiSettings() {
  const { settings, updateSettings } = useAuth();
  const u = (settings?.ui_settings ?? {}) as { show_verification_filter?: boolean; show_evidence_filter?: boolean };
  const [err, setErr] = useState<string | null>(null);
  const set = async (k: 'show_verification_filter' | 'show_evidence_filter', v: boolean) => {
    try { setErr(null); await updateSettings({ ui_settings: { show_verification_filter: u.show_verification_filter === true, show_evidence_filter: u.show_evidence_filter === true, [k]: v } }); } catch (e: any) { setErr(e.message); }
  };
  const rows: [keyof typeof u, string, string][] = [
    ['show_verification_filter', 'Show verification dropdown', 'Adds the "Any verification" filter to the Parameters and Modbus Register lists.'],
    ['show_evidence_filter', 'Show evidence dropdown', 'Adds the "Any evidence" filter to the Parameters list.'],
  ];
  return (
    <div style={{ maxWidth: 720 }}>
      <h2>UI settings</h2>
      <p className="muted small-text">Optional interface elements. Personal: they only change your own view.</p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Setting</th><th>Status</th><th>Switch</th></tr></thead>
        <tbody>
          {rows.map(([k, label, hint]) => {
            const on = u[k] === true;
            return (
              <tr key={k}>
                <td><b>{label}</b><div className="small-text muted">{hint}</div></td>
                <td><span className={`badge ${on ? 'strong' : 'dashed'}`}>{on ? 'On' : 'Off'}</span></td>
                <td><button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => set(k as any, !on)}><span /></button></td>
              </tr>);
          })}
        </tbody>
      </table></div>
    </div>
  );
}

/** Full-screen settings: profile, preferences, model aliases, security and (Super Admin) application settings. */
export function SettingsModal({ onClose: onClosed }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const onClose = () => { if (!closing) { setClosing(true); window.setTimeout(onClosed, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 220); } };
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin';
  const tabs = [['models', 'Model aliases'], ['ui', 'UI settings'], ['profile', 'Profile & Preferences'], ['security', 'Change password'], ...(isAdmin ? [['app', 'Application & Backups']] : [])] as [string, string][];
  const [tab, setTab] = useState('models');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className={`fs-modal ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="fs-head"><h2>Settings</h2><button onClick={onClose} aria-label="Close settings">✕ Close</button></div>
      <div className="fs-body">
        <div className="fs-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="fs-content" style={{ padding: '16px 28px' }}>
          {tab === 'profile' && <MySettings embedded />}
          {tab === 'models' && <ModelAliases />}
          {tab === 'ui' && <UiSettings />}
          {tab === 'security' && <ChangePassword embedded />}
          {tab === 'app' && isAdmin && <AdminSettings embedded />}
        </div>
      </div>
    </div>
  );
}
