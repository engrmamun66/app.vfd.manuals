import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, patch, post, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ModelTabs } from '../components/ModelTabs';
import { OriginalPdfButton } from '../components/OriginalPdfButton';
import { StarIcon } from '../components/icons';
import { ImportanceBadge } from './Knowledge';
import { useModels } from '../lib/models';
import { useUiSettings } from '../lib/auth';
import { Crumbs, ModelName, Tip, truncate, ErrorBox, EquivBadge, EvBadge, InfoIcon, Loading, Pager, QuoteBadge, SearchBox, Val, VerifBadge, download, useAsync } from '../components/ui';
import { pdfUrl } from '../components/OriginalPdfButton';
import { usePageInfo } from '../components/PageTools';
import { ManualButton, PageViewer, SplitView } from '../components/Viewer';
import { Annotatable, AnnotationScope } from '../components/Annotatable';
import { SaveBookmarkButton } from './Bookmarks';
import { useMyCategories } from '../lib/myCategories';
import { CategoryPicker, MineIcon, ParameterMyCategories } from '../components/MyCategories';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ============ Dashboard ============
export function Dashboard() {
  const { data, error, loading } = useAsync(() => get('/dashboard'), []);
  if (loading) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox e={error} /></div>;
  const t = data.totals;
  const stats: [string, number][] = [
    ['Brands', t.brands], ['VFD Models', t.models], ['Documents', t.documents], ['Document Pages', t.pages],
    ['Parameters', t.parameters], ['Verified Parameters', t.verifiedParameters], ['Modbus Registers', t.modbusRegisters], ['Verified Registers', t.verifiedRegisters],
    ['Pending Review (staged)', t.pendingStaged], ['Open Verification Tasks', t.openTasks], ['Documentation Conflicts', t.conflicts],
  ];
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="muted">All figures are counted live from the database.</p>
      <div className="stat-grid">{stats.map(([l, v]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}</div>
      <div className="grid2">
        <div>
          <h2>Models</h2>
          <div className="table-wrap"><table><thead><tr><th>Brand</th><th>Model</th><th>Parameters</th><th>Registers</th></tr></thead>
            <tbody>{data.models.map((m: any) => <tr key={m.id}><td>{m.brand}</td><td><Link to={`/model/${m.id}`}><ModelName name={m.name} brand={m.brand} /></Link></td><td className="num">{m.params}</td><td className="num">{m.registers}</td></tr>)}
              {!data.models.length && <tr><td colSpan={4} className="muted">No models yet — import documents in Documentation Library → Import.</td></tr>}</tbody></table></div>
        </div>
        <div>
          <h2>Recent documentation imports</h2>
          <div className="table-wrap"><table className="resp imports"><thead><tr><th>#</th><th>File</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{data.recentImports.map((j: any) => <tr key={j.id}><td>{j.id}</td><td className="small-text">{j.file_path}</td><td><span className="badge">{j.status}{j.dry_run ? ' (dry run)' : ''}</span></td><td className="small-text">{fmtDate(j.finished_at || j.started_at)}</td></tr>)}
              {!data.recentImports.length && <tr><td colSpan={4} className="muted">No imports yet.</td></tr>}</tbody></table></div>
        </div>
      </div>
      <h2 style={{ marginTop: 20 }}>Manuals — pages</h2>
      <div className="table-wrap"><table><thead><tr><th>Manual</th><th>Brand</th><th className="num">Pages</th></tr></thead>
        <tbody>{(data.manuals ?? []).map((d: any) => <tr key={d.id}><td><Link to={`/library/document/${d.id}`}>{d.title}</Link></td><td>{d.brand ?? '—'}</td><td className="num">{d.pages ?? '—'}</td></tr>)}
          {!(data.manuals ?? []).length && <tr><td colSpan={3} className="muted">No manuals imported yet.</td></tr>}</tbody>
        {(data.manuals ?? []).length > 0 && <tfoot><tr><th colSpan={2}>Total ({data.manuals.length} manuals)</th><th className="num">{data.manuals.reduce((n: number, d: any) => n + (d.pages ?? 0), 0)}</th></tr></tfoot>}</table></div>
      <h2 style={{ marginTop: 20 }}>Recently updated technical records</h2>
      <div className="table-wrap"><table><thead><tr><th>Type</th><th>Code / Address</th><th>Name</th><th>Model</th><th>Verification</th><th>Updated</th></tr></thead>
        <tbody>{data.recentlyUpdated.map((r: any) => <tr key={r.type + r.id}><td>{r.type === 'parameter' ? 'Parameter' : 'Register'}</td><td className="code"><Link to={`/${r.type === 'parameter' ? 'parameter' : 'register'}/${r.id}`}>{r.label}</Link></td><td>{r.name}</td><td>{r.brand} {r.model}</td><td><VerifBadge s={r.verification_status} /></td><td className="small-text">{fmtDate(r.updated_at)}</td></tr>)}
          {!data.recentlyUpdated.length && <tr><td colSpan={6} className="muted">No technical records yet. Import documents, then approve staged records in the Verification Center.</td></tr>}</tbody></table></div>
    </div>
  );
}

// ============ Parameters explorer ============
export function Parameters({ category, userCategory }: { category?: string; userCategory?: number }) {
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const page = Number(q.page) || 1;
  const { selected } = useModels();
  const { showVerification, showVerificationCol, showEvidence, showExportCsv, showExportJson, showStars, accessButtons } = useUiSettings();
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const mineCats = useMyCategories();
  const { data, error, loading, setData, reload } = useAsync(() => get('/parameters', { ...q, verification: showVerification ? q.verification : undefined, evidence: showEvidence ? q.evidence : undefined, model: selected, category: category ?? q.category, ucat: userCategory ?? q.ucat, page, limit: 50 }), [sp.toString(), category, userCategory, selected, showVerification, showEvidence]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    n.delete('page');
    setSp(n, { replace: true });
  };
  const { settings } = useAuth();
  const split = !!settings?.split_view?.enabled;
  const [preview, setPreview] = useState<number | null>(null);
  const myName = userCategory ? mineCats.categories.find((c) => c.id === userCategory)?.name ?? (mineCats.loaded ? 'Category not found' : '…') : null;
  const catName = myName ?? (category && tax ? tax.find((c: any) => c.slug === category)?.name : null);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Knowledge Base', to: '/parameters' }, { label: catName ?? 'All Parameters' }]} />
      <div className="row between"><h1>{myName && <><MineIcon size={20} /> </>}{catName ?? 'All Parameters'}</h1>
        <div className="row">{showExportCsv && <button className="small" onClick={() => download(`/export?scope=parameters&format=csv${category ? '&category=' + category : ''}`)}>Export CSV</button>}{showExportJson && <button className="small" onClick={() => download(`/export?scope=parameters&format=json${category ? '&category=' + category : ''}`)}>Export JSON</button>}</div></div>
      <ModelTabs />
      <SplitView enabled={split} leftTitle="Parameters" rightTitle="Record preview" right={<RecordPreview kind="parameter" id={preview} />} left={<>
      <div className="row" style={{ marginBottom: 12 }}>
        <SearchBox icon="filter" placeholder="Filter this list: code, name, description…" value={q.q ?? ''} onChange={(v) => set('q', v)} style={{ minWidth: 300 }} aria-label="Search parameters" />
        {showStars && <div className="star-group" role="radiogroup" aria-label="Importance">{([['', 'All', 0], ['Important', '3 stars — Important', 3], ['Medium', '2 stars — Medium', 2], ['Optional', '1 star — Optional', 1]] as [string, string, number][]).map(([v, label, n]) => <button key={v} role="radio" aria-checked={(q.importance ?? '') === v} title={label} className={(q.importance ?? '') === v ? 'active' : ''} onClick={() => set('importance', v)}>{n === 0 ? 'All' : Array.from({ length: n }, (_, i) => <StarIcon key={i} />)}</button>)}</div>}
        {!showStars && <select className="ctl" value={q.importance ?? ''} onChange={(e) => set('importance', e.target.value)} aria-label="Importance"><option value="">Any importance</option><option>Important</option><option>Medium</option><option>Optional</option></select>}
        {showEvidence && <select className="ctl" value={q.evidence ?? ''} onChange={(e) => set('evidence', e.target.value)} aria-label="Evidence status"><option value="">Any evidence</option>{['Explicitly Documented', 'Calculated from Documented Data', 'Cross-Referenced', 'Unverified', 'Conflicting'].map((s) => <option key={s}>{s}</option>)}</select>}
        {accessButtons && <div className="star-group" role="radiogroup" aria-label="Access">{([['', 'All'], ['Read', 'Read'], ['Write', 'Write']] as [string, string][]).map(([v, l]) => <button key={v} role="radio" aria-checked={(q.access ?? '') === v} className={(q.access ?? '') === v ? 'active' : ''} onClick={() => set('access', v)}>{l}</button>)}</div>}
        {!accessButtons && <select className="ctl" value={q.access ?? ''} onChange={(e) => set('access', e.target.value)} aria-label="Access type"><option value="">Read / Write</option><option>Read</option><option>Write</option></select>}
        {showVerification && <select className="ctl" value={q.verification ?? ''} onChange={(e) => set('verification', e.target.value)} aria-label="Verification status"><option value="">Any verification</option>{['Verified', 'Unverified', 'Requires Manual Verification', 'Documentation Conflict'].map((s) => <option key={s}>{s}</option>)}</select>}
      </div>
      <ErrorBox e={error} />
      {loading && !data ? <Loading /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Brand / Model</th><th>Code</th><th>Name</th><th>Common function</th><th>Unit</th><th>Default</th><th>Range</th><th>Importance</th>{showVerificationCol && <th>Verification</th>}<th>Action</th></tr></thead>
            <tbody>{data?.rows.map((p: any) => (
              <tr key={p.id} className={split && preview === p.id ? 'sel' : ''} style={split ? { cursor: 'pointer' } : undefined} onClick={(e) => { if (split && !(e.target as HTMLElement).closest('a')) setPreview(p.id); }}>
                <td>{p.brand}<div className="small-text muted"><ModelName name={p.model} brand={p.brand} /></div></td>
                <td className="code"><Link to={`/parameter/${p.id}`} onClick={(e) => { if (split) { e.preventDefault(); setPreview(p.id); } }}>{p.code}</Link></td>
                <td>{p.name ?? <Val v={null} />}</td>
                <td>{p.function_slug ? <Link to={`/function/${p.function_slug}`}>{p.function_name}</Link> : <span className="faint">Unmapped</span>}</td>
                <td><Val v={p.unit} /></td><td><Val v={p.default_value} /></td>
                <td>{p.min_value || p.max_value ? `${p.min_value ?? '?'} … ${p.max_value ?? '?'}` : <Val v={null} />}</td>
                <td><ImportanceBadge v={p.importance} /></td>
                {showVerificationCol && <td><VerifBadge s={p.verification_status} /></td>}
                <td onClick={(e) => e.stopPropagation()}><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}><ManualButton manual={p.manual} /><CategoryPicker parameterId={p.id} value={p.my_category_ids ?? []} onChange={(ids) => { if (userCategory && !ids.includes(userCategory)) reload(); else data && setData({ ...data, rows: data.rows.map((r: any) => (r.id === p.id ? { ...r, my_category_ids: ids } : r)) }); }} /></div></td>
              </tr>))}
              {!data?.rows.length && <tr><td colSpan={showVerificationCol ? 10 : 9} className="empty">No parameters match. Parameters appear after staged import records are approved in the Verification Center.</td></tr>}</tbody></table></div>
          {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} />}
        </>)}
      </>} />
    </div>
  );
}

