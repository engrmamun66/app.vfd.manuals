import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, patch, post, put, fmtBytes, fmtDate, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Crumbs, ErrorBox, Loading, Modal, useAsync, download } from '../components/ui';

const TYPES: [string, string][] = [['brand', 'Brands'], ['model', 'Models'], ['category', 'Categories'], ['common_function', 'Common functions'], ['parameter', 'Parameters'], ['modbus_register', 'Modbus registers'], ['document', 'Documents']];

export function AdminContent() {
  const [type, setType] = useState('brand');
  const [q, setQ] = useState('');
  const { data, error, reload, setData } = useAsync<any[]>(() => get(`/admin/content/${type}`, { q }), [type, q]);
  const [drag, setDrag] = useState<number | null>(null);
  const [err, setErr] = useState<any>(null);
  const flag = async (id: number, k: string, v: boolean) => { setData((d) => d?.map((r) => (r.id === id ? { ...r, [k]: v ? 1 : 0 } : r)) ?? d); try { setErr(null); await patch(`/admin/content/${type}/${id}`, { [k]: v }); reload(); } catch (e) { setErr(e); reload(); } };
  const reorder = async (ids: number[]) => { try { await post(`/admin/content/${type}/reorder`, { orderedIds: ids }); reload(); } catch (e) { setErr(e); } };
  const onDrop = (target: number) => {
    if (drag === null || !data || drag === target) return;
    const ids = data.map((r) => r.id).filter((i) => i !== drag);
    ids.splice(ids.indexOf(target), 0, drag);
    setData(ids.map((i) => data.find((r) => r.id === i)));
    reorder(ids);
  };
  const cols: [string, string][] = [['visible', 'Visible'], ['active', 'Active'], ['show_dashboard', 'Dashboard'], ['show_nav', 'Navigation'], ['show_search', 'Search'], ['featured', 'Featured']];
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Admin' }, { label: 'Content Visibility & Order' }]} />
      <h1>Content Visibility & Display Order</h1>
      <p className="muted prose">Hiding never deletes data and never changes technical values, evidence or verification status. Settings are stored in SQLite (<code>content_display</code>). Drag rows to reorder, or edit the order number.</p>
      <div className="tabs">{TYPES.map(([k, l]) => <button key={k} className={`tab ${type === k ? 'active' : ''}`} onClick={() => setType(k)}>{l}</button>)}</div>
      <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} aria-label="Filter" />
      <ErrorBox e={error || err} />
      <div className="table-wrap"><table><thead><tr><th style={{ width: 28 }}></th><th>Item</th><th>Group</th>{cols.map(([, l]) => <th key={l}>{l}</th>)}<th>Order</th></tr></thead><tbody>
        {data?.map((r) => (
          <tr key={r.id} draggable onDragStart={() => setDrag(r.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(r.id)} style={r.visible ? undefined : { opacity: 0.55 }}>
            <td style={{ cursor: 'grab' }} aria-hidden>⠿</td><td>{r.label}</td><td className="small-text muted">{r.parent}</td>
            {cols.map(([k, l]) => <td key={k}><input type="checkbox" checked={!!r[k]} onChange={(e) => flag(r.id, k, e.target.checked)} aria-label={`${l}: ${r.label}`} /></td>)}
            <td><input type="number" defaultValue={r.display_order} key={r.display_order} style={{ width: 72 }} onBlur={(e) => Number(e.target.value) !== r.display_order && patch(`/admin/content/${type}/${r.id}`, { display_order: Number(e.target.value) }).then(reload).catch(setErr)} aria-label={`Order: ${r.label}`} /></td></tr>))}
        {data && !data.length && <tr><td colSpan={9} className="empty">No items.</td></tr>}</tbody></table></div>
    </div>
  );
}

