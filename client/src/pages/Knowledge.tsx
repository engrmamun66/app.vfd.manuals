import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api';
import { Crumbs, ErrorBox, Loading, Pager, SearchBox, VerifBadge, useAsync, ModelName } from '../components/ui';
import { ModelTabs } from '../components/ModelTabs';
import { useModels } from '../lib/models';
import { useUiSettings } from '../lib/auth';
import { ManualButton, PageViewer } from '../components/Viewer';
import { StarIcon } from '../components/icons';

/** One-line description shown under each topic page title. */
const KIND_HELP: Record<string, string> = {
  fault: 'Fault codes: meaning, cause and remedy, as printed in the manual.',
  alarm: 'Alarm and warning-display codes of the drive.',
  warning: 'Warnings and cautions printed in the manual.',
  troubleshooting: 'Symptoms and how the manual says to diagnose and fix them.',
  wiring: 'Terminals, terminal blocks, wiring diagrams and wiring cautions.',
  installation: 'Mounting, environment, clearances and installation rules.',
  safety: 'Safety instructions, dangers and protective requirements.',
  specification: 'Ratings, capacities, dimensions and technical specifications.',
  communication: 'RS485 / Modbus and communication-related manual topics.',
  maintenance: 'Inspection, periodic maintenance and parts replacement.',
  note: 'Other notes and explanations from the manual.',
};

export const KIND_LABELS: Record<string, string> = {
  fault: 'Faults',
  alarm: 'Alarms',
  warning: 'Warnings',
  troubleshooting: 'Troubleshooting',
  wiring: 'Wiring & Terminals',
  installation: 'Installation',
  safety: 'Safety',
  specification: 'Specifications',
  communication: 'Communication',
  maintenance: 'Maintenance',
  note: 'Notes',
};

export function ImportanceBadge({ v }: { v?: string | null }) {
  if (!v) return <span className="faint small-text">—</span>;
  const { showStars } = useUiSettings();
  const n = v === 'Important' ? 3 : v === 'Medium' ? 2 : v === 'Optional' ? 1 : 0;
  if (showStars && n) return <span title={`${v}`} aria-label={`${v}: ${n} of 3 stars`} style={{ display: 'inline-flex', gap: 1 }}>{Array.from({ length: n }, (_, i) => <StarIcon key={i} />)}</span>;
  return <span style={{ fontWeight: v === 'Important' || v === 'Medium' ? 700 : 400 }}>{v}</span>;
}