// ============ Common function → brand implementations ============
export function FunctionPage() {
  const { slug: fslug } = useParams();
  const { data: raw, error, loading } = useAsync(() => get(`/functions/${fslug}`), [fslug]);
  const { selected } = useModels();
  const data = raw && selected ? { ...raw, parameters: raw.parameters.filter((p: any) => p.model_id === selected), registers: raw.registers.filter((r: any) => r.model_id === selected) } : raw;
  usePageInfo(data ? { title: data.name, context: { entityType: 'common_function', functionSlug: fslug } } : null);
  if (error) return <div className="page"><ErrorBox e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Knowledge Base', to: '/parameters' }, { label: data.category, to: `/kb/${data.category_slug}` }, { label: data.name }]} />
      <div className="row between" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>{data.name} <InfoIcon title={data.name} text={data.short_description || 'No description recorded.'} /></h1>
      </div>
      {data.short_description && <p className="muted prose">{data.short_description} <span className="badge dashed">generic concept — not a manufacturer fact</span></p>}
      <ModelTabs />
      <h2>Brand-specific implementations</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Brand / Model</th><th>Code</th><th>Manufacturer name</th><th>Default</th><th>Range</th><th>Equivalence</th><th>Verification</th><th>Source</th></tr></thead>
        <tbody>{data.parameters.map((p: any) => (
          <tr key={p.id}>
            <td>{p.brand}<div className="small-text muted"><ModelName name={p.model} brand={p.brand} /></div></td>
            <td className="code"><Link to={`/parameter/${p.id}`}>{p.code}</Link></td><td>{p.name}</td>
            <td><Val v={p.default_value} unit={p.unit} /></td><td>{p.min_value || p.max_value ? `${p.min_value ?? '?'} … ${p.max_value ?? '?'}` : <Val v={null} />}</td>
            <td><EquivBadge s={p.equivalence} note={p.equivalence_note} />{p.equivalence_note && <div className="small-text muted" style={{ maxWidth: 280 }}>{p.equivalence_note}</div>}</td>
            <td><VerifBadge s={p.verification_status} /></td>
            <td className="small-text">{p.evidence_count} evidence</td>
          </tr>))}
          {!data.parameters.length && <tr><td colSpan={8} className="muted">Not Documented — no approved parameter is mapped to this function yet.</td></tr>}</tbody></table></div>
      {data.registers.length > 0 && (<><h2 style={{ marginTop: 20 }}>Modbus registers</h2>
        <div className="table-wrap"><table><thead><tr><th>Brand / Model</th><th>Original address</th><th>Name</th><th>Access</th><th>Scaling</th><th>Verification</th></tr></thead>
          <tbody>{data.registers.map((r: any) => <tr key={r.id}><td>{r.brand}<div className="small-text muted"><ModelName name={r.model} brand={r.brand} /></div></td><td className="code"><Link to={`/register/${r.id}`}>{r.original_address}</Link></td><td>{r.name}</td><td><Val v={r.access} /></td><td><Val v={r.scaling} /></td><td><VerifBadge s={r.verification_status} /></td></tr>)}</tbody></table></div></>)}
      {data.modelsWithoutRecord.length > 0 && <p className="muted small-text" style={{ marginTop: 14 }}>No record for this function (shown as <i>Not Documented</i> in comparison): {data.modelsWithoutRecord.map((m: any) => `${m.brand} ${m.name}`).join(', ')}.</p>}
    </div>
  );
}

