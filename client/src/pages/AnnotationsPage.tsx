import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, get, patch, post } from '../lib/api';
import { Crumbs, ErrorBox, Loading, useAsync } from '../components/ui';
import { COLORS, type Ann } from '../components/Annotatable';
import { confirmDialog } from '../components/dialogs';

export function AnnotationsPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'mine' | 'public' | 'trash'>('mine');
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState<any>(null);
  const { data, loading, reload } = useAsync<Ann[]>(() => (tab === 'public' ? get('/annotations/public') : get('/annotations/mine', { ...f, status: tab === 'trash' ? 'trashed' : undefined })), [tab, JSON.stringify(f)]);
  const run = async (fn: () => Promise<unknown>) => { try { setErr(null); await fn(); reload(); } catch (e) { setErr(e); } };
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Home', to: '/' }, { label: 'My Annotations' }]} />
      <h1>My Annotations</h1>
      <div className="tabs">
        <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>My annotations</button>
        <button className={`tab ${tab === 'public' ? 'active' : ''}`} onClick={() => setTab('public')}>Public (other users)</button>
        <button className={`tab ${tab === 'trash' ? 'active' : ''}`} onClick={() => setTab('trash')}>Trash</button>
      </div>
      {tab !== 'public' && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Search selected text…" value={f.text ?? ''} onChange={(e) => set('text', e.target.value)} aria-label="Search selected text" />
          <input placeholder="Search comment…" value={f.comment ?? ''} onChange={(e) => set('comment', e.target.value)} aria-label="Search comment" />
          <select value={f.color ?? ''} onChange={(e) => set('color', e.target.value)} aria-label="Color"><option value="">Any color</option>{COLORS.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={f.visibility ?? ''} onChange={(e) => set('visibility', e.target.value)} aria-label="Visibility"><option value="">Public + private</option><option value="private">Private</option><option value="public">Public</option></select>
          <select value={f.entityType ?? ''} onChange={(e) => set('entityType', e.target.value)} aria-label="Topic"><option value="">Any topic</option><option value="parameter">Parameter</option><option value="modbus_register">Modbus register</option><option value="document_page">Document page</option></select>
          <label style={{ display: 'inline-flex', gap: 5, margin: 0 }}><input type="checkbox" checked={f.reattach === '1'} onChange={(e) => set('reattach', e.target.checked ? '1' : '')} /> Needs reattachment</label>
        </div>
      )}
      <ErrorBox e={err} />
      {loading && !data ? <Loading /> : (
        <div className="stack">
          {data?.map((a) => (
            <div className="card" key={a.id}>
              <div className="row between">
                <span>{a.color && <span className={`swatch c-${a.color}`} />} <b>{a.isOwn ? 'You' : a.author}</b> <span className="badge dashed">{a.visibility}</span> {a.status !== 'Active' && <span className="badge warn">{a.status}</span>}{a.anchor?.brand && <span className="small-text muted"> · {a.anchor.brand} {a.anchor.model}</span>}</span>
                <span className="small-text faint">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <div className="evidence-quote">{a.anchor?.selectedText}</div>
              {a.comment ? <p style={{ whiteSpace: 'pre-wrap' }}>{a.comment}</p> : <p className="muted">(highlight only)</p>}
              {(Array.isArray(a.links) ? a.links : []).map((l, i) => <div key={i}><a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.text || l.url}</a></div>)}
              {Array.isArray(a.attachments) && a.attachments.length > 0 && <div className="att-grid">{a.attachments.map((t) => <a key={t.id} href={`/api/annotations/attachments/${t.id}/file`} target="_blank" rel="noreferrer"><img src={`/api/annotations/attachments/${t.id}/file?thumb=1`} alt={t.alt_text || 'attached image'} /></a>)}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                {a.researchUrl && tab !== 'trash' && <button className="small" onClick={() => nav(a.researchUrl!)}>Open research location</button>}
                {a.isOwn && tab === 'mine' && (<>
                  <button className="small" onClick={() => run(() => patch(`/annotations/${a.id}`, { favorite: !a.favorite }))}>{a.favorite ? '★ Favorite' : '☆ Favorite'}</button>
                  <button className="small" onClick={() => run(() => patch(`/annotations/${a.id}`, { visibility: a.visibility === 'private' ? 'public' : 'private' }))}>Make {a.visibility === 'private' ? 'public' : 'private'}</button>
                  {a.color && a.comment && <button className="small" onClick={() => run(() => patch(`/annotations/${a.id}`, { color: null }))}>Remove highlight</button>}
                  <button className="small danger" onClick={async () => (await confirmDialog('Move this annotation to Trash? You can restore it later.', { danger: true })) && run(() => post(`/annotations/${a.id}/trash`))}>Delete</button></>)}
                {a.isOwn && tab === 'trash' && (<>
                  <button className="small" onClick={() => run(() => post(`/annotations/${a.id}/restore`))}>Restore</button>
                  <button className="small danger" onClick={async () => (await confirmDialog('PERMANENTLY delete this annotation and its attached images? This cannot be undone. Manufacturer documents are not affected.', { danger: true })) && run(() => del(`/annotations/${a.id}`, { confirm: 'PERMANENT' }))}>Permanently delete</button></>)}
              </div>
            </div>))}
          {data && !data.length && <div className="empty">{tab === 'trash' ? 'Trash is empty.' : tab === 'public' ? 'No public annotations from other users.' : 'No annotations. Select text on a research page to add a comment or highlight.'}</div>}
        </div>)}
      <p className="small-text muted" style={{ marginTop: 16 }}>Related: <Link to="/bookmarks">Research Bookmarks</Link></p>
    </div>
  );
}