/** Faults, alarms, warnings, troubleshooting, wiring, installation, specs and other non-parameter manual knowledge. */
export function KnowledgePage() {
  const { showVerificationCol } = useUiSettings();
  const { kind = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const { selected } = useModels();
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('page')) || 1;
  const open = Number(sp.get('row')) || null; // the open row lives in the address, so a saved comment re-opens the same row
  const [leaving, setLeaving] = useState<number | null>(null); // row whose details are still sliding shut
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toggle = (id: number) => {
    clearTimeout(leaveTimer.current);
    if (open !== null && open !== id) { setLeaving(open); leaveTimer.current = setTimeout(() => setLeaving(null), 260); }
    else if (open === id) { setLeaving(id); leaveTimer.current = setTimeout(() => setLeaving(null), 260); }
    const n = new URLSearchParams(sp);
    if (open === id) n.delete('row'); else n.set('row', String(id));
    setSp(n, { replace: true });
  };
  const { data, error, loading } = useAsync(() => get('/knowledge', { model: selected, kind, q, page, limit: 50 }), [selected, kind, q, page]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    n.delete('row');
    setSp(n, { replace: true });
  };
  useEffect(() => { if (open && data) document.querySelector('tr.kn-open')?.scrollIntoView({ block: 'center' }); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!KIND_LABELS[kind]) return <Navigate to="/knowledge/fault" replace />;
  const label = KIND_LABELS[kind];
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Knowledge Base', to: '/parameters' }, { label }]} />
      <div style={{ marginBottom: 8 }}><h1 style={{ margin: 0 }}>{label}</h1><p className="muted" style={{ margin: '4px 0 0' }}>{KIND_HELP[kind]}</p></div>
      <ModelTabs />
      <SearchBox icon="filter" placeholder="Filter topics: code, title, cause, remedy…" value={q} onChange={(v) => set('q', v)} style={{ minWidth: 300, marginBottom: 12 }} aria-label="Search topics" />
      <ErrorBox e={error} />
      {loading && !data ? <Loading /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Model</th><th>Code</th><th>Title</th><th>Importance</th>{showVerificationCol && <th>Verification</th>}<th>Source</th><th>Action</th></tr></thead>
            <tbody>
              {data?.rows.map((r: any) => (
                <Fragment key={r.id}>
                  <tr onClick={() => toggle(r.id)} className={`kn-row ${open === r.id ? 'kn-open' : ''}`} aria-expanded={open === r.id}>
                    <td>{r.brand}<div className="small-text muted"><ModelName name={r.model} brand={r.brand} /></div></td>
                    <td className="code">{r.code ?? <span className="faint">—</span>}</td>
                    <td><b>{r.title}</b>{r.description && <div className="small-text muted" style={{ maxWidth: 520 }}>{open === r.id ? r.description : r.description.slice(0, 120) + (r.description.length > 120 ? '…' : '')}</div>}</td>
                    <td><ImportanceBadge v={r.importance} /></td>
                    {showVerificationCol && <td><VerifBadge s={r.verification_status} /></td>}
                    <td className="small-text">{r.pages?.length ? r.pages.map((pg: any, i: number) => <Fragment key={pg.page_index}>{i > 0 && ', '}<Link to={`/library/revision/${pg.revision_id}/page/${pg.page_index}`} onClick={(e) => e.stopPropagation()}>p.{pg.printed_page ?? pg.page_index}</Link></Fragment>) : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}><ManualButton rowId={`k${r.id}`} manual={r.revision_id && r.page_index ? { revision_id: r.revision_id, page: r.page_index, quote: r.evidence_quote } : null} /></td>
                  </tr>
                  {(open === r.id || leaving === r.id) && (
                    <tr className="kn-detail"><td colSpan={showVerificationCol ? 7 : 6}>
                      <Slide open={open === r.id}>
                        {r.cause && <p><b>Cause:</b> {r.cause}</p>}
                        {r.remedy && <p><b>Remedy:</b> {r.remedy}</p>}
                        {r.section && <p className="small-text muted">Section: {r.section}</p>}
                        {r.details && <pre className="mono small-text" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(r.details, null, 2)}</pre>}
                        {!r.cause && !r.remedy && !r.details && !r.description && <span className="muted">No further detail recorded.</span>}
                        <ManualPages pages={r.pages ?? []} />
                      </Slide>
                    </td></tr>)}
                </Fragment>))}
              {!data?.rows.length && <tr><td colSpan={showVerificationCol ? 7 : 6} className="empty">No topics yet for this selection. They appear after a manual's extraction file with knowledge_items is imported.</td></tr>}
            </tbody>
          </table></div>
          {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => set('page', String(p))} />}
        </>)}
    </div>
  );
}

/** The raw manual page images of a topic: one tab per page (primary first), shown with the standard page viewer. */
function ManualPages({ pages }: { pages: { revision_id: number; page_index: number; printed_page: string | null; role: string }[] }) {
  const [sel, setSel] = useState(0);
  if (!pages.length) return <p className="small-text faint">No manual page is linked to this topic.</p>;
  const cur = pages[Math.min(sel, pages.length - 1)];
  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Manual pages">
        <span className="small-text muted">Manual pages ({pages.length}):</span>
        {pages.map((pg, i) => (
          <button key={pg.page_index} role="tab" aria-selected={i === sel} className={i === sel ? 'primary small' : 'small'} onClick={() => setSel(i)} title={pg.role === 'primary' ? 'Main page of this topic' : 'Related / continuation page'}>
            p.{pg.printed_page ?? pg.page_index}{pg.role === 'primary' ? ' ★' : ''}
          </button>
        ))}
      </div>
      <PageViewer overlay revisionId={cur.revision_id} page={cur.page_index} onPage={(p) => setSel((i) => (p > cur.page_index ? Math.min(i + 1, pages.length - 1) : Math.max(i - 1, 0)))} />
    </div>
  );
}

/** Details that slide open and shut (grid-rows 0fr ↔ 1fr), so the change in height is animated. */
function Slide({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(open)); return () => cancelAnimationFrame(id); }, [open]);
  return <div className={`slide ${shown ? 'on' : ''}`}><div className="slide-in">{children}</div></div>;
}