// ============ Research detail pages (dynamic URLs) ============
const LEVELS = [['overview', 'Details'], ['explanation', 'Explanation'], ['original', 'Manual page']] as const;
/** Earlier tab addresses (/detailed, /advanced, /source, /purpose, /scaling) open the tab that now holds that content. */
const LEVEL_ALIAS: Record<string, string> = { detailed: 'explanation', advanced: 'explanation', source: 'overview', purpose: 'overview', scaling: 'overview' };
const levelOf = (lv?: string) => { const k = LEVEL_ALIAS[lv ?? ''] ?? lv; return (LEVELS.find(([x]) => x === k)?.[0] ?? 'overview') as string; };

function EvidenceList({ evidence, selected, onSelect }: { evidence: any[]; selected: number | null; onSelect: (i: number) => void }) {
  if (!evidence.length) return <div className="err">Page Reference Not Verified — no source reference is recorded for this record.</div>;
  return (
    <div className="stack">
      {evidence.map((e, i) => (
        <div className="card" key={e.id} style={selected === i ? { borderColor: 'var(--fg)' } : undefined}>
          <div className="row between">
            <div><b>{e.document_title}</b> <span className="badge dashed">{e.role}</span> <EvBadge s={e.evidence_status} /></div>
            <QuoteBadge s={e.quote_match} />
          </div>
          <div className="small-text muted">
            {e.revision_label ? `Revision ${e.revision_label} · ` : ''}{e.original_filename} · PDF page index <b>{e.page_index ?? '?'}</b>
            {e.printed_page ? ` · printed page ${e.printed_page}` : ' · printed page not verified'}
            {e.section ? ` · Section: ${e.section}` : ''}{e.table_ref ? ` · ${e.table_ref}` : ''}
          </div>
          {e.extracted_text && <div className="evidence-quote">{e.extracted_text}</div>}
          <div className="row">
            <button className="small" onClick={() => onSelect(i)}>Show page here</button>
            {e.page_index && <Link className="btn small" to={`/library/revision/${e.revision_id}/page/${e.page_index}`}>Open in viewer</Link>}
            <a className="btn small" href={pdfUrl(e.revision_id, `${e.brand ?? ''} ${e.model ?? e.document_title ?? 'manual'}`, e.page_index ?? 1)} target="_blank" rel="noreferrer">Open original PDF <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      ))}
    </div>
  );
}

function Explanations({ items }: { items: any[] }) {
  if (!items.length) return <p className="muted">No curated explanation has been added. Only text documented in the manual is shown on this page.</p>;
  return <>{items.filter((x) => x.is_current).map((x) => <div key={x.id} className="card" style={{ marginBottom: 8 }}><span className="badge">{x.level}</span> <span className="badge dashed">{x.language}</span> <EvBadge s={x.evidence_status} /><p style={{ whiteSpace: 'pre-wrap' }}>{x.body}</p></div>)}</>;
}

function Related({ d, kind }: { d: any; kind: 'parameter' | 'register' }) {
  return (
    <div className="stack">
      {d.relationships?.length > 0 && (
        <div><h3>Relationships</h3><div className="table-wrap"><table><thead><tr><th>Kind</th><th>Related item</th><th>Note</th></tr></thead><tbody>
          {d.relationships.map((r: any) => (
            <tr key={r.id}><td><span className={`badge ${r.relation_kind.startsWith('documented') ? 'strong' : 'dashed'}`}>{r.relation_kind.replace(/_/g, ' ')}</span></td>
              <td>{r.other?.missing ? 'Unavailable' : <Link to={`/${r.other.type === 'parameter' ? 'parameter' : r.other.type === 'modbus_register' ? 'register' : 'function'}/${r.other.type === 'common_function' ? r.other.slug : r.other.id}`}>{r.other.brand ? `${r.other.brand} ${r.other.model} — ` : ''}{r.other.label} {r.other.name && r.other.type !== 'common_function' ? r.other.name : ''}</Link>}</td><td className="small-text">{r.note}</td></tr>))}
        </tbody></table></div><p className="small-text muted">“Research suggestion” is not an established technical dependency. Only “documented” kinds cite a manual.</p></div>
      )}
      {kind === 'parameter' && d.sameModelSameFunction?.length > 0 && <div><h3>Other parameters of this model with the same common function</h3>{d.sameModelSameFunction.map((s: any) => <div key={s.id}><Link to={`/parameter/${s.id}`}>{s.code}</Link> {s.name} <EquivBadge s={s.equivalence} /></div>)}</div>}
      {kind === 'parameter' && d.registers?.length > 0 && <div><h3>Modbus registers mapped to the same function (this model)</h3>{d.registers.map((r: any) => <div key={r.id}><Link to={`/register/${r.id}`} className="code">{r.original_address}</Link> {r.name}</div>)}</div>}
      {kind === 'register' && d.communicationParameters?.length > 0 && <div><h3>Communication parameters of this model</h3>{d.communicationParameters.map((p: any) => <div key={p.id}><Link to={`/parameter/${p.id}`} className="code">{p.code}</Link> {p.name} <span className="muted small-text">({p.function_name})</span></div>)}</div>}
      {d.otherBrandImplementations?.length > 0 && <div><h3>Same function in other brands/models</h3>{d.otherBrandImplementations.map((s: any) => <div key={s.id}>{s.brand} <ModelName name={s.model} /> — <Link to={`/${kind}/${s.id}`} className="code">{s.code ?? s.original_address}</Link> {s.name} {s.equivalence && <EquivBadge s={s.equivalence} />}</div>)}</div>}
      {kind === 'register' && d.sameModelRegisters?.length > 0 && <details><summary>Other registers of this model ({d.sameModelRegisters.length})</summary>{d.sameModelRegisters.map((r: any) => <div key={r.id}><Link to={`/register/${r.id}`} className="code">{r.original_address}</Link> {r.name}</div>)}</details>}
    </div>
  );
}

/** Resolve short ids (/parameter/:id, /register/:id) to the canonical research URL. */
export function ResolveEntity({ kind }: { kind: 'parameter' | 'register' }) {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const lv = /^[a-z]+$/.test(sp.get('level') ?? '') ? `/${sp.get('level')}` : '';
  const { data, error } = useAsync(() => get(kind === 'parameter' ? `/parameters/${id}` : `/registers/${id}`), [id]);
  if (error) return <div className="page"><ErrorBox e={error} /><p>This research target is unavailable. It was not redirected elsewhere.</p></div>;
  if (!data) return <div className="page"><Loading /></div>;
  return <Navigate replace to={kind === 'parameter' ? `/research/parameters/${data.brand_slug}/${data.model_slug ?? slug(data.model)}/${data.id}${lv}` : `/research/modbus/${data.brand_slug}/${slug(data.model)}/registers/${data.id}${lv}`} />;
}

