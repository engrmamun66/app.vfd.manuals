import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { get, post, patch, api, fmtBytes, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Crumbs, ErrorBox, Loading, VerifBadge, useAsync } from '../components/ui';
import { PageViewer } from '../components/Viewer';
import { usePageInfo } from '../components/PageTools';
import { escSnippet } from './ModbusTools';
import { ModelTabs } from '../components/ModelTabs';
import { useModels } from '../lib/models';

export function Library() {
  const { user } = useAuth();
  const { data: all, error, loading } = useAsync(() => get('/documents'), []);
  const { selected } = useModels();
  const data = selected == null ? all : all?.filter((d: any) => d.models.some((m: any) => m.id === selected));
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Documentation Library' }, { label: 'Manuals' }]} />
      <div className="row between"><h1>Documentation Library</h1></div>
      <ModelTabs />
      <ErrorBox e={error} />
      {loading ? <Loading /> : (
        <div className="table-wrap"><table><thead><tr><th>Document</th><th>Brand</th><th>Model(s)</th><th>Revision(s)</th><th>Pages</th><th>Text / OCR</th><th>Identification</th></tr></thead>
          <tbody>{data?.map((d: any) => (
            <tr key={d.id}>
              <td><Link to={`/library/document/${d.id}`}>{d.title}</Link><div className="small-text muted">{d.revisions.map((r: any) => r.file).join(', ')}</div></td>
              <td>{d.brand ?? '—'}</td><td>{d.models.map((m: any) => <div key={m.id}><Link to={`/model/${m.id}`}>{m.name}</Link></div>)}</td>
              <td className="small-text">{d.revisions.map((r: any) => <div key={r.id}>{r.label ?? 'unlabelled'} · {fmtBytes(r.size)}</div>)}</td>
              <td className="num">{d.revisions[0]?.pages}</td>
              <td className="small-text">{d.revisions[0] ? `${d.revisions[0].textPages}/${d.revisions[0].pages} text · OCR ${d.revisions[0].ocr}` : '—'}</td>
              <td><span className={`badge ${d.identification_status === 'verified' ? 'solid' : 'dashed'}`}>{d.identification_status.replace('_', ' ')}</span></td>
            </tr>))}
            {!data?.length && <tr><td colSpan={7} className="empty">No documents imported yet.</td></tr>}</tbody></table></div>)}
    </div>
  );
}

export function DocumentPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: d, error, reload } = useAsync(() => get(`/documents/${id}`), [id]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [msg, setMsg] = useState<any>(null);
  const rev = d?.revisions?.[d.revisions.length - 1];
  useEffect(() => {
    if (!rev || !q.trim()) return setHits([]);
    const t = setTimeout(() => get(`/revisions/${rev.id}/search`, { q }).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, rev?.id]);
  if (error) return <div className="page"><ErrorBox e={error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Documentation Library', to: '/library' }, { label: d.title }]} />
      <h1>{d.title}</h1>
      <div className="row"><span className="badge dashed">{d.identification_status.replace('_', ' ')}</span>{d.models.map((m: any) => <Link key={m.id} to={`/model/${m.id}`} className="badge">{m.brand} {m.name} · {m.relation_status}</Link>)}</div>
      {d.notes && <details style={{ marginTop: 8 }}><summary>Extraction notes</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</pre></details>}
      <h2 style={{ marginTop: 16 }}>Revisions</h2>
      <div className="table-wrap"><table><thead><tr><th>#</th><th>File</th><th>Label</th><th>Pages</th><th>SHA-256</th><th>Size</th><th>Imported</th><th></th></tr></thead><tbody>
        {d.revisions.map((r: any) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.original_filename}<div className="small-text faint">{r.source_rel_path}</div></td><td>{r.revision_label ?? '—'}</td><td className="num">{r.page_count}</td><td className="mono small-text">{r.sha256.slice(0, 16)}…</td><td>{fmtBytes(r.file_size)}</td><td className="small-text">{fmtDate(r.imported_at)}</td>
            <td><div className="row"><Link className="btn small" to={`/library/revision/${r.id}/page/1`}>View pages</Link><a className="btn small" href={`/api/revisions/${r.id}/file`} target="_blank" rel="noreferrer">Original</a>
              {user?.role === 'super_admin' && r.text_layer_pages < r.page_count && <button className="small" onClick={async () => { setMsg(null); try { setMsg(await post(`/revisions/${r.id}/reprocess-ocr`)); reload(); } catch (e) { setMsg(e); } }}>Run OCR on pages without text</button>}</div></td></tr>))}
      </tbody></table></div>
      {msg && <div className="ok-box small-text mono">{JSON.stringify(msg)}</div>}
      {user?.role === 'super_admin' && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="small" onClick={async () => { await patch(`/documents/${d.id}`, { identification_status: 'verified' }); reload(); }}>Mark identification verified</button>
          <button className="small" onClick={async () => { await patch(`/documents/${d.id}`, { identification_status: 'needs_review' }); reload(); }}>Mark needs review</button>
        </div>)}
      <h2 style={{ marginTop: 20 }}>Search inside this document</h2>
      <input placeholder="Search extracted text…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 320 }} aria-label="Search document" />
      <div className="stack" style={{ marginTop: 8 }}>{hits.map((h) => <div key={h.page_index} className="small-text"><Link to={`/library/revision/${rev.id}/page/${h.page_index}?tab=text`}>Page {h.page_index}{h.printed_page ? ` (printed ${h.printed_page})` : ''}</Link> <span className="snippet" dangerouslySetInnerHTML={{ __html: escSnippet(h.snippet) }} /></div>)}</div>
    </div>
  );
}

