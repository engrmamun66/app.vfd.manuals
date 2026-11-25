import { get } from '../lib/api';
import { useModels } from '../lib/models';
import { useAsync } from './ui';

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
  if (!rev) return <button className="small" disabled title={selected == null ? 'Select a model to open its original PDF' : 'No original PDF for this model'}><span className="pdf-full">Open original </span>PDF <span aria-hidden="true">↗</span></button>;
  return <a className="btn small" href={pdfUrl(rev.id, `${doc.brand ?? ''} ${doc.models.find((m: any) => m.id === selected)?.name ?? doc.title}`)} target="_blank" rel="noreferrer" title={doc.title}><span className="pdf-full">Open original </span>PDF <span aria-hidden="true">↗</span></a>;
}
