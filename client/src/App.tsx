import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { get } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { escSnippet, AddressConverter, CommSettings, PlcIntegration } from './pages/ModbusTools';
import { ChangePassword, Login, Register } from './pages/AuthPages';
import { Compare, Dashboard, FunctionPage, ModelPage, ParameterResearch, Parameters, RegisterResearch, Registers, ResolveEntity } from './pages/KB';
import { KnowledgePage } from './pages/Knowledge';
import { BookmarksPage } from './pages/Bookmarks';
import { AnnotationsPage } from './pages/AnnotationsPage';
import { DocumentPage, ImportPage, Library, RevisionViewer } from './pages/Library';
import { VerificationCenter } from './pages/Verification';
import { AdminContent, AdminLogs, AdminSettings, AdminUsers, MySettings } from './pages/Admin';
import { Loading, SearchBox, useAsync } from './components/ui';
import { ModelsProvider, useModels } from './lib/models';
import { SettingsModal } from './components/SettingsModal';
import { DialogProvider } from './components/dialogs';

function Nav({ to, children, sub }: { to: string; children: React.ReactNode; sub?: boolean }) {
  return <NavLink to={to} end className={({ isActive }) => `nav-link ${sub ? 'sub' : ''} ${isActive ? 'active' : ''}`}>{children}</NavLink>;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { selected } = useModels();
  const { data } = useAsync(() => (q.trim().length >= 1 ? get('/search', { q, model: selected }) : Promise.resolve(null)), [q, selected]);
  const nav = useNavigate();
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  return (
    <div className="search" style={{ position: 'relative' }}>
      <SearchBox icon="search" placeholder="Search everything (2103, 0x2103, manual text…)" value={q} onChange={(v) => { setQ(v); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} aria-label="Global search" />
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
  const { user, logout } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; } });
  const toggleSidebar = () => setCollapsed((c) => { try { localStorage.setItem('sidebar-collapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const isAdmin = user?.role === 'super_admin';
  if (!user) return null;
  if (user.mustChangePassword) return <ChangePassword forced />;
  const kbCats = (tax ?? []).filter((c: any) => c.show_nav);
  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation" aria-hidden={collapsed}>
        <div className="brand"><b>VFD Knowledge Base</b><span>Technical Research Explorer</span></div>
        <Nav to="/">Dashboard</Nav>
        <div className="nav-group">Knowledge Base</div>
        <Nav to="/parameters">All Parameters</Nav>
        {kbCats.map((c: any) => <Nav sub key={c.slug} to={`/kb/${c.slug}`}>{c.name}</Nav>)}
        <Nav to="/knowledge">Troubleshooting & Manual Topics</Nav>
        <div className="nav-group">Modbus & RS485</div>
        <Nav to="/modbus/registers">Register Explorer</Nav><Nav to="/modbus/communication">Communication Settings</Nav><Nav to="/modbus/converter">Address Converter</Nav><Nav to="/modbus/plc">PLC Integration</Nav>
        <div className="nav-group">Research</div>
        <Nav to="/compare">Multi-Brand Comparison</Nav><Nav to="/bookmarks">Research Bookmarks</Nav><Nav to="/annotations">My Annotations</Nav>
        <div className="nav-group">Documentation Library</div>
        <Nav to="/library">Manuals</Nav>{isAdmin && <Nav to="/library/import">Import Documents</Nav>}
        {isAdmin && (<><div className="nav-group">Administration</div><Nav to="/verification">Verification Center</Nav><Nav to="/admin/content">Content & Order</Nav><Nav to="/admin/users">Users & Monitoring</Nav><Nav to="/admin/logs">Activity & Audit</Nav></>)}
        <div className="grow" />
        <div className="userbox">
          <div title={user.email} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.displayName ?? user.email}</div>
          <div className="small-text">{isAdmin ? 'Super Admin' : 'Normal User'}</div>
          <div className="row" style={{ marginTop: 6 }}><button className="small" onClick={logout}>Sign out</button></div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="ghost icon-btn" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>☰</button>
          <GlobalSearch /><span className="spacer" />
          <button className="ghost icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        <Outlet />
      </div>
    </div>
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
        <Route path="/modbus/plc" element={<PlcIntegration />} />
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
