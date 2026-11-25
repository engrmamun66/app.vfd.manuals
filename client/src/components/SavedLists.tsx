import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { get, fmtDate } from '../lib/api';
import { Drawer, ErrorBox, Loading, SearchBox, useAsync } from './ui';
import { annUrl, type Ann } from './Annotatable';

/** Small "list" icon used as the right half of the Save / Notes button groups. */
export function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" />
    </svg>
  );
}

/** The user's saved research bookmarks in a modal. */
export function SavedBookmarksModal({ onClose }: { onClose: () => void }) {
  const loc = useLocation();
  const [q, setQ] = useState('');
  const { data, error } = useAsync<any[]>(() => get('/bookmarks', { sort: 'date', limit: 300 }), []);
  const here = loc.pathname + loc.search;
  const rows = (data ?? []).filter((b) => !q.trim() || `${b.name} ${b.notes ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Drawer title="Saved bookmarks" onClose={onClose}>
      <div className="stack" style={{ marginBottom: 8 }}>
        <SearchBox icon="filter" placeholder="Filter saved bookmarks…" value={q} onChange={setQ} aria-label="Filter saved bookmarks" style={{ flex: 1, minWidth: 0 }} />
        <Link to="/bookmarks" onClick={onClose} className="small-text">Open Research Bookmarks page →</Link>
      </div>
      <ErrorBox e={error} />
      {!data && !error && <Loading />}
      {data && rows.length === 0 && <div className="empty">{data.length ? 'No bookmark matches.' : 'You have not saved any bookmark yet.'}</div>}
      <ul className="saved-list">
        {rows.map((b) => (
          <li key={b.id} className={b.research_url === here ? 'here' : ''}>
            <Link to={b.research_url} onClick={onClose}><b>{b.name}</b></Link>
            {b.research_url === here && <span className="badge strong" style={{ marginLeft: 6 }}>this page</span>}
            {b.favorite ? <span title="Favorite"> ★</span> : null}
            <div className="small-text muted">{[b.brand_name, b.model_name].filter(Boolean).join(' ')} {b.notes ? `· ${String(b.notes).slice(0, 120)}` : ''}</div>
            <div className="small-text faint">{fmtDate(b.created_at)}</div>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

/** The user's notes (comments and highlights): this page first, or everything. */
export function NotesListModal({ onClose }: { onClose: () => void }) {
  const loc = useLocation();
  const [all, setAll] = useState(false);
  const { data, error } = useAsync<Ann[]>(() => get('/annotations/mine'), []);
  const path = loc.pathname;
  const rows = (data ?? []).filter((a) => all || (a.researchUrl ?? '').split('?')[0] === path || (a.researchUrl ?? '').startsWith(path + '/'));
  return (
    <Drawer title="My notes" onClose={onClose}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          <button className={`tab ${!all ? 'active' : ''}`} onClick={() => setAll(false)}>This page</button>
          <button className={`tab ${all ? 'active' : ''}`} onClick={() => setAll(true)}>All pages</button>
        </div>
        <Link to="/annotations" onClick={onClose} className="small-text">Open My Annotations page →</Link>
      </div>
      <ErrorBox e={error} />
      {!data && !error && <Loading />}
      {data && rows.length === 0 && <div className="empty">{all ? 'You have no notes yet. Select any text and choose “Add Comment” or “Highlight”.' : 'No notes on this page yet.'}</div>}
      <ul className="saved-list">
        {rows.map((a) => (
          <li key={a.id}>
            <div className="row between">
              <span>{a.color && <span className={`swatch c-${a.color}`} />} <span className="badge dashed">{a.visibility}</span></span>
              <span className="small-text faint">{fmtDate(a.createdAt)}</span>
            </div>
            <blockquote className="small-text" style={{ margin: '6px 0' }}>“{a.anchor.selectedText.slice(0, 200)}”</blockquote>
            {a.comment && <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{a.comment}</p>}
            {annUrl(a) && <Link to={annUrl(a)!} onClick={onClose} className="small-text">Go to this note →</Link>}
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
