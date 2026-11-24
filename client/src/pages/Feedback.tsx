import { useState } from 'react';
import { get, patch, fmtDate } from '../lib/api';
import { Crumbs, ErrorBox, Loading, Modal, Pager, useAsync } from '../components/ui';

const STATUS_LABEL: Record<string, string> = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const imgUrl = (uploadId: number, thumb = false) => `/api/feedback/images/${uploadId}${thumb ? '?thumb=1' : ''}`;

/** Super Admin: requests and complaints sent by users. */
export function FeedbackAdmin() {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useAsync(() => get('/feedback', { status, kind, page, limit: 20 }), [status, kind, page]);
  const [big, setBig] = useState<number | null>(null);
  const counts: Record<string, number> = Object.fromEntries((data?.counts ?? []).map((c: any) => [c.status, c.n]));

  return (
    <div className="page">
      <Crumbs items={[{ label: 'Admin' }, { label: 'User Requests' }]} />
      <h1>User Requests &amp; Complaints</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}{counts[k] ? ` (${counts[k]})` : ''}</option>)}
        </select>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Type filter">
          <option value="">Requests &amp; complaints</option>
          <option value="request">Requests</option>
          <option value="complaint">Complaints</option>
        </select>
      </div>
      <ErrorBox e={error} />
      {!data && !error && <Loading />}
      {data && data.rows.length === 0 && <div className="empty">No messages.</div>}
      <div className="stack">
        {data?.rows.map((r: any) => <FeedbackCard key={r.id} r={r} onSaved={reload} onImage={setBig} />)}
      </div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      {big !== null && (
        <Modal title="Image" onClose={() => setBig(null)} wide>
          <img src={imgUrl(big)} alt="Attached by the user" style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
        </Modal>
      )}
    </div>
  );
}

function FeedbackCard({ r, onSaved, onImage }: { r: any; onSaved: () => void; onImage: (id: number) => void }) {
  const [note, setNote] = useState(r.admin_note ?? '');
  const [err, setErr] = useState<any>(null);
  const save = async (body: object) => {
    setErr(null);
    try { await patch(`/feedback/${r.id}`, body); onSaved(); } catch (e) { setErr(e); }
  };
  return (
    <div className={`card fb-card ${r.status}`}>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <div className="row">
          <span className={`badge ${r.kind === 'complaint' ? 'solid' : 'strong'}`}>{r.kind === 'complaint' ? 'Complaint' : 'Request'}</span>
          <b>{r.display_name ?? r.email}</b>
          <span className="small-text muted">{r.email}</span>
        </div>
        <span className="small-text muted">{fmtDate(r.created_at)}</span>
      </div>
      {(r.contact_phone || r.contact_email) && (
        <div className="small-text" style={{ marginTop: 6 }}>
          {r.contact_phone && <>☎ <a href={`tel:${r.contact_phone}`}>{r.contact_phone}</a></>}{r.contact_phone && r.contact_email && ' · '}
          {r.contact_email && <>✉ <a href={`mailto:${r.contact_email}`}>{r.contact_email}</a></>}
        </div>
      )}
      <p style={{ whiteSpace: 'pre-wrap', margin: '10px 0' }}>{r.message}</p>
      {r.images.length > 0 && (
        <div className="thumbs">
          {r.images.map((im: any) => (
            <button key={im.upload_id} type="button" className="thumb" onClick={() => onImage(im.upload_id)} aria-label={`Open image ${im.name ?? ''}`} title={im.name ?? 'Open image'}>
              <img src={imgUrl(im.upload_id, true)} alt={im.name ?? 'attachment'} />
            </button>
          ))}
        </div>
      )}
      <ErrorBox e={err} />
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <select value={r.status} onChange={(e) => save({ status: e.target.value })} aria-label="Status">
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input style={{ flex: 1, minWidth: 220 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / reply (the user can see it)" aria-label="Admin note" maxLength={2000} />
        <button className="small" disabled={note === (r.admin_note ?? '')} onClick={() => save({ admin_note: note })}>Save note</button>
      </div>
    </div>
  );
}