function RecordSummary({ id }: { id: number }) {
  const { data: d, error } = useAsync(() => get(`/parameters/${id}`), [id]);
  if (error) return <ErrorBox e={error} />;
  if (!d) return <Loading />;
  return (
    <div className="stack">
      <h3><Link to={`/parameter/${d.id}`}>{d.brand} <ModelName name={d.model} /> — <span className="mono">{d.code}</span></Link></h3>
      <div className="row"><VerifBadge s={d.verification_status} /><EquivBadge s={d.equivalence} note={d.equivalence_note} /></div>
      <div className="table-wrap"><table><tbody>
        <Field k="Name">{d.name ?? <Val v={null} />}</Field><Field k="Unit"><Val v={d.unit} /></Field><Field k="Default"><Val v={d.default_value} /></Field>
        <Field k="Minimum"><Val v={d.min_value} /></Field><Field k="Maximum"><Val v={d.max_value} /></Field><Field k="Access"><Val v={d.access_type} /></Field>
        <Field k="Description">{d.description_en ?? <Val v={null} />}</Field>
      </tbody></table></div>
      {d.equivalence_note && <div className="ok-box small-text">{d.equivalence_note}</div>}
      {d.evidence[0] ? <div className="small-text muted">Source: {d.evidence[0].document_title}, PDF page {d.evidence[0].page_index}{d.evidence[0].printed_page ? ` (printed ${d.evidence[0].printed_page})` : ''} — <Link to={`/library/revision/${d.evidence[0].revision_id}/page/${d.evidence[0].page_index}`}>open page</Link></div> : <div className="small-text">Page Reference Not Verified</div>}
    </div>
  );
}

/** Right-pane preview used by list pages in split view: record summary + the original manual page. */
function RecordPreview({ kind, id }: { kind: 'parameter' | 'register'; id: number | null }) {
  const { data: d, error } = useAsync(() => (id ? get(kind === 'parameter' ? `/parameters/${id}` : `/registers/${id}`) : Promise.resolve(null)), [kind, id]);
  const [po, setPo] = useState<number | null>(null);
  useEffect(() => setPo(null), [id]);
  if (!id) return <div className="empty">Click a record on the left to open it here.</div>;
  if (error) return <ErrorBox e={error} />;
  if (!d) return <Loading />;
  const ev = d.evidence?.[0];
  return (
    <div className="stack">
      <h3><Link to={`/${kind}/${d.id}`}>{d.brand} <ModelName name={d.model} /> — <span className="mono">{kind === 'parameter' ? d.code : d.original_address}</span></Link> <span className="small-text muted">(open full page)</span></h3>
      <div className="row"><VerifBadge s={d.verification_status} />{kind === 'parameter' && <><EvBadge s={d.evidence_status} /><EquivBadge s={d.equivalence} note={d.equivalence_note} /></>}</div>
      <div className="table-wrap"><table><tbody>
        {kind === 'parameter' ? (<>
          <Field k="Name">{d.name ?? <Val v={null} />}</Field><Field k="Unit"><Val v={d.unit} /></Field><Field k="Default"><Val v={d.default_value} /></Field>
          <Field k="Minimum"><Val v={d.min_value} /></Field><Field k="Maximum"><Val v={d.max_value} /></Field><Field k="Access"><Val v={d.access_type} /></Field>
          <Field k="Description">{d.description_en ?? <Val v={null} />}</Field>
        </>) : (<>
          <Field k="Name">{d.name ?? <Val v={null} />}</Field><Field k="Function code(s)"><Val v={d.function_codes} /></Field><Field k="Access"><Val v={d.access} /></Field>
          <Field k="Data type"><Val v={d.data_type} /></Field><Field k="Scaling"><Val v={d.scaling} /></Field><Field k="Unit"><Val v={d.unit} /></Field>
          <Field k="Description">{d.description ?? <Val v={null} />}</Field>
        </>)}
      </tbody></table></div>
      {ev ? <PageViewer overlay revisionId={ev.revision_id} page={po ?? ev.page_index ?? 1} onPage={setPo} quoteMatch={ev.quote_match} highlightQuote={ev.extracted_text} /> : <p className="muted small-text">No source page is linked to this record.</p>}
    </div>
  );
}

function ResearchFrame({ crumbs, title, subtitle, level, base, evidence, children, entity, contextExtra, others, modelTabs }: any) {
  const { settings } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [sel, setSel] = useState<number | null>(0);
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [rightMode, setRightMode] = useState<'source' | number>('source');
  const ev = evidence[sel ?? 0];
  const split = settings?.split_view?.enabled;
  usePageInfo({ title: typeof title === 'string' ? title : undefined, context: { ...contextExtra, depth: level }, modelId: modelTabs?.modelId });
  useEffect(() => setPageOverride(null), [sel]);
  const body = (
    <>
      <div className="tabs" role="tablist">{LEVELS.map(([k, l]) => <button key={k} role="tab" aria-selected={level === k} className={`tab ${level === k ? 'active' : ''}`} onClick={() => nav(`${base}/${k === 'overview' ? '' : k}`.replace(/\/$/, ''))}>{l}</button>)}</div>
      {typeof children === 'function' ? children({ sel, setSel, ev }) : children}
    </>
  );
  return (
    <AnnotationScope researchUrl={loc.pathname} context={{ ...contextExtra, level }}>
      <div className="page">
        <Crumbs items={crumbs} />
        <div className="row between" style={{ marginBottom: 8 }}>
          <div><h1 style={{ marginBottom: 2 }}>{title}</h1><div className="muted">{subtitle}</div></div>
        </div>
        {modelTabs && <ModelTabs record={modelTabs} />}
        <SplitView
          enabled={!!split && (!!ev || rightMode !== 'source')}
          leftTitle="Research"
          rightTitle={
            <span className="row">
              <select value={String(rightMode)} onChange={(e) => setRightMode(e.target.value === 'source' ? 'source' : Number(e.target.value))} aria-label="Right pane content">
                <option value="source">Original manual page{ev ? ` (p.${pageOverride ?? ev.page_index})` : ''}</option>
                {(others ?? []).map((o: any) => <option key={o.id} value={o.id}>Compare: {o.brand} {truncate(o.model)} {o.code}</option>)}
              </select>
            </span>
          }
          left={body}
          right={rightMode !== 'source' ? <RecordSummary id={rightMode} /> : ev ? <PageViewer overlay revisionId={ev.revision_id} page={pageOverride ?? ev.page_index ?? 1} onPage={setPageOverride} quoteMatch={ev.quote_match} highlightQuote={ev.extracted_text} /> : null}
        />
      </div>
    </AnnotationScope>
  );
}

function Field({ k, children, help }: { k: string; children: any; help?: string }) {
  return <tr><th style={{ width: 200, textTransform: 'none', letterSpacing: 0, fontSize: '.84rem' }}>{k} {help && <InfoIcon title={k} text={help} />}</th><td>{children}</td></tr>;
}

