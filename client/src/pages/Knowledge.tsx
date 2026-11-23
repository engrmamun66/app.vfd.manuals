import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api';
import { Crumbs, ErrorBox, Loading, Pager, VerifBadge, useAsync } from '../components/ui';
import { ModelTabs } from '../components/ModelTabs';
import { useModels } from '../lib/models';

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
  return <span className={`badge ${v === 'Important' ? 'strong' : v === 'Medium' ? 'solid' : 'dashed'}`}>{v}</span>;
}

/** Faults, alarms, warnings, troubleshooting, wiring, installation, specs and other non-parameter manual knowledge. */
export function KnowledgePage() {
  const [sp, setSp] = useSearchParams();
  const { selected } = useModels();
  const kind = sp.get('kind') ?? '';
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('page')) || 1;
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading } = useAsync(() => get('/knowledge', { model: selected, kind, q, page, limit: 50 }), [selected, kind, q, page]);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  const counts: Record<string, number> = Object.fromEntries((data?.kinds ?? []).map((k: any) => [k.kind, k.n]));
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Knowledge Base', to: '/parameters' }, { label: 'Troubleshooting & Manual Topics' }]} />
      <h1>Troubleshooting & Manual Topics</h1>
      <ModelTabs />
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }} role="tablist" aria-label="Topic">
        <button role="tab" aria-selected={!kind} className={!kind ? 'primary small' : 'small'} onClick={() => set('kind', '')}>All ({totalAll})</button>
        {Object.entries(KIND_LABELS).filter(([k]) => counts[k]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'primary small' : 'small'} onClick={() => set('kind', k)}>{l} ({counts[k]})</button>
        ))}
      </div>
      <input placeholder="Search code, title, cause, remedy…" value={q} onChange={(e) => set('q', e.target.value)} style={{ minWidth: 320, marginBottom: 12 }} aria-label="Search topics" />
      <ErrorBox e={error} />
      {loading && !data ? <Loading /> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Model</th><th>Type</th><th>Code</th><th>Title</th><th>Importance</th><th>Verification</th><th>Source</th></tr></thead>
            <tbody>
              {data?.rows.map((r: any) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                    <td>{r.brand}<div className="small-text muted">{r.model}</div></td>
                    <td>{KIND_LABELS[r.kind] ?? r.kind}</td>
                    <td className="code">{r.code ?? <span className="faint">—</span>}</td>
                    <td><b>{r.title}</b>{r.description && <div className="small-text muted" style={{ maxWidth: 520 }}>{open === r.id ? r.description : r.description.slice(0, 120) + (r.description.length > 120 ? '…' : '')}</div>}</td>
                    <td><ImportanceBadge v={r.importance} /></td>
                    <td><VerifBadge s={r.verification_status} /></td>
                    <td className="small-text">{r.revision_id && r.page_index ? <Link to={`/library/revision/${r.revision_id}/page/${r.page_index}`} onClick={(e) => e.stopPropagation()}>p.{r.printed_page ?? r.page_index}</Link> : '—'}</td>
                  </tr>
                  {open === r.id && (
                    <tr><td colSpan={7} style={{ background: 'var(--bg-alt)' }}>
                      {r.cause && <p><b>Cause:</b> {r.cause}</p>}
                      {r.remedy && <p><b>Remedy:</b> {r.remedy}</p>}
                      {r.section && <p className="small-text muted">Section: {r.section}</p>}
                      {r.details && <pre className="mono small-text" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(r.details, null, 2)}</pre>}
                      {!r.cause && !r.remedy && !r.details && !r.description && <span className="muted">No further detail recorded.</span>}
                    </td></tr>)}
                </Fragment>))}
              {!data?.rows.length && <tr><td colSpan={7} className="empty">No topics yet for this selection. They appear after a manual's extraction file with knowledge_items is imported.</td></tr>}
            </tbody>
          </table></div>
          {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => set('page', String(p))} />}
        </>)}
    </div>
  );
}
