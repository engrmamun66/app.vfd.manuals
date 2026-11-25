import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { get } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { escSnippet, AddressConverter, CommSettings } from './pages/ModbusTools';
import { ChangePassword, Login, Register } from './pages/AuthPages';
import { Compare, Dashboard, FunctionPage, ModelPage, ParameterResearch, Parameters, RegisterResearch, Registers, ResolveEntity } from './pages/KB';
import { KnowledgePage } from './pages/Knowledge';
import { BookmarksPage } from './pages/Bookmarks';
import { AnnotationsPage } from './pages/AnnotationsPage';
import { DocumentPage, Library, RevisionViewer } from './pages/Library';
import { VerificationCenter } from './pages/Verification';
import { FeedbackAdmin } from './pages/Feedback';
import { PaymentsAdmin, PremiumSettings, SubscriptionsAdmin } from './pages/PremiumAdmin';
import { PremiumProvider, usePremium } from './lib/premium';
import { ADMIN_HOME, adminSections, isAdminPath, mainSections } from './lib/nav';
import { MyCategoriesProvider, useMyCategories } from './lib/myCategories';
import { MineIcon, MyCategoriesModal } from './components/MyCategories';
import { PageAnnotations } from './components/PageAnnotations';
import { FeedbackModal } from './components/FeedbackModal';
import { AdminContent, AdminLogs, AdminSettings, AdminUsers, MySettings } from './pages/Admin';
import { Loading, SearchBox, useAsync } from './components/ui';
import { ModelsProvider, useModels } from './lib/models';
import { MonitorIcon, MoonIcon, NavIcon, SunIcon } from './components/icons';
import { PageToolbar, PageToolsProvider } from './components/PageTools';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsModal } from './components/SettingsModal';
import { DialogProvider } from './components/dialogs';

const HotkeyCtx = createContext<{ keys: Map<string, string>; show: boolean }>({ keys: new Map(), show: false });

function Nav({ to, children, sub, mine }: { to: string; children: React.ReactNode; sub?: boolean; mine?: boolean }) {
  const { keys, show } = useContext(HotkeyCtx);
  const k = keys.get(to);
  const { menuLocked, openPlans } = usePremium();
  const locked = menuLocked(to);
  return <NavLink to={to} end onClick={(e) => { if (locked) { e.preventDefault(); openPlans('This menu is a Pro feature.'); } }} className={({ isActive }) => `nav-link ${sub ? 'sub' : ''} ${mine ? 'mine' : ''} ${locked ? 'locked' : ''} ${isActive ? 'active' : ''}`}>{!sub && !mine && <NavIcon to={to} />}{children}{locked && <LockIcon />}{show && k && <kbd className="key-badge" aria-hidden="true">{k.toUpperCase()}</kbd>}</NavLink>;
}