export function ParameterResearch() {
  const { id, level: lv, brand, model } = useParams();
  const level = levelOf(lv);
  const { data: d, error, loading, reload } = useAsync(() => get(`/parameters/${id}`), [id]);
  const { settings, user } = useAuth();
  if (error) return <div className="page"><ErrorBox e={error} /><p>The referenced parameter is unavailable. You are not being redirected to a different record.</p></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const base = `/research/parameters/${brand}/${model}/${id}`;
  return (
    <ResearchFrame
      level={level} base={base} evidence={d.evidence} others={d.otherBrandImplementations.concat(d.sameModelSameFunction)}
      crumbs={[{ label: 'Home', to: '/' }, { label: d.category ?? 'Parameters', to: d.category_slug ? `/kb/${d.category_slug}` : '/parameters' }, ...(d.function_slug ? [{ label: d.function_name, to: `/function/${d.function_slug}` }] : []), { label: <>{d.brand} <ModelName name={d.model} /></>, to: `/model/${d.model_id}` }, { label: `Parameter ${d.code}` }, { label: LEVELS.find(([k]) => k === level)![1] }]}
      title={<span><span className="mono">{d.code}</span> — {d.name ?? 'Unnamed in extraction'} <InfoIcon title={d.function_name ?? d.code} text={d.function_short || d.description_en || 'No short description recorded.'} more={`${base}/explanation`} /></span>}
      subtitle={<>{d.brand} <ModelName name={d.model} /> · {d.function_name ? <>common function: <Link to={`/function/${d.function_slug}`}>{d.function_name}</Link></> : 'not mapped to a common function'}</>}
      entity={d}
      modelTabs={{ kind: 'parameter', modelId: d.model_id, level, counterparts: d.otherBrandImplementations }}
      contextExtra={{ entityType: 'parameter', entityId: d.id, parameterId: d.id, brandId: d.brand_id, modelId: d.model_id }}
    >
      {({ sel, setSel }: any) => (
        <>
          {level === 'overview' && (
            <div className="stack">
              <div className="row"><VerifBadge s={d.verification_status} /><EvBadge s={d.evidence_status} /><EquivBadge s={d.equivalence} note={d.equivalence_note} />{d.is_demo ? <span className="badge warn">DEMO DATA – NOT VERIFIED</span> : null}</div>
              <div className="table-wrap"><table><tbody>
                <Field k="Manufacturer parameter">{d.code}</Field><Field k="Manufacturer name">{d.name ?? <Val v={null} />}</Field>
                <Field k="Description (English)">{d.description_en ? <Annotatable as="span" contentKey={`param:${d.id}:desc`} text={d.description_en} /> : <Val v={null} />}</Field>
                <Field k="Unit"><Val v={d.unit} /></Field><Field k="Default value" help="Exactly as printed in the manual. Destination/capacity-dependent defaults keep the manual's wording."><Val v={d.default_value} /></Field>
                <Field k="Minimum"><Val v={d.min_value} /></Field><Field k="Maximum"><Val v={d.max_value} /></Field><Field k="Resolution"><Val v={d.resolution} /></Field>
                <Field k="Access"><Val v={d.access_type} /></Field>
                <Field k="My categories" help="Your own private categories. Only you can see them."><ParameterMyCategories parameterId={d.id} /></Field>
              </tbody></table></div>
              {d.equivalence_note && <div className="ok-box"><b>Equivalence note:</b> {d.equivalence_note}</div>}
              {user?.role === 'super_admin' && <ParameterEditor d={d} onSaved={reload} />}
              <h3>Source in the manual</h3>
              <EvidenceList evidence={d.evidence} selected={sel} onSelect={setSel} />
            </div>
          )}
          {level === 'explanation' && (
            <div className="stack">
              <h3>Documented description</h3>
              {d.description_en ? <div className="prose"><Annotatable contentKey={`param:${d.id}:desc`} text={d.description_en} /></div> : <p className="muted">Not Documented</p>}
              <h3>Setting conditions / restrictions</h3>
              {d.setting_conditions ? <div className="prose"><Annotatable contentKey={`param:${d.id}:cond`} text={d.setting_conditions} /></div> : <p className="muted">Not Documented</p>}
              {d.options?.length > 0 && <><h3>Documented option values</h3><div className="table-wrap"><table><thead><tr><th>Value</th><th>Meaning</th></tr></thead><tbody>{d.options.map((o: any, i: number) => <tr key={i}><td className="code">{o.value}</td><td>{o.label}</td></tr>)}</tbody></table></div></>}
              <h3>Curated explanations</h3><Explanations items={d.explanations.filter((x: any) => x.level === 'short' || x.level === 'detailed')} />
              <h3>Related parameters</h3><Related d={d} kind="parameter" />
            </div>
          )}
          {level === 'explanation' && (
            <div className="stack" style={{ marginTop: 18 }}>
              <h3>Advanced technical explanation</h3><Explanations items={d.explanations.filter((x: any) => x.level === 'advanced' || x.level === 'manufacturer')} />
              <h3>Differences between brands / models</h3>
              {d.otherBrandImplementations.length ? <div className="table-wrap"><table><thead><tr><th>Brand / Model</th><th>Code</th><th>Equivalence</th><th>Explanation</th></tr></thead><tbody>{d.otherBrandImplementations.map((s: any) => <tr key={s.id}><td>{s.brand} <ModelName name={s.model} /></td><td className="code"><Link to={`/parameter/${s.id}`}>{s.code}</Link></td><td><EquivBadge s={s.equivalence} /></td><td className="small-text">{s.name}</td></tr>)}</tbody></table></div> : <p className="muted">No other implementation of this function is recorded.</p>}
              <h3>Communication implications</h3>
              {d.registers.length ? d.registers.map((r: any) => <div key={r.id}><Link to={`/register/${r.id}`} className="code">{r.original_address}</Link> {r.name}</div>) : <p className="muted">Not Documented</p>}
              <h3>Verification history</h3>
              {d.verificationHistory.length ? <ul>{d.verificationHistory.map((v: any) => <li key={v.id} className="small-text">{fmtDate(v.created_at)} — {v.action}: {v.from_status ?? '—'} → {v.to_status} {v.note ? `(${v.note})` : ''}</li>)}</ul> : <p className="muted">No manual verification recorded yet.</p>}
            </div>
          )}
          {level === 'original' && (d.evidence.length ? <div className="stack">{d.evidence.length > 1 && <EvidenceList evidence={d.evidence} selected={sel} onSelect={setSel} />}{d.evidence[sel ?? 0] && <PageViewer compact overlay revisionId={d.evidence[sel ?? 0].revision_id} page={d.evidence[sel ?? 0].page_index ?? 1} quoteMatch={d.evidence[sel ?? 0].quote_match} highlightQuote={d.evidence[sel ?? 0].extracted_text} />}</div> : <EvidenceList evidence={[]} selected={null} onSelect={() => {}} />)}
        </>
      )}
    </ResearchFrame>
  );
}

