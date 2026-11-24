import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export const NOT_DOC = 'Not Documented';

export function Val({ v, unit }: { v: any; unit?: string | null }) {
  if (v === null || v === undefined || v === '') return <span className="faint" title="No value in the documentation">{NOT_DOC}</span>;
  return (
    <span>
      {String(v)}
      {unit ? <span className="muted"> {unit}</span> : null}
    </span>
  );
}

export function VerifBadge({ s }: { s: string }) {
  const cls = s === 'Verified' ? 'solid' : s === 'Documentation Conflict' ? 'warn' : s === 'Rejected' ? 'dashed' : s === 'Requires Manual Verification' ? 'strong dashed' : 'dashed';
  return <span className={`badge ${cls}`}>{s}</span>;
}
export function EvBadge({ s }: { s: string }) {
  return <span className={`badge ${s === 'Explicitly Documented' ? 'strong' : s === 'Conflicting' ? 'warn' : 'dashed'}`}>{s}</span>;
}
export function EquivBadge({ s, note }: { s?: string | null; note?: string | null }) {
  if (!s) return <span className="badge dashed" title="No equivalence classification recorded">Unclassified</span>;
  return (
    <span className={`badge ${s === 'Exact Equivalent' ? 'strong' : 'dashed'}`} title={note || undefined}>
      {s}
    </span>
  );
}

export function QuoteBadge({ s }: { s?: string | null }) {
  const map: Record<string, string> = {
    exact: 'Quote matches page text',
    normalized: 'Quote matches (whitespace-normalized)',
    not_found: 'Quote NOT found on cited page',
    no_text_layer: 'No text layer — check page image',
    unchecked: 'Not checked',
  };
  const s2 = s || 'unchecked';
  return <span className={`badge ${s2 === 'exact' || s2 === 'normalized' ? 'strong' : s2 === 'not_found' ? 'warn' : 'dashed'}`}>{map[s2] ?? s2}</span>;
}