// ============ Users & monitoring ============
export function AdminUsers() {
  const { socket, user: me } = useAuth();
  const [sort, setSort] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data: users, reload, error } = useAsync<any[]>(() => get('/admin/users', { sort, q, status }), [sort, q, status]);
  const { data: sum, reload: reloadSum, setData: setSum } = useAsync(() => get('/admin/users/summary'), []);
  const [detail, setDetail] = useState<number | null>(null);
  const [create, setCreate] = useState(false);
  const [msg, setMsg] = useState<any>(null);
  useEffect(() => {
    if (!socket) return;
    const h = (p: any) => setSum((s: any) => (s ? { ...s, presence: p } : s));
    socket.on('presence:update', h);
    socket.emit('presence:get', (p: any) => p && !p.error && h(p));
    return () => void socket.off('presence:update', h);
  }, [socket]);
  const refresh = () => { reload(); reloadSum(); };
  const toggle = async (u: any) => {
    const to = u.status === 'enabled' ? 'disabled' : 'enabled';
    if (!window.confirm(to === 'disabled' ? `Disable ${u.email}? All their sessions end immediately. Their data is kept.` : `Re-enable ${u.email}? Previously revoked sessions are NOT restored.`)) return;
    try { setMsg(await patch(`/admin/users/${u.id}`, { status: to })); refresh(); } catch (e) { setMsg(e); }
  };
  const P = sum?.presence;
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Admin' }, { label: 'Users & Monitoring' }]} />
      <div className="row between"><h1>Users & Monitoring</h1><button className="primary" onClick={() => setCreate(true)}>Create user</button></div>
      <ErrorBox e={error || (msg instanceof Error ? msg : null)} />
      {msg && !(msg instanceof Error) && <div className="ok-box small-text">{JSON.stringify(msg)}</div>}
      {sum && (<>
        <div className="stat-grid">
          {([['Registered users', sum.total], ['Enabled', sum.enabled], ['Disabled', sum.disabled], ['Never logged in', sum.neverLoggedIn], ['Active authenticated sessions (DB)', sum.activeSessions], ['Unique users online (live)', P?.uniqueOnlineUsers], ['Live socket connections', P?.socketConnections], ['Sessions with a live socket', P?.connectedSessions]] as [string, number][]).map(([l, v]) => <div className="stat" key={l}><b>{v ?? '…'}</b><span>{l}</span></div>)}
        </div>
        <p className="small-text muted">These metrics are different on purpose: one person can have several sessions (devices) and several sockets (tabs).</p>
      </>)}
      <div className="row" style={{ margin: '10px 0' }}>
        <input placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="">By id</option><option value="storage_bytes">Storage used</option><option value="last_login_at">Last login</option><option value="created_at">Registered</option><option value="files">Uploads</option><option value="comments_active">Comments</option></select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Online</th><th>Sessions</th><th>Registered</th><th>Last login</th><th>Logins</th><th>Comments</th><th>Annot.</th><th>Bookmarks</th><th>Files</th><th>Storage</th><th></th></tr></thead><tbody>
        {users?.map((u) => {
          const online = P?.users.find((x: any) => x.userId === u.id);
          return (
            <tr key={u.id}><td><a href="#" onClick={(e) => { e.preventDefault(); setDetail(u.id); }}>{u.email}</a><div className="small-text muted">#{u.id}{u.company ? ` · ${u.company}` : ''}</div></td>
              <td><span className={`badge ${u.role === 'super_admin' ? 'solid' : ''}`}>{u.role === 'super_admin' ? 'Super Admin' : 'Normal User'}</span></td><td><span className={`badge ${u.status === 'enabled' ? 'strong' : 'dashed'}`}>{u.status}</span></td>
              <td>{online ? <span className="badge solid">{online.sockets} tab(s)</span> : <span className="faint">offline</span>}</td><td className="num">{u.active_sessions}</td>
              <td className="small-text">{new Date(u.created_at).toLocaleDateString()}</td><td className="small-text">{fmtDate(u.last_login_at)}</td><td className="num">{u.login_count}</td>
              <td className="num">{u.comments_active}</td><td className="num">{u.annotations_total}</td><td className="num">{u.bookmarks}/{u.folders}</td><td className="num">{u.files}</td>
              <td className="small-text">{fmtBytes(u.storage_bytes)} / {fmtBytes(u.quota_bytes)}<div style={{ height: 4, background: 'var(--line)' }}><div style={{ height: 4, width: `${Math.min(100, (u.storage_bytes / (u.quota_bytes || 1)) * 100)}%`, background: 'var(--fg)' }} /></div></td>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><button className="small" onClick={() => setDetail(u.id)}>Details</button>{u.id !== me?.id && <button className="small" onClick={() => toggle(u)}>{u.status === 'enabled' ? 'Disable' : 'Enable'}</button>}</div></td></tr>);
        })}</tbody></table></div>
      {detail && <UserDetail id={detail} onClose={() => { setDetail(null); refresh(); }} />}
      {create && <CreateUser onClose={() => { setCreate(false); refresh(); }} />}
    </div>
  );
}