const REG_TABS = LEVELS.map(([k]) => k);
export function RegisterResearch() {
  const { id, brand, model, level: lv } = useParams();
  const level = levelOf(lv);
  const { data: d, error, loading } = useAsync(() => get(`/registers/${id}`), [id]);
  const nav = useNavigate();
  if (error) return <div className="page"><ErrorBox e={error} /><p>The referenced register is unavailable. You are not being redirected to a different record.</p></div>;
  if (!d) return <div className="page"><Loading /></div>;
  const base = `/research/modbus/${brand}/${model}/registers/${id}`;
  return (
    <AnnotationScope researchUrl={`${base}${level === 'overview' ? '' : '/' + level}`} context={{ entityType: 'modbus_register', entityId: d.id, registerId: d.id, brandId: d.brand_id, modelId: d.model_id, depth: level }}>
      <RegisterBody d={d} base={base} level={level} nav={nav} />
    </AnnotationScope>
  );
}
function RegisterBody({ d, base, level, nav }: any) {
  const { settings } = useAuth();
  const [sel, setSel] = useState<number | null>(0);
  const ev = d.evidence[sel ?? 0];
  const split = settings?.split_view?.enabled;
  const [po, setPo] = useState<number | null>(null);
  usePageInfo({ title: `${d.brand} ${d.model} — ${d.original_address} ${d.name}`, context: { entityType: 'modbus_register', entityId: d.id, brandId: d.brand_id, modelId: d.model_id, depth: level }, modelId: d.model_id });
  useEffect(() => setPo(null), [sel]);
  const loc = useLocation();
  const body = (
    <>
      <div className="tabs" role="tablist">{LEVELS.map(([k, l]) => <button key={k} role="tab" aria-selected={level === k} className={`tab ${level === k ? 'active' : ''}`} onClick={() => nav(k === 'overview' ? base : `${base}/${k}`)}>{l}</button>)}</div>
      {level === 'overview' && (<div className="stack">
        <div className="table-wrap"><table><tbody>
          <Field k="Original manufacturer address" help="Kept exactly as printed. Never altered by conversion.">{d.original_address}</Field>
          <Field k="Original address format"><Val v={d.address_format} /></Field>
          <Field k="Register type / object"><Val v={d.register_type} /></Field><Field k="Function code(s)"><Val v={d.function_codes} /></Field>
          <Field k="Access"><Val v={d.access} /></Field><Field k="Data length (words)"><Val v={d.data_length_words} /></Field><Field k="Data type"><Val v={d.data_type} /></Field>
          <Field k="Scaling"><Val v={d.scaling} /></Field><Field k="Unit"><Val v={d.unit} /></Field>
          <Field k="Common function">{d.function_slug ? <Link to={`/function/${d.function_slug}`}>{d.function_name}</Link> : <Val v={null} />}</Field>
          <Field k="Verification"><VerifBadge s={d.verification_status} /> <EvBadge s={d.evidence_status} /></Field>
        </tbody></table></div>
        <h3>Description</h3>{d.description ? <div className="prose"><Annotatable contentKey={`reg:${d.id}:desc`} text={d.description} /></div> : <p className="muted">Not Documented</p>}
        {d.bit_definitions?.length > 0 && <><h3>Bit definitions (as documented)</h3><div className="table-wrap"><table><thead><tr><th>Bit</th><th>Meaning</th></tr></thead><tbody>{d.bit_definitions.map((b: any, i: number) => <tr key={i}><td className="code">{b.bit}</td><td>{b.meaning}</td></tr>)}</tbody></table></div></>}
        <h3>Related</h3><Related d={d} kind="register" />
        <h3>Scaling &amp; addressing</h3>
        <div className="table-wrap"><table><tbody><Field k="Scaling factor (documented)"><Val v={d.scaling} /></Field><Field k="Unit"><Val v={d.unit} /></Field><Field k="Data type"><Val v={d.data_type} /></Field><Field k="Byte order / word order"><Val v={d.byte_order} /> / <Val v={d.word_order} /></Field></tbody></table></div>
        <h3>Mathematical address conversions <InfoIcon title="Conversion only" text="These are base-16/base-10 arithmetic on the original address. They do NOT claim a valid PLC address, a 4xxxx reference, or a zero/one-based convention. That depends on the communication manual and PLC instruction." /></h3>
        {d.conversions.length ? <div className="table-wrap"><table><thead><tr><th>Representation</th><th>Value</th><th>Method</th></tr></thead><tbody>{d.conversions.map((c: any) => <tr key={c.representation}><td>{c.representation}</td><td className="code">{c.value}</td><td className="mono">{c.method}</td></tr>)}</tbody></table></div> : <p className="muted">No mathematical conversion stored (address is not a plain number, e.g. a parameter-derived or symbolic address). Use the <Link to="/modbus/converter">Address Converter</Link> for plain values.</p>}
        <h3>Source in the manual</h3>
        <EvidenceList evidence={d.evidence} selected={sel} onSelect={setSel} />
      </div>)}
      {level === 'explanation' && <div className="stack"><Explanations items={d.explanations} />{d.restrictions && <><h3>Communication restrictions</h3><p>{d.restrictions}</p></>}</div>}
      {level === 'original' && (d.evidence.length ? <div className="stack">{d.evidence.length > 1 && <EvidenceList evidence={d.evidence} selected={sel} onSelect={setSel} />}{ev && <PageViewer compact overlay revisionId={ev.revision_id} page={ev.page_index ?? 1} quoteMatch={ev.quote_match} highlightQuote={ev.extracted_text} />}</div> : <div className="err">Page Reference Not Verified — no source recorded.</div>)}
    </>
  );
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Home', to: '/' }, { label: 'Modbus', to: '/modbus/registers' }, { label: d.brand, to: `/modbus/registers?brand=${d.brand_slug}` }, { label: <ModelName name={d.model} brand={d.brand} />, to: `/model/${d.model_id}` }, { label: `Register ${d.original_address}` }, { label: level }]} />
      <div className="row between" style={{ marginBottom: 8 }}>
        <div><h1 style={{ marginBottom: 2 }}><span className="mono">{d.original_address}</span> — {d.name} <InfoIcon title={d.name} text={d.description || 'No description recorded.'} more={`${base}/purpose`} /></h1><div className="muted">{d.brand} {d.model}</div></div>
      </div>
      <ModelTabs record={{ kind: 'register', modelId: d.model_id, level, counterparts: d.otherBrandImplementations ?? [] }} />
      <SplitView enabled={!!split && !!ev} leftTitle="Research" rightTitle={<span>Original manual {ev ? `· p.${po ?? ev.page_index}` : ''}</span>} left={body}
        right={ev ? <PageViewer overlay revisionId={ev.revision_id} page={po ?? ev.page_index ?? 1} onPage={setPo} quoteMatch={ev.quote_match} highlightQuote={ev.extracted_text} /> : null} />
      <span hidden>{loc.key}</span>
    </div>
  );
}

