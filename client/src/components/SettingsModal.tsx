import { FeedbackModal } from './FeedbackModal';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';
import { shortName, useModels } from '../lib/models';
import { AdminSettings, MySettings } from '../pages/Admin';
import { MyCategoriesManager } from './MyCategories';
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
  const allOn = models.length > 0 && models.every((m) => isOn(m.id));
  const noneOn = models.every((m) => !isOn(m.id));
  const toggleAll = () => run({ hidden_models: allOn ? models.map((m) => m.id) : [] }); // all on -> hide every tab, otherwise show every tab

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
      <p className="muted small-text">
        Your personal model list: <b>drag a row</b> (or use ▲ ▼) to choose which model comes first — the tabs follow this order. Alias: a short name (1–16 characters); empty shows the short model name.
        Switch a model Off to hide its tab. Everything here is personal and only affects your view.
      </p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th style={{ width: 90 }}>Order</th><th>Brand</th><th>Model</th><th>Alias</th><th>Status</th><th>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <button role="switch" aria-checked={allOn} aria-label="Show all model tabs" title={allOn ? 'All models On — click to switch every tab Off' : noneOn ? 'All models Off — click to switch every tab On' : 'Some models Off — click to switch every tab On'} className={`switch ${allOn ? 'on' : ''}`} onClick={toggleAll} disabled={!models.length}><span /></button>
          </div></th></tr></thead>
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
  const { settings, updateSettings, user } = useAuth();
  const u = (settings?.ui_settings ?? {}) as { show_verification_filter?: boolean; show_evidence_filter?: boolean; show_export_csv?: boolean; show_export_json?: boolean; show_searchable_text?: boolean; show_verification_column?: boolean; importance_filter_style?: 'dropdown' | 'stars'; access_filter_style?: 'dropdown' | 'buttons'; selection_menu_autohide?: boolean };
  const [err, setErr] = useState<string | null>(null);
  const set = async (k: keyof typeof u, v: boolean | string) => {
    try { setErr(null); await updateSettings({ ui_settings: { ...u, [k]: v } } as any); } catch (e: any) { setErr(e.message); }
  };
  type RowKey = Exclude<keyof typeof u, 'importance_filter_style' | 'access_filter_style' | 'selection_menu_autohide' | 'show_verification_column'>;
  const rows: [RowKey, string, string][] = [
    ['show_verification_filter', 'Show verification dropdown', 'Adds the "Any verification" filter to the Parameters and Modbus Register lists.'],
    ['show_evidence_filter', 'Show evidence dropdown', 'Adds the "Any evidence" filter to the Parameters list.'],
    ['show_export_csv', 'Show Export CSV button', 'Shows the "Export CSV" button on the Parameters, Modbus Register and Compare pages.'],
    ['show_export_json', 'Show Export JSON button', 'Shows the "Export JSON" button on the Parameters, Modbus Register and Compare pages.'],
    ...(user?.role === 'super_admin' ? [['show_searchable_text', 'Show "Searchable text" tab (Superadmin only)', 'Adds the plain page-text tab next to "Page image" in manual page views. For functional analysis; normal users never see it.'] as [RowKey, string, string]] : []),
  ];
  return (
    <div style={{ maxWidth: 720 }}>
      <p className="muted small-text">Optional interface elements. Personal: they only change your own view.</p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Setting</th><th>Status</th><th>Switch</th></tr></thead>
        <tbody>
          <tr>
            <td><b>Importance filter style</b><div className="small-text muted">How the importance filter appears on the Parameters list: a dropdown, or an All / 3 / 2 / 1 star button group (3 = Important, 2 = Medium, 1 = Optional).</div></td>
            <td><span className="badge strong">{u.importance_filter_style === 'stars' ? 'Stars' : 'Dropdown'}</span></td>
            <td><div className="seg" role="radiogroup" aria-label="Importance filter style">
              {([['dropdown', 'Dropdown'], ['stars', 'Stars']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={(u.importance_filter_style ?? 'dropdown') === k} className={(u.importance_filter_style ?? 'dropdown') === k ? 'active' : ''} onClick={() => set('importance_filter_style', k)}>{l}</button>)}
            </div></td>
          </tr>
          <tr>
            <td><b>Access filter style</b><div className="small-text muted">How the Read / Write filter appears on the Parameters and Modbus Register lists: a dropdown, or an All / Read / Write button group.</div></td>
            <td><span className="badge strong">{u.access_filter_style === 'buttons' ? 'Buttons' : 'Dropdown'}</span></td>
            <td><div className="seg" role="radiogroup" aria-label="Access filter style">
              {([['dropdown', 'Dropdown'], ['buttons', 'Buttons']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={(u.access_filter_style ?? 'dropdown') === k} className={(u.access_filter_style ?? 'dropdown') === k ? 'active' : ''} onClick={() => set('access_filter_style', k)}>{l}</button>)}
            </div></td>
          </tr>
          <tr>
            <td><b>Hide text-selection menu on outside click</b><div className="small-text muted">On: the Add Comment / Highlight / Copy menu closes when you click anywhere else. Off: it stays until you pick an action, press Esc or choose Cancel.</div></td>
            <td><span className={`badge ${u.selection_menu_autohide !== false ? 'strong' : 'dashed'}`}>{u.selection_menu_autohide !== false ? 'On' : 'Off'}</span></td>
            <td><button role="switch" aria-checked={u.selection_menu_autohide !== false} aria-label="Hide text-selection menu on outside click" className={`switch ${u.selection_menu_autohide !== false ? 'on' : ''}`} onClick={() => set('selection_menu_autohide', u.selection_menu_autohide === false)}><span /></button></td>
          </tr>
          <tr>
            <td><b>Show Verification column</b><div className="small-text muted">Shows the "Verification" status column in the Parameters, Modbus Register, Knowledge and Communication Settings tables.</div></td>
            <td><span className={`badge ${u.show_verification_column !== false ? 'strong' : 'dashed'}`}>{u.show_verification_column !== false ? 'On' : 'Off'}</span></td>
            <td><button role="switch" aria-checked={u.show_verification_column !== false} aria-label="Show Verification column" className={`switch ${u.show_verification_column !== false ? 'on' : ''}`} onClick={() => set('show_verification_column', u.show_verification_column === false)}><span /></button></td>
          </tr>
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

const ACCENTS: [string, string, string][] = [['mono', 'Black & white', 'linear-gradient(90deg,#0a0a0a 50%,#fff 50%)'], ['blue', 'Blue', '#1d4ed8'], ['green', 'Green', '#15803d'], ['red', 'Red', '#b91c1c'], ['orange', 'Orange', '#c2410c'], ['purple', 'Purple', '#6d28d9'], ['teal', 'Teal', '#0f766e']];

function ThemeSetting() {
  const { settings, updateSettings } = useAuth();
  const accent = settings?.accent ?? 'mono';
  const pickAccent = async (k: string) => { try { setErr(null); await updateSettings({ accent: k } as any); } catch (e: any) { setErr(e.message); } };
  const cur = (settings?.theme ?? 'light') as 'system' | 'light' | 'dark';
  const [err, setErr] = useState<string | null>(null);
  const pick = async (k: 'system' | 'light' | 'dark') => { try { setErr(null); await updateSettings({ theme: k } as any); } catch (e: any) { setErr(e.message); } };
  const opts = [['system', 'System', <MonitorIcon key="s" />], ['light', 'Light', <SunIcon key="l" />], ['dark', 'Dark', <MoonIcon key="d" />]] as const;
  return (
    <div style={{ maxWidth: 720, marginBottom: 28 }}>
      <h2>Theme</h2>
      <p className="muted small-text">Light, dark, or follow your device (System). Applies on desktop and mobile. Personal: it only changes your own view.</p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row" role="radiogroup" aria-label="Theme mode">
        {opts.map(([k, label, icon]) => (
          <button key={k} role="radio" aria-checked={cur === k} className={cur === k ? 'primary' : ''} onClick={() => pick(k)} style={{ gap: 8 }}>{icon}{label}</button>
        ))}
      </div>
      <h3 style={{ marginTop: 18 }}>Accent color</h3>
      <p className="muted small-text">Color of primary buttons, focus rings and highlights. Default is black &amp; white.</p>
      <div className="row" role="radiogroup" aria-label="Accent color">
        {ACCENTS.map(([k, label, c]) => (
          <button key={k} role="radio" aria-checked={accent === k} className={accent === k ? 'primary' : ''} onClick={() => pickAccent(k)} style={{ gap: 8 }}>
            <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: '1px solid var(--line-strong)', display: 'inline-block' }} />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

const TRANSITIONS: [string, string][] = [['none', 'None'], ['fade', 'Fade'], ['slide-up', 'Slide up'], ['slide-left', 'Slide from right'], ['slide-right', 'Slide from left'], ['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out'], ['blur', 'Blur in'], ['flip', 'Tilt']];

function PageTransition() {
  const { settings, updateSettings } = useAuth();
  const cur = settings?.page_transition ?? 'slide-up';
  const [n, setN] = useState(0); // bumps to replay the preview
  const ms = settings?.page_transition_ms ?? 300;
  const [draft, setDraft] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (k: string) => {
    setN((x) => x + 1);
    try { setErr(null); await updateSettings({ page_transition: k } as any); } catch (e: any) { setErr(e.message); }
  };
  const saveMs = async (v: number) => {
    setDraft(null); setN((x) => x + 1);
    try { setErr(null); await updateSettings({ page_transition_ms: v } as any); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div style={{ maxWidth: 720, marginTop: 28 }}>
      <h2>Page transition</h2>
      <p className="muted small-text">Animation played when you navigate to another page. Personal: it only changes your own view.</p>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row" role="radiogroup" aria-label="Page transition">
        {TRANSITIONS.map(([k, l]) => <button key={k} role="radio" aria-checked={cur === k} className={cur === k ? 'primary small' : 'small'} onClick={() => pick(k)}>{l}</button>)}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <label htmlFor="pt-speed" style={{ margin: 0 }}>Speed</label>
        <span className="small-text muted">Fast</span>
        <input id="pt-speed" className="range" type="range" min={100} max={2000} step={100} style={{ width: 260, '--pct': `${(((draft ?? ms) - 100) / 1900) * 100}%` } as React.CSSProperties} value={draft ?? ms} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={() => draft !== null && saveMs(draft)} onKeyUp={() => draft !== null && saveMs(draft)} />
        <span className="small-text muted">Slow</span>
        <span className="small-text">{draft ?? ms} ms</span>
      </div>
      <div key={n} className={`pt-preview ${cur !== 'none' ? `pt-${cur}` : ''}`} style={{ '--pt-ms': `${draft ?? ms}ms` } as React.CSSProperties}><b>Preview</b><div className="small-text muted">This is how the next page will appear.</div></div>
    </div>
  );
}

/** Full-screen settings: profile, preferences, model aliases, security and (Super Admin) application settings. */
export function SettingsModal({ onClose: onClosed, initialTab }: { onClose: () => void; initialTab?: string }) {
  const [closing, setClosing] = useState(false);
  const onClose = () => { if (!closing) { setClosing(true); window.setTimeout(onClosed, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 220); } };
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin';
  const tabs = [['models', 'Model aliases'], ['ui', 'UI settings'], ['categories', 'My categories'], ['profile', 'Profile & Preferences'], ['security', 'Change password'], ['message', 'Send message'], ...(isAdmin ? [['app', 'Application & Backups']] : [])] as [string, string][];
  const [tab, setTab] = useState(initialTab ?? 'models');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className={`fs-modal ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="fs-head"><h2>Settings</h2><button onClick={onClose} aria-label="Close settings">✕ Close</button></div>
      <div className="fs-body">
        <div className="fs-tabs" role="tablist" aria-orientation="vertical">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`${tab === k ? 'active' : ''} ${k === 'message' ? 'mobile-only' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="fs-content">
          <h2 className="fs-title">{tabs.find(([k]) => k === tab)?.[1]}</h2>
          {tab === 'profile' && <MySettings embedded />}
          {tab === 'models' && <ModelAliases />}
          {tab === 'categories' && <MyCategoriesManager />}
          {tab === 'ui' && <><ThemeSetting /><UiSettings /><PageTransition /></>}
          {tab === 'security' && <ChangePassword embedded />}
          {tab === 'message' && <FeedbackModal onClose={() => setTab('models')} />}
          {tab === 'app' && isAdmin && <AdminSettings embedded />}
        </div>
      </div>
    </div>
  );
}
