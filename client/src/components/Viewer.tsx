import { SplitIcon } from './icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Annotatable, AnnotationScope } from './Annotatable';
import { ErrorBox, Loading, QuoteBadge, Spinner, useAsync } from './ui';

/** Resizable two-pane layout. Ratio/enabled state persisted per user in SQLite via settings. */
export function SplitView({ enabled, left, right, leftTitle, rightTitle }: { enabled: boolean; left: ReactNode; right: ReactNode; leftTitle: string; rightTitle: ReactNode }) {
  const { settings, updateSettings } = useAuth();
  const sv = settings?.split_view ?? { enabled: false, ratio: 0.55, collapsed: null };
  const [ratio, setRatio] = useState(sv.ratio);
  const [drag, setDrag] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<'left' | 'right' | null>(sv.collapsed);
  useEffect(() => setRatio(sv.ratio), [sv.ratio]);
  if (!enabled) return <>{left}</>;
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    setDrag(true);
    const move = (ev: MouseEvent) => {
      const r = wrap.current!.getBoundingClientRect();
      setRatio(Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / r.width)));
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setDrag(false);
      const r = wrap.current!.getBoundingClientRect();
      updateSettings({ split_view: { ...sv, enabled: true, ratio: Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / r.width)) } } as any);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const keyResize = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const nr = Math.min(0.85, Math.max(0.15, ratio + (e.key === 'ArrowLeft' ? -0.03 : 0.03)));
      setRatio(nr);
      updateSettings({ split_view: { ...sv, enabled: true, ratio: nr } } as any);
    }
  };
  const col = (c: 'left' | 'right' | null) => {
    setCollapsed(c);
    updateSettings({ split_view: { ...sv, enabled: true, collapsed: c } } as any);
  };
  const lw = collapsed === 'left' ? '0%' : collapsed === 'right' ? '100%' : `${ratio * 100}%`;
  const rw = collapsed === 'right' ? '0%' : collapsed === 'left' ? '100%' : `${(1 - ratio) * 100}%`;
  return (
    <div className="split" ref={wrap}>
      {collapsed !== 'left' && (
        <section className="pane" style={{ width: `calc(${lw} - 4px)` }} aria-label={leftTitle}>
          <div className="pane-title"><span>{leftTitle}</span><button className="small ghost" onClick={() => col(collapsed === 'right' ? null : 'right')}>{collapsed === 'right' ? 'Restore' : 'Expand'}</button></div>
          <div className="pane-body">{left}</div>
        </section>
      )}
      {!collapsed && <div className={`divider ${drag ? 'drag' : ''}`} role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize panes (arrow keys)" onMouseDown={start} onKeyDown={keyResize} />}
      {collapsed !== 'right' && (
        <section className="pane" style={{ width: `calc(${rw} - 4px)` }} aria-label="Source evidence">
          <div className="pane-title"><span>{rightTitle}</span><button className="small ghost" onClick={() => col(collapsed === 'left' ? null : 'left')}>{collapsed === 'left' ? 'Restore' : 'Expand'}</button></div>
          <div className="pane-body">{right}</div>
        </section>
      )}
    </div>
  );
}

export function SplitToggle() {
  const { settings, updateSettings } = useAuth();
  const sv = settings?.split_view ?? { enabled: false, ratio: 0.55, collapsed: null };
  return (
    <button className="small" aria-pressed={sv.enabled} title={`Split view: ${sv.enabled ? 'ON' : 'OFF'}`} onClick={() => updateSettings({ split_view: { ...sv, enabled: !sv.enabled, collapsed: null } } as any)}>
      <SplitIcon on={sv.enabled} /> Split
    </button>
  );
}