/** Standard loading indicator: spinning ring + label (role=status). `overlay` centres it over a positioned parent. */
export function Spinner({ label = 'Loading…', overlay = false }: { label?: string; overlay?: boolean }) {
  return (
    <div className={`spinner-box ${overlay ? 'overlay' : ''}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted small-text">{label}</span>
    </div>
  );
}
export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="muted loading-inline" role="status"><span className="spinner sm" aria-hidden="true" />{what}…</div>;
}
export function ErrorBox({ e }: { e: any }) {
  if (!e) return null;
  return <div className="err" role="alert">{e.message || String(e)}</div>;
}

export function Crumbs({ items }: { items: { label: ReactNode; to?: string }[] }) {
  const nav = useNavigate();
  const canBack = items.length > 1 && ((window.history.state?.idx as number | undefined) ?? 0) > 0;
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {canBack && <button type="button" className="small crumb-back" onClick={() => nav(-1)} title="Back to the previous page (keeps its filters)" aria-label="Back">← Back</button>}
      {items.map((it, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep">›</span>}
          {it.to && i < items.length - 1 ? <Link to={it.to}>{it.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** ⓘ help icon with compact explanation and an "Explore More" link. */
export function InfoIcon({ title, text, more }: { title?: string; text: ReactNode; more?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <span className="pop-anchor" ref={ref}>
      <button className="info-btn ghost" aria-label={`Help: ${title ?? 'explanation'}`} aria-expanded={open} onClick={() => setOpen(!open)} type="button">
        ⓘ
      </button>
      {open && (
        <div className="popover" role="dialog" style={{ top: '100%', left: 0 }}>
          {title && <b>{title}</b>}
          <div>{text}</div>
          {more && (
            <div style={{ marginTop: 8 }}>
              <Link to={more} onClick={() => setOpen(false)}>Explore More →</Link>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Pagers currently on screen; the most recently mounted one answers the arrow keys. */
const pagerStack: { current: { prev: () => void; next: () => void; jump: (n: number) => void } }[] = [];

/**
 * Sticky pagination bar. Keys (no modifier, not while typing, no dialog open):
 * ← / → previous / next page; type a number (e.g. 10) to jump to that page (0 or 1 = first page; ignored when the page does not exist).
 */
export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const [typed, setTyped] = useState('');
  const h = useRef({ prev: () => {}, next: () => {}, jump: (_n: number) => {} });
  h.current = { prev: () => page > 1 && onPage(page - 1), next: () => page < pages && onPage(page + 1), jump: (n) => { const t = n <= 1 ? 1 : n; if (t <= pages && t !== page) onPage(t); } };
  const buf = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    pagerStack.push(h);
    const reset = () => { clearTimeout(timer.current); buf.current = ''; setTyped(''); };
    const commit = () => { const n = Number(buf.current); reset(); if (!Number.isNaN(n)) h.current.jump(n); };
    const onKey = (e: KeyboardEvent) => {
      const digit = /^[0-9]$/.test(e.key);
      const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      const pending = buf.current !== '' && (e.key === 'Enter' || e.key === 'Escape');
      if (!(arrow || digit || pending) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      if (pagerStack[pagerStack.length - 1] !== h) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.getAttribute('role') === 'separator' || t.getAttribute('role') === 'tab')) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (arrow) { reset(); if (e.key === 'ArrowLeft') h.current.prev(); else h.current.next(); return; }
      if (e.key === 'Enter') return commit();
      if (e.key === 'Escape') return reset();
      buf.current = (buf.current + e.key).slice(0, 4);
      setTyped(buf.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(commit, 700);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('keydown', onKey);
      const k = pagerStack.indexOf(h);
      if (k >= 0) pagerStack.splice(k, 1);
    };
  }, []);
  return (
    <div className="row pager">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous page (← key)" aria-keyshortcuts="ArrowLeft">← Prev</button>
      <span className="muted small-text">Page {page} of {pages} · {total} records</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} title="Next page (→ key)" aria-keyshortcuts="ArrowRight">Next →</button>
      {typed
        ? <span className="pager-hint typing" role="status">Go to page <b>{typed}</b>{Number(typed) > pages ? ` — only ${pages} page${pages === 1 ? '' : 's'}` : ' …'}</span>
        : <span className="pager-hint faint small-text">← → change page · type a number (0 or 1 = first) to jump</span>}
    </div>
  );
}

export const download = (url: string) => {
  const a = document.createElement('a');
  a.href = '/api' + url;
  a.click();
};

/** Icon-only delete button (trash can). Always give a descriptive label for screen readers and the tooltip. */
export function DeleteIconButton({ label, onClick, className = 'small danger' }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`${className} icon-only`} aria-label={label} title={label} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  );
}

/** Password field with an eye toggle (show/hide). Pass-through of normal input props. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <input {...props} type={show ? 'text' : 'password'} style={{ width: '100%', paddingRight: 38, ...props.style }} />
      <button
        type="button"
        className="ghost"
        aria-label={show ? 'Hide characters' : 'Show characters'}
        aria-pressed={show}
        title={show ? 'Hide' : 'Show'}
        onClick={() => setShow(!show)}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', padding: '3px 7px', border: 'none' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {show ? (
            <>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </>
          ) : (
            <>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </span>
  );
}

const ICONS = {
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
};

/** Text input with a leading icon (magnifier = search everything, funnel = filter this list) and a clear button. */
export function SearchBox({ icon = 'search', value, onChange, onClear, className = '', style, inputRef, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  icon?: 'search' | 'filter';
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <span className={`searchbox ${className}`} style={style}>
      <svg className="sb-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
      <input {...rest} ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" className="sb-clear ghost" aria-label="Clear search" title="Clear" onClick={() => { onChange(''); onClear?.(); }}>✕</button>
      )}
    </span>
  );
}

/** Cuts long text to `max` characters followed by "..." (full text stays available through <Tip>). */
export const truncate = (s: string, max = 35) => (s.length > max ? s.slice(0, max).trimEnd() + '...' : s);

/** Standard tooltip (hover + keyboard focus, arrow, portal so overflow containers cannot clip it). */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
  };
  return (
    <>
      <span tabIndex={0} aria-label={text} onMouseEnter={show} onFocus={show} onMouseLeave={() => setPos(null)} onBlur={() => setPos(null)} style={{ cursor: 'help' }}>{children}</span>
      {pos && createPortal(<div className="tooltip" role="tooltip" style={{ left: pos.x, top: pos.y }}>{text}</div>, document.body)}
    </>
  );
}

/** A model name cut to 35 characters + "...", with the full name in a standard tooltip when it was cut. */
export function ModelName({ name, brand, max = 35 }: { name: string | null | undefined; brand?: string | null; max?: number }) {
  if (!name) return <>—</>;
  const t = truncate(name, max);
  return t === name ? <>{name}</> : <Tip text={`${brand ? brand + ' ' : ''}${name}`}>{t}</Tip>;
}
