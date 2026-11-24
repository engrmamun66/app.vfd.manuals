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
import { DocumentPage, ImportPage, Library, RevisionViewer } from './pages/Library';
import { VerificationCenter } from './pages/Verification';
import { FeedbackAdmin } from './pages/Feedback';
import { FeedbackModal } from './components/FeedbackModal';
import { AdminContent, AdminLogs, AdminSettings, AdminUsers, MySettings } from './pages/Admin';
import { Loading, SearchBox, useAsync } from './components/ui';
import { ModelsProvider, useModels } from './lib/models';
import { MonitorIcon, MoonIcon, SunIcon } from './components/icons';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsModal } from './components/SettingsModal';
import { DialogProvider } from './components/dialogs';

const HotkeyCtx = createContext<{ keys: Map<string, string>; show: boolean }>({ keys: new Map(), show: false });

function Nav({ to, children, sub }: { to: string; children: React.ReactNode; sub?: boolean }) {
  const { keys, show } = useContext(HotkeyCtx);
  const k = keys.get(to);
  return <NavLink to={to} end className={({ isActive }) => `nav-link ${sub ? 'sub' : ''} ${isActive ? 'active' : ''}`}>{children}{show && k && <kbd className="key-badge" aria-hidden="true">{k.toUpperCase()}</kbd>}</NavLink>;
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
  const { data } = useAsync(() => (q.trim().length >= 1 ? get('/search', { q, model: selected }) : Promise.resolve(null)), [q, selected]);
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
      <SearchBox icon="search" inputRef={inputRef} title={`Search (${mod} + K)`} placeholder={`Search everything (2103, 0x2103, manual text…)  ${mod} + K`} value={q} onChange={(v) => { setQ(v); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} aria-label="Global search" />
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
  return <ModelsProvider><ShellInner /></ModelsProvider>;
}

function ShellInner() {
  const { user, logout, settings, updateSettings } = useAuth();
  const loc = useLocation();
  const splitRef = useRef({ settings, updateSettings });
  splitRef.current = { settings, updateSettings };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; } });
  const toggleSidebar = () => setCollapsed((c) => { try { localStorage.setItem('sidebar-collapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const isAdmin = user?.role === 'super_admin';
  const nav = useNavigate();
  const sections = useMemo(() => {
    const kbCats = (tax ?? []).filter((c: any) => c.show_nav);
    const secs: { title?: string; items: [string, string, boolean?][] }[] = [
      { items: [['/', 'Dashboard']] },
      { title: 'Knowledge Base', items: [['/parameters', 'All Parameters'], ...kbCats.map((c: any): [string, string, boolean] => [`/kb/${c.slug}`, c.name, true]), ['/knowledge', 'Troubleshooting & Manual Topics']] },
      { title: 'Modbus & RS485', items: [['/modbus/registers', 'Register Explorer'], ['/modbus/communication', 'Communication Settings'], ['/modbus/converter', 'Address Converter']] },
      { title: 'Research', items: [['/compare', 'Multi-Brand Comparison'], ['/bookmarks', 'Research Bookmarks'], ['/annotations', 'My Annotations']] },
      { title: 'Documentation Library', items: [['/library', 'Manuals'], ...(isAdmin ? [['/library/import', 'Import Documents'] as [string, string]] : [])] },
    ];
    if (isAdmin) secs.push({ title: 'Administration', items: [['/verification', 'Verification Center'], ['/admin/content', 'Content & Order'], ['/admin/users', 'Users & Monitoring'], ['/admin/requests', 'User Requests'], ['/admin/logs', 'Activity & Audit']] });
    return secs;
  }, [tax, isAdmin]);
  const keys = useMemo(() => assignHotkeys(sections.flatMap((s) => s.items.map(([to, label]): [string, string] => [to, label]))), [sections]);

  // Ctrl/Cmd + / toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '/') { e.preventDefault(); toggleSidebar(); }
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
  if (user.mustChangePassword) return <ChangePassword forced />;
  return (
    <HotkeyCtx.Provider value={{ keys, show: showKeys }}>
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation" aria-hidden={collapsed}>
        <div className="brand"><img src="/favicon.svg" alt="" width="34" height="34" className="brand-logo" /><div><b>VFD Knowledge Base</b><span>Technical Research Explorer</span></div></div>
        {sections.map((sec, i) => (
          <Fragment key={i}>
            {sec.title && <div className="nav-group">{sec.title}</div>}
            {sec.items.map(([to, label, sub]) => <Nav key={to} to={to} sub={sub}>{label}</Nav>)}
          </Fragment>
        ))}
        <div className="grow" />
        <div className="userbox">
          <span className="avatar" aria-hidden="true">{(user.displayName ?? user.email).trim().charAt(0).toUpperCase()}</span>
          <span className="who" title={`${user.displayName ?? user.email} — ${user.email}`}>{user.displayName ?? user.email}</span>
          <span className="role-chip">{isAdmin ? 'Super Admin' : 'User'}</span>
          <button className="signout" onClick={logout} aria-label="Sign out" title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="ghost icon-btn" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={`${collapsed ? 'Expand sidebar' : 'Collapse sidebar'} (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} + /)`}>☰</button>
          <GlobalSearch /><span className="spacer" />
          <button className="small send-request" onClick={() => setFeedbackOpen(true)} title="Send a request or complaint to the administrator">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Send request
          </button>
          <div className="theme-switch" role="radiogroup" aria-label="Theme mode">
            {([['system', 'System', <MonitorIcon key="s" />], ['light', 'Light', <SunIcon key="l" />], ['dark', 'Dark', <MoonIcon key="d" />]] as const).map(([k, l, ic]) => (
              <button key={k} role="radio" aria-checked={(settings?.theme ?? 'light') === k} aria-label={`${l} mode`} title={`${l} mode`} className={(settings?.theme ?? 'light') === k ? 'active' : ''} onClick={() => updateSettings({ theme: k } as any)}>{ic}</button>
            ))}
          </div>
          <button className="ghost icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
        <div key={loc.pathname} className={settings?.page_transition && settings.page_transition !== 'none' ? `pt-${settings.page_transition}` : undefined} style={{ '--pt-ms': `${settings?.page_transition_ms ?? 300}ms` } as React.CSSProperties}><ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary></div>
      </div>
    </div>
    </HotkeyCtx.Provider>
  );
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
        <Route path="/knowledge" element={<KnowledgePage />} />
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
        <Route path="/library/import" element={<AdminOnly><ImportPage /></AdminOnly>} />
        <Route path="/library/document/:id" element={<DocumentPage />} />
        <Route path="/library/revision/:rid/page/:page" element={<RevisionViewer />} />
        <Route path="/verification" element={<AdminOnly><VerificationCenter /></AdminOnly>} />
        <Route path="/admin/content" element={<AdminOnly><AdminContent /></AdminOnly>} />
        <Route path="/admin/users" element={<AdminOnly><AdminUsers /></AdminOnly>} />
        <Route path="/admin/requests" element={<AdminOnly><FeedbackAdmin /></AdminOnly>} />
        <Route path="/admin/logs" element={<AdminOnly><AdminLogs /></AdminOnly>} />
        <Route path="/admin/settings" element={<AdminOnly><AdminSettings /></AdminOnly>} />
        <Route path="/settings" element={<MySettings />} />
        <Route path="/settings/password" element={<ChangePassword />} />
        <Route path="*" element={<div className="page"><h1>Not found</h1><Link to="/">Home</Link></div>} />
      </Route>
    </Routes>
  );
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
