import { useMemo, useState } from 'react';
import { escSnippet } from '../pages/ModbusTools';

interface Row { key: string; to: string; title: string; code?: string | null; meta?: string; tag?: string; snippet?: string; page?: string; match?: number }
interface Group { id: string; title: string; hint: string; rows: Row[]; snippetLines?: number }

const KIND_LABEL: Record<string, string> = { fault: 'Fault', alarm: 'Alarm', warning: 'Warning', troubleshooting: 'Troubleshooting', wiring: 'Wiring', installation: 'Installation', safety: 'Safety', specification: 'Specification', communication: 'Communication', maintenance: 'Maintenance', note: 'Note' };
const INITIAL = 5;

/** The header search results: grouped, each result says what it is, where it is from and why it matched. */
export function SearchResults({ data, scope = [], onGo, onClose }: { data: any; scope?: string[]; onGo: (to: string) => void; onClose: () => void }) {
  const [more, setMore] = useState<Record<string, boolean>>({});
  const groups = useMemo<Group[]>(() => {
    const fns: Group = { id: 'functions', title: 'Common functions', hint: 'Same function across brands', rows: (data.functions ?? []).map((f: any) => ({ key: `f${f.id}`, to: `/function/${f.slug}`, title: f.name, meta: f.category })) };
    const params: Group = { id: 'parameters', title: 'Parameters', hint: 'Function codes and settings', rows: (data.parameters ?? []).map((p: any) => ({ key: `p${p.id}`, to: `/parameter/${p.id}`, code: p.code, title: p.name ?? '', meta: `${p.brand} ${p.model}` })) };
    const regs: Group = { id: 'registers', title: 'Modbus registers', hint: 'Addresses and communication data', rows: (data.registers ?? []).map((r: any) => ({ key: `r${r.id}`, to: `/register/${r.id}`, code: r.original_address, title: r.name ?? '', meta: `${r.brand} ${r.model}` })) };
    const topics: Group = {
      id: 'topics', title: 'Manual topics', hint: 'Faults, warnings, wiring, specifications …', snippetLines: 2,
      rows: (data.topics ?? []).map((t: any) => ({ key: `t${t.id}`, to: `/knowledge/${t.kind}?q=${encodeURIComponent(t.code ?? t.title)}`, code: t.code, title: t.title, tag: KIND_LABEL[t.kind] ?? t.kind, meta: `${t.brand} ${t.model}${t.section ? ` · ${t.section}` : ''}`, snippet: t.snippet })),
    };
    const models: Group = { id: 'models', title: 'Models', hint: 'Drives', rows: (data.models ?? []).map((m: any) => ({ key: `m${m.id}`, to: `/model/${m.id}`, title: m.name, meta: m.brand })) };
    const pages: Group = {
      id: 'pages', title: 'Manual text', hint: 'Pages of the manuals that contain your words', snippetLines: 3,
      rows: (data.pages ?? []).map((p: any) => ({ key: `pg${p.page_id}`, to: `/library/revision/${p.revision_id}/page/${p.page_index}?tab=text`, title: p.document_title, page: `Page ${p.printed_page || p.page_index}`, match: p.match, snippet: p.snippet })),
    };
    // pasted sentences are most likely from a manual page; short words and codes are most likely a parameter
    const words = String(data.q ?? '').trim().split(/\s+/).length;
    const order = words >= 3 ? [topics, pages, params, regs, fns, models] : [params, regs, fns, topics, models, pages];
    return order.filter((g) => g.rows.length);
  }, [data]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const jump = (id: string) => document.getElementById(`sr-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  return (
    <div className="sr" role="region" aria-label="Search results">
      <div className="sr-head">
        <div className="sr-title"><b>{total ? `${total} result${total === 1 ? '' : 's'}` : 'No results'}</b> <span className="muted">for “{data.q}”{scope.length > 0 && <> in <b>{scope.map((x) => `@${x}`).join(', ')}</b></>}</span></div>
        <button className="small ghost" onClick={onClose} aria-label="Close search results">Close</button>
      </div>
      {groups.length > 1 && (
        <div className="sr-chips" role="navigation" aria-label="Jump to a result group">
          {groups.map((g) => <button key={g.id} type="button" className="sr-chip" onClick={() => jump(g.id)}>{g.title} <span>{g.rows.length}</span></button>)}
        </div>
      )}
      {!total && <p className="muted sr-empty">Nothing in the database matches. Try fewer or different words, a parameter code (for example F001) or a register address (for example 0x2103).</p>}
      {groups.map((g) => {
        const shown = more[g.id] ? g.rows : g.rows.slice(0, INITIAL);
        return (
          <section key={g.id} id={`sr-${g.id}`} className="sr-group">
            <h3 className="sr-group-title">{g.title} <span className="sr-count">{g.rows.length}</span><span className="sr-hint">{g.hint}</span></h3>
            {shown.map((r) => (
              <a key={r.key} href={r.to} className="sr-row" onClick={(e) => { e.preventDefault(); onGo(r.to); }}>
                <div className="sr-line">
                  {r.code && <span className="sr-code">{r.code}</span>}
                  <span className="sr-main">{r.title}</span>
                  {r.tag && <span className="badge dashed">{r.tag}</span>}
                  {r.page && <span className="badge strong">{r.page}</span>}
                  {r.match !== undefined && (r.match >= 100 ? <span className="sr-match full" title="Every word you typed is on this page">Best match</span> : <span className="sr-match" title="Share of your words found on this page">{r.match}% of your words</span>)}
                </div>
                {r.meta && <div className="sr-meta">{r.meta}</div>}
                {r.snippet && <div className="sr-snippet" style={{ WebkitLineClamp: g.snippetLines ?? 3 }} dangerouslySetInnerHTML={{ __html: escSnippet(r.snippet) }} />}
              </a>
            ))}
            {g.rows.length > INITIAL && (
              <button type="button" className="sr-more" onClick={() => setMore((m) => ({ ...m, [g.id]: !m[g.id] }))}>{more[g.id] ? 'Show fewer' : `Show ${g.rows.length - INITIAL} more`}</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
