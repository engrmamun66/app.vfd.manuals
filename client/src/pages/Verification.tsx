import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../lib/api';
import { Crumbs, ErrorBox, Loading, Pager, QuoteBadge, useAsync } from '../components/ui';
import { PageViewer } from '../components/Viewer';
import { confirmDialog, promptDialog } from '../components/dialogs';

const CMP = ['No Existing Record', 'New Information', 'Exact Match', 'Updated Information', 'Conflicting Information', 'Possible Duplicate', 'Uncertain Match'];

export function VerificationCenter() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<'staged' | 'tasks' | 'records'>('staged');
  const [status, setStatus] = useState('pending');
  const [cmp, setCmp] = useState('');
  const [quote, setQuote] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<any>(null);
  const job = sp.get('job');
  const q: any = { status, comparison: cmp, quote, type, job, page, limit: 100 };
  const { data, error, loading, reload } = useAsync(() => get('/staged', q), [status, cmp, quote, type, job, page]);
  const { data: tasks, reload: reloadTasks } = useAsync(() => get('/verification/tasks', { status: 'open' }), []);
  const act = async (fn: () => Promise<any>) => { try { setMsg(await fn()); setOpen(null); setChecked(new Set()); reload(); reloadTasks(); } catch (e) { setMsg(e); } };
  const safeIds = (data?.rows ?? []).filter((r: any) => r.status === 'pending' && ['exact', 'normalized'].includes(r.quote_match) && ['No Existing Record', 'Exact Match'].includes(r.comparison)).map((r: any) => r.id);
  const toggle = (id: number) => { const n = new Set(checked); n.has(id) ? n.delete(id) : n.add(id); setChecked(n); };
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Home', to: '/' }, { label: 'Verification Center' }]} />
      <h1>Verification Center</h1>
      <p className="muted prose">Extracted records stay in staging until a human approves them. Approval never overwrites an existing value: conflicts are preserved with both sources. Approved records start as <i>Unverified</i> until you mark them <i>Verified</i> after checking the manual page.</p>
      <div className="tabs"><button className={`tab ${tab === 'staged' ? 'active' : ''}`} onClick={() => setTab('staged')}>Staged records {data ? `(${data.total})` : ''}</button><button className={`tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>Open tasks ({tasks?.length ?? '…'})</button><button className={`tab ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}>Verify live records</button></div>
      <ErrorBox e={msg instanceof Error ? msg : null} />
      {msg && !(msg instanceof Error) && <div className="ok-box small-text mono">{JSON.stringify(msg).slice(0, 600)}</div>}
      {tab === 'staged' && (<>
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">{['pending', 'approved', 'rejected', ''].map((s) => <option key={s} value={s}>{s || 'any status'}</option>)}</select>
          <select value={cmp} onChange={(e) => { setCmp(e.target.value); setPage(1); }} aria-label="Comparison"><option value="">Any comparison</option>{CMP.map((s) => <option key={s}>{s}</option>)}</select>
          <select value={quote} onChange={(e) => { setQuote(e.target.value); setPage(1); }} aria-label="Quote check"><option value="">Any quote check</option>{['exact', 'normalized', 'not_found', 'no_text_layer', 'unchecked'].map((s) => <option key={s}>{s}</option>)}</select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type"><option value="">Params + registers</option><option value="parameter">Parameters</option><option value="modbus_register">Registers</option></select>
          {job && <button className="small" onClick={() => setSp({})}>Job #{job} ✕</button>}
          <span style={{ flex: 1 }} />
          <button className="small" disabled={!checked.size} onClick={() => act(() => post('/staged/bulk', { action: 'approve', ids: [...checked] }))}>Approve selected ({checked.size})</button>
          <button className="small" disabled={!checked.size} onClick={async () => (await confirmDialog(`Reject ${checked.size} records?`, { danger: true })) && act(() => post('/staged/bulk', { action: 'reject', ids: [...checked] }))}>Reject selected</button>
          <button className="small" disabled={!safeIds.length} title="Only records whose quote was found on the cited page and that have no conflict" onClick={() => setChecked(new Set(safeIds))}>Select quote-verified & conflict-free ({safeIds.length})</button>
        </div>
        {loading && !data ? <Loading /> : (
          <div className="table-wrap"><table><thead><tr><th></th><th>Type</th><th>Model</th><th>Code / Address</th><th>Name</th><th>Page</th><th>Quote check</th><th>Comparison</th><th>Status</th></tr></thead><tbody>
            {data?.rows.map((r: any) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td onClick={(e) => e.stopPropagation()}>{r.status === 'pending' && <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select record ${r.id}`} />}</td>
                <td>{r.record_type === 'parameter' ? 'Param' : 'Register'}</td><td className="small-text">{r.payload._brand} {r.payload._model}</td>
                <td className="code">{r.payload.code ?? r.payload.original_address}</td><td>{r.payload.name}</td><td className="num">{r.payload.page_index ?? '—'}</td>
                <td><QuoteBadge s={r.quote_match} /></td><td><span className={`badge ${r.comparison === 'Conflicting Information' ? 'warn' : 'dashed'}`}>{r.comparison}</span></td><td><span className="badge">{r.status}</span></td></tr>))}
            {!data?.rows.length && <tr><td colSpan={9} className="empty">Nothing to review.</td></tr>}</tbody></table></div>)}
        {data && <Pager page={page} limit={100} total={data.total} onPage={setPage} />}
        {error && <ErrorBox e={error} />}
      </>)}
      {tab === 'tasks' && (
        <div className="table-wrap"><table><thead><tr><th>#</th><th>Type</th><th>Task</th><th>Created</th><th></th></tr></thead><tbody>
          {tasks?.map((t: any) => <tr key={t.id}><td>{t.id}</td><td><span className="badge dashed">{t.task_type}</span></td><td>{t.title}{t.details && <details><summary className="small-text">details</summary><pre className="mono small-text" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(t.details, null, 1).slice(0, 1500)}</pre></details>}</td><td className="small-text">{new Date(t.created_at).toLocaleString()}</td>
            <td><div className="row"><button className="small" onClick={() => act(() => patch(`/verification/tasks/${t.id}`, { status: 'resolved' }))}>Resolve</button><button className="small" onClick={() => act(() => patch(`/verification/tasks/${t.id}`, { status: 'dismissed' }))}>Dismiss</button></div></td></tr>)}
          {!tasks?.length && <tr><td colSpan={5} className="empty">No open tasks.</td></tr>}</tbody></table></div>)}
      {tab === 'records' && <VerifyLive onDone={setMsg} />}
      {open && <ReviewDialog r={open} onClose={() => setOpen(null)} act={act} />}
    </div>
  );
}

function ReviewDialog({ r, onClose, act }: { r: any; onClose: () => void; act: (fn: () => Promise<any>) => void }) {
  const p = r.payload;
  const needsDecision = ['Possible Duplicate', 'Uncertain Match'].includes(r.comparison);
  const { data: rev } = useAsync(() => (r.revision_id ? get(`/revisions/${r.revision_id}`) : Promise.resolve(null)), [r.revision_id]);
  const fields = r.record_type === 'parameter' ? ['code', 'name', 'unit', 'default_value', 'min_value', 'max_value', 'resolution', 'access', 'setting_conditions'] : ['original_address', 'name', 'address_format', 'register_type', 'function_codes', 'access', 'data_length_words', 'data_type', 'scaling', 'unit'];
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Review staged record" style={{ maxWidth: 1400 }}>
        <div className="row between"><h2 style={{ margin: 0 }}>Review {r.record_type === 'parameter' ? 'parameter' : 'register'} <span className="mono">{p.code ?? p.original_address}</span></h2><button className="ghost" onClick={onClose}>✕</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(380px, 1.3fr)', gap: 16, marginTop: 10 }}>
          <div>
            <div className="table-wrap"><table><tbody>{fields.map((k) => <tr key={k}><th style={{ textTransform: 'none', letterSpacing: 0 }}>{k}</th><td>{p[k] ?? <span className="faint">null</span>}</td></tr>)}
              <tr><th style={{ textTransform: 'none' }}>common function</th><td>{p.common_function ?? '—'} {p.equivalence && <span className="badge dashed">{p.equivalence}</span>}</td></tr>
              {p.equivalence_note && <tr><th style={{ textTransform: 'none' }}>equivalence note</th><td className="small-text">{p.equivalence_note}</td></tr>}
              {p.description && <tr><th style={{ textTransform: 'none' }}>description</th><td className="small-text">{p.description}</td></tr>}</tbody></table></div>
            <h3 style={{ marginTop: 10 }}>Evidence quote <QuoteBadge s={r.quote_match} /></h3><div className="evidence-quote">{p.evidence_quote ?? '(none)'}</div>
            <div className="small-text muted">Section: {p.section ?? '—'} · {p.table_ref ?? ''} · printed page {p.printed_page ?? 'not verified'}</div>
            <h3 style={{ marginTop: 10 }}>Comparison: {r.comparison}</h3>
            {r.comparison_detail && <pre className="mono small-text" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.comparison_detail, null, 1)}</pre>}
            {r.matched_entity_id && <div className="small-text">Existing record: <Link to={`/${r.record_type === 'parameter' ? 'parameter' : 'register'}/${r.matched_entity_id}`}>#{r.matched_entity_id}</Link></div>}
            {r.status === 'pending' ? (
              <div className="row" style={{ marginTop: 12 }}>
                {!needsDecision && <button className="primary" onClick={() => act(() => post(`/staged/${r.id}/approve`, { mode: 'auto' }))}>Approve</button>}
                {needsDecision && <><button className="primary" onClick={() => act(() => post(`/staged/${r.id}/approve`, { mode: 'create_new' }))}>Create as separate record</button><button onClick={() => act(() => post(`/staged/${r.id}/approve`, { mode: 'attach' }))}>Attach as evidence to existing</button></>}
                <button className="danger" onClick={async () => { const note = await promptDialog('Reason for rejecting (optional)', { title: 'Reject record', confirmLabel: 'Reject' }); if (note !== null) act(() => post(`/staged/${r.id}/reject`, { note })); }}>Reject</button>
              </div>
            ) : <p className="muted">Already {r.status}{r.review_note ? ` — ${r.review_note}` : ''}.</p>}
          </div>
          <div>{r.revision_id && p.page_index && rev ? <PageViewer revisionId={r.revision_id} page={p.page_index} quoteMatch={r.quote_match} highlightQuote={p.evidence_quote} /> : <div className="empty">No page reference to display.</div>}</div>
        </div>
      </div>
    </div>
  );
}

function VerifyLive({ onDone }: { onDone: (m: any) => void }) {
  const [type, setType] = useState<'parameters' | 'registers'>('parameters');
  const [status, setStatus] = useState('Unverified');
  const [page, setPage] = useState(1);
  const { data, reload } = useAsync(() => get(`/${type}`, { verification: status, page, limit: 50 }), [type, status, page]);
  const set = async (id: number, s: string) => {
    try { await patch(`/${type}/${id}/verification`, { status: s, note: 'Checked against original manual page' }); onDone({ ok: true, id, status: s }); reload(); } catch (e) { onDone(e); }
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={type} onChange={(e) => { setType(e.target.value as any); setPage(1); }}><option value="parameters">Parameters</option><option value="registers">Registers</option></select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{['Unverified', 'Requires Manual Verification', 'Documentation Conflict', 'Verified'].map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Brand / Model</th><th>Code / Address</th><th>Name</th><th>Status</th><th></th></tr></thead><tbody>
        {data?.rows.map((r: any) => <tr key={r.id}><td>{r.brand} <span className="muted">{r.model}</span></td><td className="code"><Link to={`/${type === 'parameters' ? 'parameter' : 'register'}/${r.id}`}>{r.code ?? r.original_address}</Link></td><td>{r.name}</td><td>{r.verification_status}</td>
          <td><div className="row"><button className="small primary" onClick={() => set(r.id, 'Verified')}>Mark Verified</button><button className="small" onClick={() => set(r.id, 'Requires Manual Verification')}>Needs check</button><button className="small danger" onClick={() => set(r.id, 'Rejected')}>Reject</button></div></td></tr>)}
        {!data?.rows.length && <tr><td colSpan={5} className="empty">No records with this status.</td></tr>}</tbody></table></div>
      {data && <Pager page={page} limit={50} total={data.total} onPage={setPage} />}
      <p className="small-text muted">“Mark Verified” means you compared the value with the original manual page (open the record → Original documentation).</p>
    </div>
  );
}
