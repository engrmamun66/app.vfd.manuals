import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { get } from '../lib/api';
import { useModels } from '../lib/models';
import { useAnimatedClose, useAsync } from './ui';

/** `/api/revisions/:id/file?name=Brand-Model` — the name only makes the URL self-explanatory; the server ignores it. */
export const pdfUrl = (revisionId: number, label: string, page?: number) =>
  `/api/revisions/${revisionId}/file?name=${encodeURIComponent(label.trim().replace(/\s+/g, '-'))}${page ? `#page=${page}` : ''}`;

/** Opens the selected model's original manual PDF in a new tab. Disabled when "All" is selected or no manual exists. */
export function OriginalPdfButton({ modelId }: { modelId?: number } = {}) {
  const { selected: sel } = useModels();
  const selected = modelId ?? sel;
  const { data } = useAsync(() => get('/documents'), []);
  const doc = selected == null ? null : data?.find((d: any) => d.models.some((m: any) => m.id === selected) && d.revisions.length);
  const rev = doc?.revisions[doc.revisions.length - 1];
  if (!rev) return <button className="small" disabled title={selected == null ? 'Select a model to open its original PDF' : 'No original PDF for this model'}>Open PDF <span aria-hidden="true">↗</span></button>;
  return <a className="btn small" href={pdfUrl(rev.id, `${doc.brand ?? ''} ${doc.models.find((m: any) => m.id === selected)?.name ?? doc.title}`)} target="_blank" rel="noreferrer" title={`Open original PDF — ${doc.title}`}>Open PDF <span aria-hidden="true">↗</span></a>;
}

/**
 * Button group: the left part opens the manual at this exact page in a full-screen viewer (modal);
 * the right icon opens the original PDF in a new tab, as before.
 */
export function PdfSplitButton({ revisionId, label, page }: { revisionId: number; label: string; page: number }) {
  const [open, setOpen] = useState(false);
  const url = pdfUrl(revisionId, label, page);
  return (
    <>
      <span className="btn-group" role="group" aria-label="Original PDF">
        <button type="button" className="small" onClick={() => setOpen(true)} title={`View the manual at page ${page} here`}>Open original PDF</button>
        <a className="btn small" href={url} target="_blank" rel="noreferrer" aria-label="Open original PDF in a new tab" title="Open in a new tab"><span aria-hidden="true">↗</span></a>
      </span>
      {open && <PdfModal url={url} title={`${label} — page ${page}`} onClose={() => setOpen(false)} />}
    </>
  );
}

function PdfModal({ url, title, onClose: onClosed }: { url: string; title: string; onClose: () => void }) {
  const [closing, onClose] = useAnimatedClose(onClosed);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return createPortal(
    <div className={`fs-modal ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label="Original manual">
      <div className="fs-head">
        <h2 style={{ fontSize: '1.05rem' }}>{title}</h2>
        <span className="row">
          <a className="btn small" href={url} target="_blank" rel="noreferrer">New tab <span aria-hidden="true">↗</span></a>
          <button onClick={onClose} aria-label="Close viewer" autoFocus>✕ Close</button>
        </span>
      </div>
      <iframe title={title} src={url} style={{ flex: 1, width: '100%', border: 0 }} />
    </div>,
    document.body,
  );
}