export const LockIcon = () => (
  <svg className="nav-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Pro"><rect x="4" y="11" width="16" height="10" rx="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);

/** Shown instead of a page the Super Admin marked as Pro-only. */
function LockedPage() {
  const { openPlans, status } = usePremium();
  const m = status?.config.plans.monthly.price;
  return (
    <div className="page locked-page">
      <div className="locked-card">
        <span className="locked-badge" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><path d="M12 15v2" /></svg>
        </span>
        <span className="badge solid">PRO</span>
        <h1>Pro feature</h1>
        <p className="muted">This page is part of the Pro plan. Upgrade to open it and unlock everything else.</p>
        <ul className="locked-list">
          <li>Every menu and VFD model unlocked</li>
          <li>Unlimited comments, highlights and bookmarks</li>
          <li>Request new VFD manuals, with 24/7 support</li>
        </ul>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={() => openPlans('This page is a Pro feature.')}>See plans{m ? ` — from ৳${m}/month` : ''}</button>
          <Link className="btn" to="/">Back to Dashboard</Link>
        </div>
      </div>
    </div>
  );
}

/** Assigns each nav item a unique letter: word initials first, then any remaining letter of its label, then digits. */
function assignHotkeys(items: [string, string][]) {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const [to, label] of items) {
    const words = label.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const cands = [...words.map((w) => w[0]), ...words.join('').split(''), ...'1234567890'.split('')];
    const k = cands.find((c) => /[a-z0-9]/.test(c) && !used.has(c));
    if (k) { used.add(k); map.set(to, k); }
  }
  return map;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { selected } = useModels();
  const { searchLocked, openPlans } = usePremium();
  const { data } = useAsync(() => (!searchLocked && q.trim().length >= 1 ? get('/search', { q, model: selected }) : Promise.resolve(null)), [q, selected, searchLocked]);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  return (
    <div className="search" style={{ position: 'relative' }}>
      <SearchBox icon="search" inputRef={inputRef} title={`Search (${mod} + K)`} placeholder={`Search everything (2103, 0x2103, manual text…)  ${mod} + K`} value={q} onChange={(v) => { if (searchLocked) { openPlans('Search is a Pro feature.'); return; } setQ(v); setOpen(true); }} onFocus={() => { if (searchLocked) { inputRef.current?.blur(); openPlans('Search is a Pro feature.'); return; } setOpen(true); }} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} aria-label="Global search" />
      {open && data && (
        <div className="popover" style={{ top: '100%', left: 0, width: 'min(720px, 92vw)', maxHeight: '70vh', overflow: 'auto' }} onMouseLeave={() => undefined}>
          <div className="row between"><b>Results for “{data.q}”</b><button className="small ghost" onClick={() => setOpen(false)}>Close</button></div>
          {([['Common functions', data.functions.map((f: any) => [f.id, `/function/${f.slug}`, f.name, f.category])],
            ['Parameters', data.parameters.map((p: any) => [p.id, `/parameter/${p.id}`, `${p.code} — ${p.name ?? ''}`, `${p.brand} ${p.model}`])],
            ['Modbus registers', data.registers.map((r: any) => [r.id, `/register/${r.id}`, `${r.original_address} — ${r.name}`, `${r.brand} ${r.model}`])],
            ['Models', data.models.map((m: any) => [m.id, `/model/${m.id}`, m.name, m.brand])]] as [string, [number, string, string, string][]][]).map(([title, items]) => items.length > 0 && (
            <div key={title} style={{ marginTop: 8 }}><div className="small-text muted"><b>{title}</b> ({items.length})</div>
              {items.slice(0, 12).map(([id, to, a, b]) => <div key={id}><a href={to} onClick={(e) => { e.preventDefault(); go(to); }}>{a}</a> <span className="faint small-text">{b}</span></div>)}</div>))}
          {data.pages.length > 0 && <div style={{ marginTop: 8 }}><div className="small-text muted"><b>Manual text</b> ({data.pages.length})</div>
            {data.pages.slice(0, 8).map((p: any) => <div key={p.page_id} className="small-text"><a href="#" onClick={(e) => { e.preventDefault(); go(`/library/revision/${p.revision_id}/page/${p.page_index}`); }}>{p.document_title} p.{p.page_index}</a> <span className="snippet" dangerouslySetInnerHTML={{ __html: escSnippet(p.snippet) }} /></div>)}</div>}
          {!data.functions.length && !data.parameters.length && !data.registers.length && !data.models.length && !data.pages.length && <p className="muted">No match in the database.</p>}
        </div>)}
    </div>
  );
}

function Shell() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <PremiumProvider><ModelsProvider><MyCategoriesProvider><ShellInner /></MyCategoriesProvider></ModelsProvider></PremiumProvider>;
}