function CreateUser({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ email: '', password: '', role: 'user', displayName: '' });
  const [err, setErr] = useState<any>(null);
  return (
    <Modal title="Create user" onClose={onClose}>
      <div className="field"><label>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="field"><label>Temporary password (user must change it at first login)</label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <div className="field"><label>Role</label><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="user">Normal User</option><option value="super_admin">Super Admin</option></select></div>
      <ErrorBox e={err} />
      <button className="primary" onClick={async () => { try { await post('/admin/users', f); onClose(); } catch (e) { setErr(e); } }}>Create</button>
    </Modal>
  );
}

function UserDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: u, reload } = useAsync(() => get(`/admin/users/${id}`), [id]);
  const { data: rec } = useAsync(() => get(`/admin/users/${id}/storage/reconcile`), [id]);
  const [msg, setMsg] = useState<any>(null);
  const [lim, setLim] = useState<any>(null);
  useEffect(() => { if (u) setLim({ quotaMB: Math.round(u.limits.quotaBytes / 1048576), fileMB: Math.round(u.limits.maxFileBytes / 1048576), att: u.limits.maxAttachmentsPerComment }); }, [u]);
  const run = async (fn: () => Promise<any>) => { try { setMsg(await fn()); reload(); } catch (e) { setMsg(e); } };
  if (!u || !lim) return <Modal title="User" onClose={onClose}><Loading /></Modal>;
  const s = u.storage;
  return (
    <Modal title={u.email} onClose={onClose} wide>
      <ErrorBox e={msg instanceof Error ? msg : null} />
      {msg && !(msg instanceof Error) && <div className="ok-box mono small-text">{JSON.stringify(msg)}</div>}
      <div className="grid2">
        <div><h3>Account</h3><table><tbody>
          <tr><th>ID</th><td>{u.id}</td></tr><tr><th>Role</th><td>{u.role}</td></tr><tr><th>Status</th><td>{u.status}</td></tr><tr><th>Registered</th><td>{fmtDate(u.created_at)}</td></tr><tr><th>Last login</th><td>{fmtDate(u.last_login_at)}</td></tr><tr><th>Logins / failed</th><td>{u.login_count} / {u.failed_login_count}</td></tr>
          <tr><th>Phone</th><td>{u.phone ?? '—'}</td></tr><tr><th>Company</th><td>{u.company ?? '—'}</td></tr><tr><th>Designation</th><td>{u.designation ?? '—'}</td></tr></tbody></table>
          <div className="row" style={{ marginTop: 8 }}>
            <select value={u.role} onChange={(e) => run(() => patch(`/admin/users/${u.id}`, { role: e.target.value }))} aria-label="Role"><option value="user">Normal User</option><option value="super_admin">Super Admin</option></select>
            <button className="small" onClick={() => window.confirm('Generate a one-time temporary password? All sessions of this user will end.') && run(() => post(`/admin/users/${u.id}/reset-password`))}>Reset password</button>
            <button className="small" onClick={() => run(() => post(`/admin/users/${u.id}/revoke-all`, {}))}>Log out all sessions</button></div></div>
        <div><h3>Storage</h3><table><tbody>
          <tr><th>Total used</th><td>{fmtBytes(s.total)} ({s.percent}% of {fmtBytes(u.limits.quotaBytes)})</td></tr><tr><th>Remaining</th><td>{fmtBytes(s.remaining)}</td></tr>
          <tr><th>Files</th><td>{s.files}</td></tr><tr><th>Images</th><td>{fmtBytes(s.images)}</td></tr><tr><th>Comment attachments</th><td>{fmtBytes(s.attachments)}</td></tr><tr><th>Documents</th><td>{fmtBytes(s.documents)}</td></tr><tr><th>Exports</th><td>{fmtBytes(s.exports)}</td></tr><tr><th>Thumbnails</th><td>{fmtBytes(s.thumbnails)}</td></tr></tbody></table>
          {rec && <div className="small-text" style={{ marginTop: 6 }}><b>Filesystem reconciliation:</b> {fmtBytes(rec.filesystem.filesystemBytes)} in {rec.filesystem.filesystemFiles} files on disk · missing files: {rec.filesystem.missingFileUploadIds.length} · size mismatches: {rec.filesystem.sizeMismatchUploadIds.length} · orphan files: {rec.filesystem.orphanCount}
            {(rec.filesystem.missingFileUploadIds.length > 0 || rec.filesystem.orphanCount > 0) && <span className="badge warn" style={{ marginLeft: 4 }}>inconsistent</span>}</div>}
          <h3 style={{ marginTop: 10 }}>Limits</h3>
          <div className="row"><label style={{ margin: 0 }}>Quota MB <input type="number" style={{ width: 80 }} value={lim.quotaMB} onChange={(e) => setLim({ ...lim, quotaMB: e.target.value })} /></label><label style={{ margin: 0 }}>Max file MB <input type="number" style={{ width: 70 }} value={lim.fileMB} onChange={(e) => setLim({ ...lim, fileMB: e.target.value })} /></label><label style={{ margin: 0 }}>Images / comment <input type="number" style={{ width: 60 }} value={lim.att} onChange={(e) => setLim({ ...lim, att: e.target.value })} /></label>
            <button className="small primary" onClick={() => run(() => put(`/admin/users/${u.id}/limits`, { quotaBytes: Math.round(lim.quotaMB * 1048576), maxFileBytes: Math.round(lim.fileMB * 1048576), maxAttachmentsPerComment: Number(lim.att) }))}>Save</button></div></div>
      </div>
      <p className="small-text muted">Content counts (private items are never shown here): {u.counts.annotations} annotations ({u.counts.public_annotations} public), {u.counts.bookmarks} bookmarks, {u.counts.folders} folders.</p>
      <h3>Sessions</h3>
      <div className="table-wrap"><table><thead><tr><th>#</th><th>Device</th><th>IP</th><th>Created</th><th>Last seen</th><th>Expires</th><th>State</th><th></th></tr></thead><tbody>{u.sessions.map((x: any) => {
        const live = u.presence.some((c: any) => c.sessionId === x.id);
        const active = !x.revoked_at && new Date(x.expires_at) > new Date();
        return <tr key={x.id}><td>{x.id}</td><td className="small-text">{(x.user_agent ?? '').slice(0, 60)}</td><td className="small-text">{x.ip}</td><td className="small-text">{fmtDate(x.created_at)}</td><td className="small-text">{fmtDate(x.last_seen_at)}</td><td className="small-text">{fmtDate(x.expires_at)}</td>
          <td>{x.revoked_at ? <span className="badge dashed">revoked: {x.revoke_reason}</span> : active ? <span className="badge strong">active{live ? ' · connected' : ''}</span> : <span className="badge dashed">expired</span>}</td>
          <td>{active && <button className="small" onClick={() => window.confirm('Log out this session only?') && run(() => post(`/admin/sessions/${x.id}/revoke`, {}))}>Log out</button>}</td></tr>;
      })}</tbody></table></div>
      <h3 style={{ marginTop: 10 }}>Login history</h3>
      <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}><table><tbody>{u.loginHistory.map((h: any, i: number) => <tr key={i}><td className="small-text">{fmtDate(h.created_at)}</td><td>{h.success ? 'success' : 'FAILED'}</td><td className="small-text">{h.reason}</td><td className="small-text">{h.ip}</td></tr>)}</tbody></table></div>
    </Modal>
  );
}