export function RevisionViewer() {
  const { rid, page } = useParams();
  const nav = useNavigate();
  const search = useLocation().search; // keeps the chosen tab (?tab=text) while turning pages
  const { user } = useAuth();
  const p = Number(page) || 1;
  const { data: rev } = useAsync(() => get(`/revisions/${rid}`), [rid]);
  const [go, setGo] = useState('');
  const [edit, setEdit] = useState(false);
  usePageInfo({ title: `${rev?.title ?? 'Document'} — page ${p}`, context: { entityType: 'document_page', revisionId: Number(rid), page: p } });
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Documentation Library', to: '/library' }, { label: rev?.title ?? 'Document', to: rev ? `/library/document/${rev.document_id}` : undefined }, { label: `Page ${p}` }]} />
      <div className="row" style={{ marginBottom: 8 }}>
        <form onSubmit={(e) => { e.preventDefault(); if (Number(go) > 0) nav(`/library/revision/${rid}/page/${Number(go)}${search}`); }} className="row"><label htmlFor="gp" style={{ margin: 0 }}>Go to PDF page</label><input id="gp" value={go} onChange={(e) => setGo(e.target.value)} style={{ width: 80 }} /><button className="small">Go</button></form>
        {user?.role === 'super_admin' && <button className="small" onClick={() => setEdit(!edit)}>Add record from this page</button>}
      </div>
      {edit && rev && <ManualRecord revisionId={Number(rid)} page={p} onDone={() => setEdit(false)} />}
      <PageViewer overlay revisionId={Number(rid)} page={p} onPage={(n) => nav(`/library/revision/${rid}/page/${n}${search}`)} />
    </div>
  );
}

/** Manual record entry: goes to staged review, quote verified against the page text. */
function ManualRecord({ revisionId, page, onDone }: { revisionId: number; page: number; onDone: () => void }) {
  const { data: models } = useAsync(() => get('/models'), []);
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const [type, setType] = useState<'parameter' | 'modbus_register'>('parameter');
  const [f, setF] = useState<Record<string, string>>({});
  const [model, setModel] = useState('');
  const [res, setRes] = useState<any>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const fields = type === 'parameter' ? ['code', 'name', 'unit', 'default_value', 'min_value', 'max_value', 'resolution', 'access', 'description'] : ['original_address', 'name', 'address_format', 'function_codes', 'access', 'data_type', 'scaling', 'unit', 'description'];
  const submit = async () => {
    try {
      const rec: any = { ...f, page_index: page };
      Object.keys(rec).forEach((k) => rec[k] === '' && delete rec[k]);
      setRes(await post('/staged/manual', { revision_id: revisionId, record_type: type, model_id: Number(model), record: rec }));
    } catch (e) { setRes(e); }
  };
  return (
    <div className="card alt" style={{ marginBottom: 12 }}>
      <div className="row"><select value={type} onChange={(e) => setType(e.target.value as any)}><option value="parameter">Parameter</option><option value="modbus_register">Modbus register</option></select>
        <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model"><option value="">Model…</option>{models?.map((m: any) => <option key={m.id} value={m.id}>{m.brand} {m.name}</option>)}</select>
        <select value={f.common_function ?? ''} onChange={set('common_function')} aria-label="Common function"><option value="">Common function (optional)</option>{tax?.flatMap((c: any) => c.functions).map((x: any) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select></div>
      <div className="grid2" style={{ marginTop: 8 }}>{fields.map((k) => <div className="field" key={k}><label>{k}</label><input value={f[k] ?? ''} onChange={set(k)} /></div>)}</div>
      <div className="field"><label>evidence_quote (copy verbatim from this page — it is checked against the page text)</label><textarea value={f.evidence_quote ?? ''} onChange={set('evidence_quote')} /></div>
      <div className="row"><button className="primary" disabled={!model} onClick={submit}>Stage for review (page {page})</button><button onClick={onDone}>Close</button></div>
      {res && (res instanceof Error ? <ErrorBox e={res} /> : <div className="ok-box">Staged #{res.stagedId} · quote: {res.quoteMatch} · {res.comparison}. Approve it in the <Link to="/verification">Verification Center</Link>.</div>)}
    </div>
  );
}