function ShellInner() {
  const { user, logout, settings, updateSettings, impersonation, stopImpersonation } = useAuth();
  const loc = useLocation();
  const splitRef = useRef({ settings, updateSettings });
  splitRef.current = { settings, updateSettings };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(() => { try { return localStorage.getItem('nav-cats-open') !== '0'; } catch { return true; } });
  const toggleCats = () => setCatsOpen((o) => { try { localStorage.setItem('nav-cats-open', o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; } });
  // phones/tablets: the sidebar is an off-canvas drawer opened by the menu button
  const MOBILE_Q = '(max-width: 960px)';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia?.(MOBILE_Q).matches ?? false);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_Q);
    if (!mq) return;
    const on = () => { setIsMobile(mq.matches); setNavOpen(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => { setNavOpen(false); }, [loc.pathname]);
  const toggleSidebar = () => window.matchMedia?.(MOBILE_Q).matches ? setNavOpen((o) => !o) : setCollapsed((c) => { try { localStorage.setItem('sidebar-collapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const mine = useMyCategories();
  const isAdmin = user?.role === 'super_admin';
  const nav = useNavigate();
  const inAdmin = isAdmin && isAdminPath(loc.pathname);
  const { isPro, openPlans, menuLocked, categoryLocked } = usePremium();
  const sections = useMemo(() => (inAdmin ? adminSections : mainSections(tax)), [tax, inAdmin]);
  // collapsible sections; the section holding the current page always opens
  const [secState, setSecState] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('nav-sections') ?? '{}'); } catch { return {}; } });
  const isOpen = (t: string) => secState[t] ?? true;
  const toggleSec = (t: string) => setSecState((s) => { const n = { ...s, [t]: !(s[t] ?? true) }; try { localStorage.setItem('nav-sections', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const here = loc.pathname;
  useEffect(() => {
    const sec = sections.find((s) => s.title && s.items.some(([to]) => to === '/' ? false : here === to || here.startsWith(to + '/')));
    if (sec?.title && !(secState[sec.title] ?? true)) setSecState((s) => ({ ...s, [sec.title!]: true }));
  }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  // sidebar filter: while typing, every section opens and only matching items stay
  const [navQ, setNavQ] = useState('');
  const q = navQ.trim().toLowerCase();
  const hit = (label: string) => label.toLowerCase().includes(q);
  const showCats = catsOpen || !!q;
  const titles = sections.map((s) => s.title).filter(Boolean) as string[];
  const allOpen = titles.every(isOpen) && catsOpen;
  const toggleAll = () => {
    const next = !allOpen;
    const n = Object.fromEntries(titles.map((t) => [t, next]));
    setSecState(n); setCatsOpen(next);
    try { localStorage.setItem('nav-sections', JSON.stringify(n)); localStorage.setItem('nav-cats-open', next ? '1' : '0'); } catch { /* ignore */ }
  };
  const toggleAllRef = useRef(toggleAll);
  toggleAllRef.current = toggleAll;
  const firstMatch = q ? (sections.flatMap((sec) => sec.items.filter(([, l]) => hit(l)).map(([to]) => to))[0] ?? (mine.categories.find((c) => hit(c.name)) ? `/my/${mine.categories.find((c) => hit(c.name))!.id}` : null)) : null;
  const keys = useMemo(() => assignHotkeys(sections.flatMap((s) => s.items.filter(([to]) => to !== '/knowledge').map(([to, label]): [string, string] => [to, label]))), [sections]);

  // Ctrl/Cmd + / toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '/') { e.preventDefault(); toggleSidebar(); }
      // Ctrl/Cmd + ; collapses / expands all menu groups.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === ';') { e.preventDefault(); toggleAllRef.current(); }
      // Ctrl/Cmd + . toggles split view.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '.') {
        e.preventDefault();
        const { settings: st, updateSettings: up } = splitRef.current;
        const sv = st?.split_view ?? { enabled: false, ratio: 0.55, collapsed: null };
        up({ split_view: { ...sv, enabled: !sv.enabled, collapsed: null } } as any);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Alt (Option on Mac) tapped alone → show letter badges for 5 s; pressing a letter jumps to that page.
  const [showKeys, setShowKeys] = useState(false);
  const live = useRef({ keys, nav, show: false });
  live.current = { keys, nav, show: showKeys };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let altAlone = false;
    const hide = () => { clearTimeout(timer); setShowKeys(false); };
    const reveal = () => { clearTimeout(timer); setShowKeys(true); timer = setTimeout(() => setShowKeys(false), 5000); };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { if (!e.repeat) altAlone = true; return; }
      altAlone = false;
      if (!live.current.show) return;
      if (e.key === 'Escape') return hide();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const to = [...live.current.keys].find(([, v]) => v === k)?.[0];
      if (to) { e.preventDefault(); hide(); live.current.nav(to); }
      else if (k.length === 1) hide();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      if (altAlone) { e.preventDefault(); live.current.show ? hide() : reveal(); }
      altAlone = false;
    };
    const blur = () => { altAlone = false; };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); };
  }, []);
  if (!user) return null;
  if (user.mustChangePassword && !impersonation) return <ChangePassword forced />;
  return (
    <PageToolsProvider><HotkeyCtx.Provider value={{ keys, show: showKeys }}>
    <>
    {impersonation && (
      <div className="impersonation-bar" role="status">
        <span>Signed in as <b>{user.displayName ?? user.email}</b> ({user.email}) — started by {impersonation.byEmail}. Passwords cannot be changed in this mode.</span>
        <button type="button" className="small" onClick={() => stopImpersonation()}>Return to admin</button>
      </div>
    )}
    <div className={`app ${!isMobile && collapsed ? 'collapsed' : ''} ${isMobile && navOpen ? 'nav-open' : ''}`}>
      {isMobile && navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className="sidebar" aria-label="Main navigation" aria-hidden={isMobile ? !navOpen : collapsed}>
        <div className="nav-sticky">
        <Link to="/" className="brand" title="Go to Dashboard" aria-label="VFD Knowledge Base — go to Dashboard"><img src="/favicon.svg" alt="" width="34" height="34" className="brand-logo" /><div><b>VFD Knowledge Base</b><span>Technical Research Explorer</span></div></Link>
        <div className="nav-filter"><SearchBox icon="filter" placeholder="Filter menu…" value={navQ} onChange={setNavQ} aria-label="Filter menu" onKeyDown={(e) => { if (e.key === 'Escape') setNavQ(''); if (e.key === 'Enter' && firstMatch) { nav(firstMatch); setNavQ(''); } }} />
          <button type="button" className="nav-all ghost" onClick={toggleAll} aria-label={allOpen ? 'Collapse all groups' : 'Expand all groups'} title={`${allOpen ? 'Collapse all groups' : 'Expand all groups'} (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} + ;)`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{allOpen ? <path d="M7 20l5-5 5 5M7 4l5 5 5-5" /> : <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />}</svg>
          </button></div>
        </div>
        {sections.filter((sec) => !q || sec.items.some(([to, label, sub]) => hit(label) || (to === '/knowledge' && mine.categories.some((c) => hit(c.name))))).map((sec, i) => (
          <Fragment key={i}>
            {sec.title && <button type="button" className="nav-group nav-group-btn" aria-expanded={q ? true : isOpen(sec.title)} onClick={() => toggleSec(sec.title!)}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: isOpen(sec.title) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M9 6l6 6-6 6" /></svg>{sec.title}</button>}
            {(!sec.title || q || isOpen(sec.title)) && sec.items.map(([to, label, sub]) => {
              if (sub && !showCats) return null;
              if (q && !hit(label) && !(to === '/parameters' && sec.items.some(([, l, s]) => s && hit(l))) && !(to === '/knowledge' && mine.categories.some((c) => hit(c.name)))) return null;
              if (to === '/knowledge') return (
                <Fragment key={to}>
                  {showCats && mine.categories.filter((c) => !q || hit(c.name)).map((c) => <Nav key={`my${c.id}`} to={`/my/${c.id}`} sub mine><MineIcon /> {c.name}</Nav>)}
                  {showCats && !q && (
                    <div className="nav-add-row">
                      <button type="button" className="nav-add ghost" onClick={() => (categoryLocked ? openPlans('Custom categories are a Pro feature.') : mine.openManager())} title="Create a category of your own">+ Add category</button>
                      <button type="button" className="nav-gear ghost" aria-label="Manage my categories in Settings" title="Manage my categories (settings)" onClick={() => { setSettingsTab('categories'); setSettingsOpen(true); }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                      </button>
                    </div>
                  )}
                </Fragment>
              );
              if (to !== '/parameters') return <Nav key={to} to={to} sub={sub}>{label}</Nav>;
              return (
                <div key={to} className="nav-parent">
                  <Nav to={to}>{label}</Nav>
                  <button type="button" className="nav-toggle ghost" aria-expanded={catsOpen} aria-label={catsOpen ? 'Collapse parameter categories' : 'Expand parameter categories'} title={catsOpen ? 'Collapse' : 'Expand'} onClick={toggleCats}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: catsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M9 6l6 6-6 6" /></svg></button>
                </div>
              );
            })}
          </Fragment>
        ))}
        <div className="grow" />
        <div className="nav-bottom">
        {isAdmin && (
          <Link to={inAdmin ? '/' : ADMIN_HOME} className="admin-panel-btn" title={inAdmin ? 'Return to the application' : 'Open the Super Admin panel'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{inAdmin ? <path d="M19 12H5M12 19l-7-7 7-7" /> : <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />}</svg>
            {inAdmin ? 'Back to app' : 'Superadmin Panel'}
          </Link>
        )}
        <div className="userbox">
          <span className="avatar" aria-hidden="true">{(user.displayName ?? user.email).trim().charAt(0).toUpperCase()}</span>
          <span className="who" title={`${user.displayName ?? user.email} — ${user.email}`}>{user.displayName ?? user.email}</span>
          <span className="role-chip">{isAdmin ? 'Super Admin' : 'User'}</span>
          <button className="signout" onClick={logout} aria-label="Sign out" title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="ghost icon-btn" onClick={toggleSidebar} aria-label={(isMobile ? !navOpen : collapsed) ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={isMobile ? navOpen : !collapsed} title={`${collapsed ? 'Expand sidebar' : 'Collapse sidebar'} (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} + /)`}>☰</button>
          <GlobalSearch /><span className="spacer" />
          <PageToolbar />
          <button className="small send-request" onClick={() => setFeedbackOpen(true)} title="Send a request or complaint to the administrator">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Send message
          </button>
          {(() => { const cur = (settings?.theme ?? 'light') as 'system' | 'light' | 'dark'; const nextT = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system'; const label = { system: 'System', light: 'Light', dark: 'Dark' }; return (
            <button type="button" className="ghost icon-btn theme-cycle" onClick={() => updateSettings({ theme: nextT } as any)} aria-label={`Theme: ${label[cur]}. Switch to ${label[nextT]}`} title={`Theme: ${label[cur]} (tap for ${label[nextT]})`}>{cur === 'system' ? <MonitorIcon /> : cur === 'light' ? <SunIcon /> : <MoonIcon />}</button>); })()}
          <div className="theme-switch" role="radiogroup" aria-label="Theme mode">
            {([['system', 'System', <MonitorIcon key="s" />], ['light', 'Light', <SunIcon key="l" />], ['dark', 'Dark', <MoonIcon key="d" />]] as const).map(([k, l, ic]) => (
              <button key={k} role="radio" aria-checked={(settings?.theme ?? 'light') === k} aria-label={`${l} mode`} title={`${l} mode`} className={(settings?.theme ?? 'light') === k ? 'active' : ''} onClick={() => updateSettings({ theme: k } as any)}>{ic}</button>
            ))}
          </div>
          {!isAdmin && <button type="button" className={`small get-pro ${isPro ? 'is-pro' : ''}`} onClick={() => openPlans()} title={isPro ? 'You have Pro access' : 'See Pro plans'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5L7 14.5l-5-5 7-1z" /></svg> <span className="gp-label">{isPro ? 'Pro' : 'Get Pro'}</span>
          </button>}
          <button className="ghost icon-btn" onClick={() => { setSettingsTab(undefined); setSettingsOpen(true); }} aria-label="Settings" title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
        <MyCategoriesModal />
        <PageAnnotations />
        {settingsOpen && <SettingsModal initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />}
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
        <div key={loc.pathname} className={settings?.page_transition && settings.page_transition !== 'none' ? `pt-${settings.page_transition}` : undefined} style={{ '--pt-ms': `${settings?.page_transition_ms ?? 300}ms` } as React.CSSProperties}><ErrorBoundary resetKey={loc.pathname}>{!inAdmin && menuLocked(loc.pathname) ? <LockedPage /> : <Outlet />}</ErrorBoundary></div>
      </div>
    </div>
    </>
    </HotkeyCtx.Provider></PageToolsProvider>
  );
}

function MyCategoryRoute() {
  const { id } = useParams();
  return <Parameters key={`my${id}`} userCategory={Number(id)} />;
}

function CategoryRoute() {
  const { slug } = useParams();
  return <Parameters key={slug} category={slug!} />;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div className="page"><Loading /></div>;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/parameters" element={<Parameters />} />
        <Route path="/kb/:slug" element={<CategoryRoute />} />
        <Route path="/my/:id" element={<MyCategoryRoute />} />
        <Route path="/knowledge" element={<Navigate to="/knowledge/fault" replace />} />
        <Route path="/knowledge/:kind" element={<KnowledgePage />} />
        <Route path="/function/:slug" element={<FunctionPage />} />
        <Route path="/model/:id" element={<ModelPage />} />
        <Route path="/parameter/:id" element={<ResolveEntity kind="parameter" />} />
        <Route path="/register/:id" element={<ResolveEntity kind="register" />} />
        <Route path="/research/parameters/:brand/:model/:id/:level?" element={<ParameterResearch />} />
        <Route path="/research/modbus/:brand/:model/registers/:id/:level?" element={<RegisterResearch />} />
        <Route path="/modbus/registers" element={<Registers />} />
        <Route path="/modbus/communication" element={<CommSettings />} />
        <Route path="/modbus/converter" element={<AddressConverter />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/bookmarks" element={<BookmarksPage />} />
        <Route path="/annotations" element={<AnnotationsPage />} />
        <Route path="/library" element={<Library />} />
        <Route path="/library/document/:id" element={<DocumentPage />} />
        <Route path="/library/revision/:rid/page/:page" element={<RevisionViewer />} />
        <Route path="/superadmin" element={<Navigate to="/superadmin/subscriptions" replace />} />
        <Route path="/superadmin/subscriptions" element={<AdminOnly><SubscriptionsAdmin /></AdminOnly>} />
        <Route path="/superadmin/payments" element={<AdminOnly><PaymentsAdmin /></AdminOnly>} />
        <Route path="/superadmin/premium" element={<AdminOnly><PremiumSettings /></AdminOnly>} />
        <Route path="/superadmin/verification" element={<AdminOnly><VerificationCenter /></AdminOnly>} />
        <Route path="/superadmin/content" element={<AdminOnly><AdminContent /></AdminOnly>} />
        <Route path="/superadmin/users" element={<AdminOnly><AdminUsers /></AdminOnly>} />
        <Route path="/superadmin/requests" element={<AdminOnly><FeedbackAdmin /></AdminOnly>} />
        <Route path="/superadmin/logs" element={<AdminOnly><AdminLogs /></AdminOnly>} />
        <Route path="/superadmin/settings" element={<AdminOnly><AdminSettings /></AdminOnly>} />
        {/* earlier addresses keep working */}
        <Route path="/verification" element={<MovedTo to="/superadmin/verification" />} />
        <Route path="/admin/content" element={<MovedTo to="/superadmin/content" />} />
        <Route path="/admin/users" element={<MovedTo to="/superadmin/users" />} />
        <Route path="/admin/requests" element={<MovedTo to="/superadmin/requests" />} />
        <Route path="/admin/logs" element={<MovedTo to="/superadmin/logs" />} />
        <Route path="/admin/settings" element={<MovedTo to="/superadmin/settings" />} />
        <Route path="/settings" element={<MySettings />} />
        <Route path="/settings/password" element={<ChangePassword />} />
        <Route path="*" element={<div className="page"><h1>Not found</h1><Link to="/">Home</Link></div>} />
      </Route>
    </Routes>
  );
}

function MovedTo({ to }: { to: string }) {
  const l = useLocation();
  return <Navigate to={to + l.search} replace />;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'super_admin' ? <>{children}</> : <div className="page"><h1>Not permitted</h1><p>This area requires the Super Admin role.</p></div>;
}

export const Root = () => (
  <BrowserRouter>
    <AuthProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </AuthProvider>
  </BrowserRouter>
);