// ============ Models ============
export function ModelPage() {
  const { id } = useParams();
  const { data: m, error, loading } = useAsync(() => get(`/models/${id}`), [id]);
  const { data: params } = useAsync(() => get('/parameters', { model: id, limit: 500 }), [id]);
  const { data: regs } = useAsync(() => get('/registers', { model: id, limit: 500 }), [id]);
  if (error) return <div className="page"><ErrorBox e={error} /></div>;
  if (!m) return <div className="page"><Loading /></div>;
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Knowledge Base', to: '/parameters' }, { label: m.brand }, { label: m.name }]} />
      <h1>{m.brand} <ModelName name={m.name} /></h1>
      <div className="row"><span className={`badge ${m.identification_status === 'verified' ? 'solid' : 'dashed'}`}>Identification: {m.identification_status.replace('_', ' ')}</span></div>
      <h2 style={{ marginTop: 16 }}>Source documents</h2>
      <div className="table-wrap"><table><thead><tr><th>Document</th><th>Revision</th><th>Pages</th><th>Link status</th></tr></thead><tbody>{m.documents.map((d: any) => <tr key={d.id}><td><Link to={`/library/document/${d.id}`}>{d.title}</Link><div className="small-text muted">{d.original_filename}</div></td><td>{d.revision_label ?? <Val v={null} />}</td><td className="num">{d.page_count}</td><td><span className="badge dashed">{d.relation_status}</span></td></tr>)}{!m.documents.length && <tr><td colSpan={4} className="muted">No linked document.</td></tr>}</tbody></table></div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div><h2>Parameters ({params?.total ?? '…'})</h2>{params?.rows.slice(0, 200).map((p: any) => <div key={p.id}><Link to={`/parameter/${p.id}`} className="code">{p.code}</Link> {p.name} {p.verification_status !== 'Unverified' && <VerifBadge s={p.verification_status} />}</div>)}{params && !params.total && <p className="muted">No approved parameters yet.</p>}</div>
        <div><h2>Modbus registers ({regs?.total ?? '…'})</h2>{regs?.rows.map((r: any) => <div key={r.id}><Link to={`/register/${r.id}`} className="code">{r.original_address}</Link> {r.name}</div>)}{regs && !regs.total && <p className="muted">No approved registers yet.</p>}</div>
      </div>
    </div>
  );
}

// ============ Comparison ============
export function Compare() {
  const { showExportCsv, showExportJson } = useUiSettings();
  const { data: models } = useAsync(() => get('/models'), []);
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const [sp, setSp] = useSearchParams();
  const sel = (sp.get('models') ?? '').split(',').filter(Boolean).map(Number);
  const category = sp.get('category') ?? '';
  const fn = sp.get('function') ?? '';
  const { data, error, loading } = useAsync(() => (sel.length ? get('/compare', { models: sel.join(','), category, function: fn }) : Promise.resolve(null)), [sel.join(','), category, fn]);
  const upd = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const toggle = (id: number) => upd('models', (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(0, 10)).join(','));
  const fns = useMemo(() => tax?.flatMap((c: any) => (!category || c.slug === category ? c.functions : [])) ?? [], [tax, category]);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Home', to: '/' }, { label: 'Multi-Brand Comparison' }]} />
      <h1>Multi-Brand Comparison</h1>
      <div className="card alt" style={{ marginBottom: 12 }}>
        <b>Select 2–10 models</b>
        <div className="row" style={{ marginTop: 6 }}>{models?.map((m: any) => <label key={m.id} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', margin: 0, color: 'var(--fg)', fontWeight: 400 }}><input type="checkbox" checked={sel.includes(m.id)} onChange={() => toggle(m.id)} />{m.brand} {m.name} <span className="faint small-text">({m.param_count}p/{m.register_count}r)</span></label>)}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <select className="ctl" value={category} onChange={(e) => { upd('category', e.target.value); upd('function', ''); }} aria-label="Category"><option value="">All categories</option>{tax?.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
          <select className="ctl" value={fn} onChange={(e) => upd('function', e.target.value)} aria-label="Common function"><option value="">All functions</option>{fns.map((f: any) => <option key={f.slug} value={f.slug}>{f.name}</option>)}</select>
          {sel.length > 0 && <>{showExportCsv && <button className="small" onClick={() => download(`/compare?models=${sel.join(',')}&category=${category}&function=${fn}&format=csv`)}>Export CSV</button>}{showExportJson && <button className="small" onClick={() => download(`/compare?models=${sel.join(',')}&category=${category}&function=${fn}&format=json`)}>Export JSON</button>}</>}
        </div>
      </div>
      <div className="legend" style={{ marginBottom: 8 }}><span>Cells show only approved, documented records. “Not Documented” = no record for that model.</span><span><span className="badge strong">Exact Equivalent</span> grouped as direct equivalents; others explained.</span></div>
      <ErrorBox e={error} />
      {!sel.length ? <div className="empty">Choose at least one model to start.</div> : loading ? <Loading /> : data && (
        <div className="table-wrap"><table className="cmp">
          <thead><tr><th>Category / Function</th>{data.models.map((m: any) => <th className="model" key={m.id}>{m.brand}<br /><ModelName name={m.name} brand={m.brand} /></th>)}</tr></thead>
          <tbody>{data.rows.map((r: any) => (
            <tr key={r.function.id}>
              <td><div className="small-text muted">{r.function.category}</div><Link to={`/function/${r.function.slug}`}><b>{r.function.name}</b></Link> <InfoIcon title={r.function.name} text={r.function.short_description || ''} more={`/function/${r.function.slug}`} /></td>
              {data.models.map((m: any) => {
                const cell = r.cells[m.id] ?? [];
                if (!cell.length) return <td key={m.id} className="missing">Not Documented</td>;
                return (
                  <td key={m.id}>{cell.map((c: any) => (
                    <div key={c.kind + c.id} style={{ marginBottom: 8 }}>
                      <Link to={`/${c.kind === 'parameter' ? 'parameter' : 'register'}/${c.id}`} className="code"><b>{c.kind === 'parameter' ? c.code : c.original_address}</b></Link> <span className="small-text">{c.name}</span>{c.linked && <> <span className="badge dashed" title="The manual ties this parameter to this function; it is not a direct one-to-one parameter.">related</span></>}
                      {c.kind === 'parameter' ? (
                        <div className="small-text muted">{c.default_value ? `default ${c.default_value}` : ''}{c.min_value || c.max_value ? ` · ${c.min_value ?? '?'}…${c.max_value ?? '?'}` : ''} {c.unit ?? ''}</div>
                      ) : <div className="small-text muted">{c.access ?? ''} {c.scaling ?? ''}</div>}
                      <div><EquivBadge s={c.equivalence} note={c.equivalence_note} /> <VerifBadge s={c.verification_status} /></div>
                      {c.equivalence && c.equivalence !== 'Exact Equivalent' && c.equivalence_note && <div className="small-text" style={{ maxWidth: 300 }}>↳ {c.equivalence_note}</div>}
                      {c.source ? <div className="small-text faint"><Link to={`/library/revision/${c.source.revision_id}/page/${c.source.page_index}`}>src: p.{c.source.page_index}{c.source.printed_page ? ` (printed ${c.source.printed_page})` : ''}</Link></div> : <div className="small-text faint">Page Reference Not Verified</div>}
                    </div>))}</td>
                );
              })}
            </tr>))}
            {!data.rows.length && <tr><td colSpan={data.models.length + 1} className="muted">No approved records for the selected models/filters yet.</td></tr>}</tbody></table></div>
      )}
    </div>
  );
}

// ============ Register explorer ============
export function Registers() {
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const { selected } = useModels();
  const { showVerification, showVerificationCol, showExportCsv, showExportJson, accessButtons } = useUiSettings();
  const { data, error, loading } = useAsync(() => get('/registers', { ...q, verification: showVerification ? q.verification : undefined, model: selected, page: q.page || 1, limit: 100 }), [sp.toString(), selected, showVerification]);
  const { settings } = useAuth();
  const split = !!settings?.split_view?.enabled;
  const [preview, setPreview] = useState<number | null>(null);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); n.delete('page'); setSp(n, { replace: true }); };
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Modbus & RS485' }, { label: 'Register Explorer' }]} />
      <div className="row between"><h1>Modbus Register Explorer</h1><div className="row">{showExportCsv && <button className="small" onClick={() => download('/export?scope=registers&format=csv')}>Export CSV</button>}{showExportJson && <button className="small" onClick={() => download('/export?scope=registers&format=json')}>Export JSON</button>}</div></div>
      <ModelTabs />
      <SplitView enabled={split} leftTitle="Registers" rightTitle="Record preview" right={<RecordPreview kind="register" id={preview} />} left={<>
      <div className="row" style={{ marginBottom: 12 }}>
        <SearchBox icon="filter" placeholder="Filter this list: address (2103, 0x2103, 40100) or name…" value={q.q ?? ''} onChange={(v) => set('q', v)} style={{ minWidth: 340 }} aria-label="Search registers" />
        {accessButtons && <div className="star-group" role="radiogroup" aria-label="Access">{([['', 'All'], ['Read', 'Read'], ['Write', 'Write']] as [string, string][]).map(([v, l]) => <button key={v} role="radio" aria-checked={(q.access ?? '') === v} className={(q.access ?? '') === v ? 'active' : ''} onClick={() => set('access', v)}>{l}</button>)}</div>}
        {!accessButtons && <select className="ctl" value={q.access ?? ''} onChange={(e) => set('access', e.target.value)} aria-label="Access"><option value="">Read / Write</option><option>Read</option><option>Write</option></select>}
        {showVerification && <select className="ctl" value={q.verification ?? ''} onChange={(e) => set('verification', e.target.value)} aria-label="Verification"><option value="">Any verification</option>{['Verified', 'Unverified', 'Requires Manual Verification', 'Documentation Conflict'].map((s) => <option key={s}>{s}</option>)}</select>}
      </div>
      <p className="muted small-text">Search matches only addresses present in the database (original text and stored mathematical conversions).</p>
      <ErrorBox e={error} />
      {loading && !data ? <Loading /> : (<>
        <div className="table-wrap"><table><thead><tr><th>Brand / Model</th><th>Original address</th><th>Math. conversion</th><th>Name</th><th>FC</th><th>Access</th><th>Type</th><th>Scaling</th>{showVerificationCol && <th>Verification</th>}<th>Action</th></tr></thead>
          <tbody>{data?.rows.map((r: any) => (
            <tr key={r.id} className={split && preview === r.id ? 'sel' : ''} style={split ? { cursor: 'pointer' } : undefined} onClick={(e) => { if (split && !(e.target as HTMLElement).closest('a')) setPreview(r.id); }}><td>{r.brand}<div className="small-text muted"><ModelName name={r.model} brand={r.brand} /></div></td>
              <td className="code"><Link to={`/register/${r.id}`} onClick={(e) => { if (split) { e.preventDefault(); setPreview(r.id); } }}>{r.original_address}</Link><div className="small-text faint">{r.address_format ?? ''}</div></td>
              <td className="code small-text">{r.conversions.length ? r.conversions.map((c: any) => <div key={c.representation}>{c.representation}: {c.value}</div>) : <span className="faint">—</span>}</td>
              <td>{r.name}{r.function_name && <div className="small-text muted">{r.function_name}</div>}</td><td className="code"><Val v={r.function_codes} /></td><td><Val v={r.access} /></td><td><Val v={r.data_type} /></td><td><Val v={r.scaling} /></td>{showVerificationCol && <td><VerifBadge s={r.verification_status} /></td>}<td><ManualButton manual={r.manual} /></td></tr>))}
            {!data?.rows.length && <tr><td colSpan={showVerificationCol ? 10 : 9} className="empty">No registers match.</td></tr>}</tbody></table></div>
        {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} />}</>)}
      </>} />
    </div>
  );
}