/** Original manufacturer page: image (zoom/pan) and extracted text (annotatable). Never replaces the image with OCR. */
export function PageViewer({ revisionId, page, onPage, quoteMatch, highlightQuote }: { revisionId: number; page: number; onPage?: (p: number) => void; quoteMatch?: string | null; highlightQuote?: string | null }) {
  const loc = useLocation();
  const [tab, setTab] = useState<'image' | 'text'>('image');
  const [zoom, setZoom] = useState(1);
  const { data, error, loading } = useAsync(() => get(`/revisions/${revisionId}/pages/${page}`), [revisionId, page]);
  const [imgErr, setImgErr] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState(''); // the image URL that has finished loading
  useEffect(() => setImgErr(false), [revisionId, page]);
  if (error) return <ErrorBox e={error} />;
  if (loading || !data) return <Loading what="Loading page" />;
  const rev = data.revision;
  const p = data.page;
  const scale = zoom <= 1 ? 1.5 : zoom <= 2 ? 2.5 : 3;
  const imgSrc = `/api/revisions/${revisionId}/pages/${page}/image?scale=${scale}`;
  const imgLoaded = loadedSrc === imgSrc;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div>
          <b>{rev.title}</b>
          <div className="small-text muted">
            {rev.revision_label ? `Rev ${rev.revision_label} · ` : ''}PDF page {page}/{rev.page_count}
            {p.printed_page ? ` · printed page ${p.printed_page}` : ' · printed page not verified'}
            {' · '}text: {p.text_source === 'pdf-text' ? 'PDF text layer' : p.text_source === 'ocr' ? `OCR (${p.ocr_confidence ? Math.round(p.ocr_confidence) + '% conf.' : 'unverified'})` : 'none'}
          </div>
        </div>
        <div className="row">
          {quoteMatch !== undefined && <QuoteBadge s={quoteMatch} />}
          <a className="btn small" href={`/api/revisions/${revisionId}/file#page=${page}`} target="_blank" rel="noreferrer">Open original PDF <span aria-hidden="true">↗</span></a>
          {!loc.pathname.startsWith('/library/revision/') && <Link className="btn small" to={`/library/revision/${revisionId}/page/${page}`}>Full viewer</Link>}
        </div>
      </div>
      {highlightQuote && (
        <div className="evidence-quote" title="Text recorded as evidence for this value"><span className="faint">Evidence quote: </span>{highlightQuote}</div>
      )}
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="small" disabled={page <= 1} onClick={() => onPage?.(page - 1)}>← Prev page</button>
        <button className="small" disabled={page >= rev.page_count} onClick={() => onPage?.(page + 1)}>Next page →</button>
        <span className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={`tab ${tab === 'image' ? 'active' : ''}`} onClick={() => setTab('image')}>Page image</button>
          <button className={`tab ${tab === 'text' ? 'active' : ''}`} onClick={() => setTab('text')}>Extracted text</button>
        </span>
        {tab === 'image' && (
          <>
            <button className="small" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out">−</button>
            <span className="small-text">{Math.round(zoom * 100)}%</span>
            <button className="small" onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Zoom in">+</button>
            <button className="small ghost" onClick={() => setZoom(1)}>Reset</button>
          </>
        )}
      </div>
      {tab === 'image' ? (
        imgErr ? (
          <div className="err">The page image could not be rendered. The original file may be missing — check the Documentation Library.</div>
        ) : (
          <div className="page-img-wrap" aria-busy={!imgLoaded} style={!imgLoaded ? { minHeight: 'calc(100vh - 220px)', position: 'relative' } : undefined}>
            {!imgLoaded && <Spinner label="Loading page image…" overlay />}
            <img key={imgSrc} src={imgSrc} alt={`Manufacturer manual page ${page}`} style={{ width: `${zoom * 100}%`, minWidth: '50%', opacity: imgLoaded ? 1 : 0, transition: 'opacity .2s ease' }} onLoad={() => setLoadedSrc(imgSrc)} onError={() => setImgErr(true)} ref={(el) => { if (el?.complete && el.naturalWidth > 0 && loadedSrc !== imgSrc) setLoadedSrc(imgSrc); }} />
          </div>
        )
      ) : p.text ? (
        <AnnotationScope researchUrl={`/library/revision/${revisionId}/page/${page}`} context={{ entityType: 'document_page', entityId: p.id, documentId: rev.document_id, revisionId, pageId: p.id }}>
          {p.text_source === 'ocr' && <div className="ok-box small-text">OCR text — may contain recognition errors. Verify against the page image.</div>}
          <Annotatable as="pre" contentKey={`docpage:${revisionId}:${page}`} text={p.text} className="mono" />
        </AnnotationScope>
      ) : (
        <div className="empty">No extractable text for this page. Use the page image; selection-based annotation is unavailable without a text layer.</div>
      )}
      {data.references?.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary>{data.references.length} record(s) cite this page</summary>
          {data.references.map((r: any) => (
            <div key={r.id} className="small-text" style={{ margin: '4px 0' }}>
              <Link to={`/${r.entity_type === 'parameter' ? 'parameter' : 'register'}/${r.entity_id}`}>{r.entity_type} #{r.entity_id}</Link> · {r.role} {r.section ? `· ${r.section}` : ''}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
