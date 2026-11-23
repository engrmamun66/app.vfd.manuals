import { get } from '../lib/api';
import { useModels } from '../lib/models';
import { useAsync } from './ui';

/** Opens the selected model's original manual PDF in a new tab. Disabled when "All" is selected or no manual exists. */
export function OriginalPdfButton() {
  const { selected } = useModels();
  const { data } = useAsync(() => get('/documents'), []);
  const doc = selected == null ? null : data?.find((d: any) => d.models.some((m: any) => m.id === selected) && d.revisions.length);
  const rev = doc?.revisions[doc.revisions.length - 1];
  if (!rev) return <button className="small" disabled title={selected == null ? 'Select a model to open its original PDF' : 'No original PDF for this model'}>Open original PDF <span aria-hidden="true">↗</span></button>;
  return <a className="btn small" href={`/api/revisions/${rev.id}/file`} target="_blank" rel="noreferrer" title={doc.title}>Open original PDF <span aria-hidden="true">↗</span></a>;
}