/** Super Admin: Bengali description, common-function mapping, equivalence, explanations. Manufacturer values are never edited here. */
function ParameterEditor({ d, onSaved }: { d: any; onSaved: () => void }) {
  const { data: tax } = useAsync(() => get('/taxonomy'), []);
  const [cf, setCf] = useState<string>(d.common_function_id ? String(d.common_function_id) : '');
  const [eq, setEq] = useState(d.equivalence ?? '');
  const [note, setNote] = useState(d.equivalence_note ?? '');
  const [ex, setEx] = useState({ level: 'short', language: 'en', body: '', cite: true });
  const [msg, setMsg] = useState<any>(null);
  const save = async () => {
    try {
      await patch(`/parameters/${d.id}`, { common_function_id: cf ? Number(cf) : null, equivalence: eq || null, equivalence_note: note });
      setMsg({ ok: 'Saved' });
      onSaved();
    } catch (e) { setMsg(e); }
  };
  const addExplanation = async () => {
    try {
      await post('/explanations', { entity_type: 'parameter', entity_id: d.id, level: ex.level, language: ex.language, body: ex.body, source_reference_id: ex.cite ? d.evidence[0]?.source_reference_id : undefined });
      setEx({ ...ex, body: '' });
      setMsg({ ok: 'Explanation added' });
      onSaved();
    } catch (e) { setMsg(e); }
  };
  return (
    <details className="card alt">
      <summary><b>Edit metadata (Super Admin)</b> <span className="muted small-text">— manufacturer values are not editable here</span></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="grid2">
          <div className="field"><label htmlFor="pe-cf">Common function</label>
            <select id="pe-cf" value={cf} onChange={(e) => setCf(e.target.value)}><option value="">(unmapped)</option>{tax?.map((c: any) => <optgroup key={c.slug} label={c.name}>{c.functions.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>)}</select></div>
          <div className="field"><label htmlFor="pe-eq">Equivalence</label>
            <select id="pe-eq" value={eq} onChange={(e) => setEq(e.target.value)}><option value="">(unclassified)</option>{['Exact Equivalent', 'Functionally Similar', 'Partially Equivalent', 'Not Equivalent', 'Insufficient Documentation'].map((x) => <option key={x}>{x}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="pe-note">Equivalence note</label><input id="pe-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="primary" onClick={save}>Save metadata</button>
        <hr />
        <b>Add technical explanation</b>
        <div className="row"><select value={ex.level} onChange={(e) => setEx({ ...ex, level: e.target.value })} aria-label="Level">{['short', 'detailed', 'advanced', 'manufacturer'].map((x) => <option key={x}>{x}</option>)}</select>
          <select value={ex.language} onChange={(e) => setEx({ ...ex, language: e.target.value })} aria-label="Language"><option value="en">English</option></select>
          <label style={{ display: 'inline-flex', gap: 5, margin: 0 }}><input type="checkbox" checked={ex.cite} onChange={(e) => setEx({ ...ex, cite: e.target.checked })} /> cites this record’s first source</label></div>
        <textarea value={ex.body} onChange={(e) => setEx({ ...ex, body: e.target.value })} aria-label="Explanation text" placeholder="Only statements supported by the manual. Without a citation it is stored as Unverified." />
        <button disabled={!ex.body.trim()} onClick={addExplanation}>Add explanation</button>
        {msg && (msg instanceof Error ? <ErrorBox e={msg} /> : <div className="ok-box" role="status">{msg.ok}</div>)}
      </div>
    </details>
  );
}