// ============ Logs ============
export function AdminLogs() {
  const [tab, setTab] = useState<'activity' | 'audit'>('activity');
  const [event, setEvent] = useState('');
  const [user, setUser] = useState('');
  const { data } = useAsync(() => (tab === 'activity' ? get('/admin/activity', { event, user, limit: 200 }) : get('/admin/audit', { limit: 200 })), [tab, event, user]);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Admin' }, { label: 'Activity & Audit Logs' }]} />
      <h1>Activity & Audit Logs</h1>
      <div className="tabs"><button className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>User activity</button><button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>Technical-record audit trail</button></div>
      {tab === 'activity' && <div className="row" style={{ marginBottom: 8 }}><input placeholder="Event contains…" value={event} onChange={(e) => setEvent(e.target.value)} /><input placeholder="User id" value={user} onChange={(e) => setUser(e.target.value)} style={{ width: 90 }} /></div>}
      <div className="table-wrap"><table>
        {tab === 'activity' ? (<><thead><tr><th>When</th><th>Event</th><th>User</th><th>Actor</th><th>Entity</th><th>Details</th></tr></thead><tbody>{data?.rows.map((r: any) => <tr key={r.id}><td className="small-text">{fmtDate(r.created_at)}</td><td><span className="badge">{r.event_type}</span></td><td className="small-text">{r.user_email ?? '—'}</td><td className="small-text">{r.actor_email !== r.user_email ? r.actor_email : ''}</td><td className="small-text">{r.entity_type ? `${r.entity_type} #${r.entity_id}` : ''}</td><td className="mono small-text">{r.metadata ? JSON.stringify(r.metadata).slice(0, 160) : ''}</td></tr>)}</tbody></>)
          : (<><thead><tr><th>When</th><th>Entity</th><th>Operation</th><th>Source</th><th>Job</th><th>Change</th></tr></thead><tbody>{data?.rows.map((r: any) => <tr key={r.id}><td className="small-text">{fmtDate(r.created_at)}</td><td className="small-text">{r.entity_type} #{r.entity_id}</td><td>{r.operation}</td><td className="small-text">{r.source}</td><td>{r.import_job_id ?? ''}</td><td className="mono small-text">{(r.previous_json ?? '').slice(0, 80)} → {(r.new_json ?? '').slice(0, 120)}</td></tr>)}</tbody></>)}
      </table></div>
      {data && <p className="small-text muted">{data.total} entries (showing latest 200)</p>}
    </div>
  );
}

// ============ Settings & backups ============
export function AdminSettings() {
  const { data: s, reload, setData: setS } = useAsync(() => get('/admin/settings'), []);
  const { data: backups, reload: reloadB } = useAsync<any[]>(() => get('/admin/backups'), []);
  const [msg, setMsg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Admin' }, { label: 'Application Settings' }]} />
      <h1>Application Settings</h1>
      <ErrorBox e={msg instanceof Error ? msg : null} />
      {s && (
        <div className="card" style={{ maxWidth: 640 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--fg)', fontWeight: 400 }}><input type="checkbox" checked={!!s.registration_enabled} onChange={async (e) => { const v = e.target.checked; setS((x: any) => ({ ...x, registration_enabled: v })); try { await patch('/admin/settings', { registration_enabled: v }); } finally { reload(); } }} /> Allow new user registration (currently: <b>{s.registration_enabled ? 'enabled' : 'disabled'}</b>)</label>
          <p className="small-text muted">When disabled, new registrations are rejected; existing users can still sign in. New registrations always receive the Normal User role.</p>
          <div className="field"><label>Application title</label><input defaultValue={s.app_title} onBlur={(e) => e.target.value !== s.app_title && patch('/admin/settings', { app_title: e.target.value }).then(reload)} /></div>
        </div>)}
      <h2 style={{ marginTop: 20 }}>Database backups</h2>
      <div className="row"><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { setMsg(await post('/admin/backups')); reloadB(); } catch (e) { setMsg(e); } finally { setBusy(false); } }}>Create verified backup now</button>
        <button onClick={() => download('/export?scope=taxonomy&format=json')}>Export taxonomy JSON</button></div>
      {msg && !(msg instanceof Error) && <div className="ok-box small-text mono">{JSON.stringify(msg)}</div>}
      <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>#</th><th>File</th><th>Operation</th><th>Size</th><th>Verified</th><th>Created</th><th></th></tr></thead><tbody>
        {backups?.map((b) => <tr key={b.id}><td>{b.id}</td><td className="mono small-text">{b.file_rel_path}</td><td>{b.operation}</td><td>{fmtBytes(b.size_bytes ?? 0)}</td><td>{b.verified ? '✓' : '✗'}</td><td className="small-text">{fmtDate(b.created_at)}</td><td><a className="btn small" href={`/api/admin/backups/${b.id}/download`}>Download</a></td></tr>)}
        {backups && !backups.length && <tr><td colSpan={7} className="empty">No backups yet.</td></tr>}</tbody></table></div>
      <p className="small-text muted prose">Restore: stop the app, replace <code>database/vfd-knowledge.db</code> with a backup file (delete any <code>-wal</code>/<code>-shm</code> files), start the app. Backups are taken automatically before each import and before schema migrations.</p>
    </div>
  );
}

// ============ User settings (self) ============
export function MySettings() {
  const { user, settings, updateSettings, refresh } = useAuth();
  const { data: st } = useAsync(() => get('/me/storage'), []);
  const { data: sessions, reload } = useAsync<any[]>(() => get('/auth/sessions'), []);
  const [p, setP] = useState({ displayName: user?.displayName ?? '', phone: user?.phone ?? '', company: user?.company ?? '', designation: user?.designation ?? '' });
  const [msg, setMsg] = useState<any>(null);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Home', to: '/' }, { label: 'Settings' }]} />
      <h1>Settings</h1>
      <div className="grid2">
        <div className="card"><h2>Profile</h2><p className="muted small-text">{user?.email}</p>
          {(['displayName', 'phone', 'company', 'designation'] as const).map((k) => <div className="field" key={k}><label>{k}</label><input value={(p as any)[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>)}
          <ErrorBox e={msg instanceof Error ? msg : null} />
          <div className="row"><button className="primary" onClick={async () => { try { await patch('/auth/profile', p); setMsg({ ok: true }); refresh(); } catch (e) { setMsg(e); } }}>Save profile</button><Link className="btn" to="/settings/password">Change password</Link></div></div>
        <div className="card"><h2>Preferences</h2>
          <div className="field"><label>Language of explanations</label><select value={settings?.language} onChange={(e) => updateSettings({ language: e.target.value as any })}><option value="en">English</option><option value="bn">English + বাংলা</option></select></div>
          <div className="field"><label>Theme</label><select value={settings?.theme} onChange={(e) => updateSettings({ theme: e.target.value as any })}><option value="light">Light (black & white)</option><option value="dark">Dark</option></select></div>
          <h3>Your storage</h3>{st && <div className="small-text">{fmtBytes(st.total)} of {fmtBytes(st.quota)} used ({st.percent}%) · {st.files} files · max file {fmtBytes(st.maxFileBytes)}</div>}</div>
      </div>
      <h2 style={{ marginTop: 20 }}>Active sessions</h2>
      <div className="table-wrap"><table><thead><tr><th>Device</th><th>Created</th><th>Last seen</th><th>Expires</th><th></th></tr></thead><tbody>{sessions?.filter((s) => !s.revoked_at && new Date(s.expires_at) > new Date()).map((s) => <tr key={s.id}><td className="small-text">{(s.user_agent ?? '').slice(0, 70)} {s.current && <span className="badge solid">this session</span>}</td><td className="small-text">{fmtDate(s.created_at)}</td><td className="small-text">{fmtDate(s.last_seen_at)}</td><td className="small-text">{fmtDate(s.expires_at)}</td><td>{!s.current && <button className="small" onClick={async () => { await del(`/auth/sessions/${s.id}`); reload(); }}>Sign out</button>}</td></tr>)}</tbody></table></div>
    </div>
  );
}
