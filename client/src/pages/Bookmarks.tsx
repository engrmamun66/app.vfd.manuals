import { BookmarkIcon } from '../components/icons';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, del, get, patch, post } from '../lib/api';
import { Crumbs, DeleteIconButton, ErrorBox, Modal, useAsync } from '../components/ui';
import { ListIcon, SavedBookmarksModal } from '../components/SavedLists';
import { chooseDialog, confirmDialog, promptDialog } from '../components/dialogs';

interface Folder { id: number; parent_id: number | null; name: string; display_order: number; bookmark_count: number }

function FolderSelect({ folders, value, onChange, allowRoot = true }: { folders: Folder[]; value: number | null; onChange: (v: number | null) => void; allowRoot?: boolean }) {
  const flat = useMemo(() => {
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) =>
      folders.filter((f) => f.parent_id === parent).sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)).forEach((f) => (out.push({ id: f.id, label: `${'— '.repeat(depth)}${f.name}` }), walk(f.id, depth + 1)));
    walk(null, 0);
    return out;
  }, [folders]);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label="Folder">
      {allowRoot && <option value="">(Top level)</option>}
      {flat.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
    </select>
  );
}

/** "Save Research Bookmark": saves the exact internal URL + context. Can create folders inline. */
export function SaveBookmarkButton({ title, context }: { title?: string; context: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const loc = useLocation();
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <span className="btn-group" role="group" aria-label="Bookmarks">
        <button className="small" onClick={() => setOpen(true)} title={`Save Research Bookmark (${mod} + B)`}><BookmarkIcon /> Save</button>
        <button className="small icon-only" onClick={() => setListOpen(true)} aria-label="Show saved bookmarks" title="Show saved bookmarks"><ListIcon /></button>
      </span>
      {listOpen && <SavedBookmarksModal onClose={() => setListOpen(false)} />}
      {open && <SaveDialog title={title ?? document.querySelector('.page h1')?.textContent?.trim() ?? document.title} url={loc.pathname + loc.search} context={context} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveDialog({ title, url, context, onClose }: { title: string; url: string; context: Record<string, unknown>; onClose: () => void }) {
  const { data: folders, reload } = useAsync<Folder[]>(() => get('/bookmarks/folders'), []);
  const [name, setName] = useState(title);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [folder, setFolder] = useState<number | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [fav, setFav] = useState(false);
  const [err, setErr] = useState<any>(null);
  const addFolder = async () => {
    if (!newFolder.trim()) return;
    try {
      const r = await post('/bookmarks/folders', { name: newFolder.trim(), parent_id: folder });
      setNewFolder('');
      setFolder(r.id); // select the new folder at once, so the next subfolder is created inside it even before the list reloads
      await reload();
    } catch (e) { setErr(e); }
  };
  const save = async (allowDuplicate = false) => {
    try {
      await post('/bookmarks', { name, notes, research_url: url, folder_id: folder, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), favorite: fav, context, allowDuplicate });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (await confirmDialog('An identical bookmark already exists. Save another anyway?'))) return save(true);
      setErr(e);
    }
  };
  return (
    <Modal title="Save Research Bookmark" onClose={onClose}>
      {(<>
        <div className="field"><label htmlFor="bm-name">Name</label><input id="bm-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="bm-notes">Personal notes</label><textarea id="bm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="field"><label>Folder</label><div className="row">{folders && <FolderSelect folders={folders} value={folder} onChange={setFolder} />}</div>
          <div className="row" style={{ marginTop: 6 }}><input placeholder="New subfolder name here…" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} /><button className="small" onClick={addFolder}>+ Create folder</button></div></div>
        <div className="field"><label htmlFor="bm-tags">Tags (comma separated)</label><input id="bm-tags" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} /> Favorite</label>
        <ErrorBox e={err} />
        <div className="row" style={{ marginTop: 8 }}><button className="primary" disabled={!name.trim()} onClick={() => save()}>Save</button><button onClick={onClose}>Cancel</button></div>
      </>)}
    </Modal>
  );
}

// ============ Research Bookmarks explorer ============
export function BookmarksPage() {
  const nav = useNavigate();
  const { data: folders, reload: reloadFolders } = useAsync<Folder[]>(() => get('/bookmarks/folders'), []);
  const [sel, setSel] = useState<number | 'root' | 'all' | 'fav'>('all');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('order');
  const [err, setErr] = useState<any>(null);
  const [drop, setDrop] = useState<number | 'root' | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const query: any = { q, sort };
  if (sel === 'root') query.folder = 'root';
  else if (sel === 'fav') query.favorite = '1';
  else if (sel !== 'all') query.folder = sel;
  const { data: marks, reload } = useAsync<any[]>(() => get('/bookmarks', query), [sel, q, sort]);
  const { data: recent } = useAsync(() => get('/bookmarks/recent-opened'), []);
  const all = () => { reload(); reloadFolders(); };
  const run = async (fn: () => Promise<unknown>) => { try { setErr(null); await fn(); all(); } catch (e) { setErr(e); } };

  const crumbs = useMemo(() => {
    if (typeof sel !== 'number' || !folders) return [];
    const out: Folder[] = [];
    let cur = folders.find((f) => f.id === sel);
    while (cur) { out.unshift(cur); cur = folders.find((f) => f.id === cur!.parent_id); }
    return out;
  }, [sel, folders]);

  const renderTree = (parent: number | null): any => {
    const kids = (folders ?? []).filter((f) => f.parent_id === parent).sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    if (!kids.length) return null;
    return (
      <ul>{kids.map((f) => {
        const has = (folders ?? []).some((c) => c.parent_id === f.id);
        const isOpen = open.has(f.id);
        return (
          <li key={f.id}>
            <div className={`node ${sel === f.id ? 'sel' : ''} ${drop === f.id ? 'dropping' : ''}`} draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'folder', id: f.id }))}
              onDragOver={(e) => { e.preventDefault(); setDrop(f.id); }} onDragLeave={() => setDrop(null)}
              onDrop={(e) => { e.preventDefault(); setDrop(null); handleDrop(e, f.id); }}
              onClick={() => setSel(f.id)}>
              <span className="tw" onClick={(e) => { e.stopPropagation(); const n = new Set(open); isOpen ? n.delete(f.id) : n.add(f.id); setOpen(n); }}>{has ? (isOpen ? '▾' : '▸') : '·'}</span>
              <span style={{ flex: 1 }}>{f.name}</span><span className="faint small-text">{f.bookmark_count}</span>
            </div>
            {isOpen && renderTree(f.id)}
          </li>);
      })}</ul>
    );
  };
  const handleDrop = (e: React.DragEvent, target: number | null) => {
    try {
      const d = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (d.t === 'folder') run(() => patch(`/bookmarks/folders/${d.id}`, { parent_id: target }));
      else if (d.t === 'bookmark') run(() => patch(`/bookmarks/${d.id}`, { folder_id: target }));
    } catch { /* ignore */ }
  };

  const delFolder = async (f: Folder) => {
    const nonEmpty = f.bookmark_count > 0 || (folders ?? []).some((c) => c.parent_id === f.id);
    if (!nonEmpty) { if ((await confirmDialog(`Delete empty folder “${f.name}”?`, { danger: true }))) run(() => del(`/bookmarks/folders/${f.id}`)); return; }
    const choice = await chooseDialog(`“${f.name}” is not empty. Its bookmarks and subfolders will NOT be deleted. Where should they go?`, [{ label: 'Move to the parent folder', value: 'parent' }, { label: 'Move to the top level', value: 'root' }], { title: 'Delete folder' });
    if (choice === 'parent' || choice === 'root') run(async () => { await del(`/bookmarks/folders/${f.id}`, { moveTo: choice }); setSel('all'); });
  };

  return (
    <div className="page">
      <Crumbs items={[{ label: 'Home', to: '/' }, { label: 'Research Bookmarks' }]} />
      <h1>Research Bookmarks</h1>
      <ErrorBox e={err} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 18, alignItems: 'start' }}>
        <aside className="card">
          <div className="tree">
            <ul><li><div className={`node ${sel === 'all' ? 'sel' : ''}`} onClick={() => setSel('all')}>All bookmarks</div></li>
              <li><div className={`node ${sel === 'fav' ? 'sel' : ''}`} onClick={() => setSel('fav')}>★ Favorites</div></li>
              <li><div className={`node ${sel === 'root' ? 'sel' : ''} ${drop === 'root' ? 'dropping' : ''}`} onClick={() => setSel('root')} onDragOver={(e) => { e.preventDefault(); setDrop('root'); }} onDragLeave={() => setDrop(null)} onDrop={(e) => { e.preventDefault(); setDrop(null); handleDrop(e, null); }}>Top level</div></li></ul>
            <hr />{renderTree(null)}
            {!folders?.length && <p className="muted small-text">No folders yet.</p>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="small" onClick={async () => { const n = await promptDialog('New folder name', { title: 'New folder', confirmLabel: 'Create' }); if (n?.trim()) run(() => post('/bookmarks/folders', { name: n.trim(), parent_id: typeof sel === 'number' ? sel : null })); }}>+ {typeof sel === 'number' ? 'Subfolder' : 'Folder'}</button>
            {typeof sel === 'number' && folders && (() => { const f = folders.find((x) => x.id === sel)!; return f ? (<>
              <button className="small" onClick={async () => { const n = await promptDialog('Rename folder', { title: 'Rename folder', defaultValue: f.name, confirmLabel: 'Rename' }); if (n?.trim()) run(() => patch(`/bookmarks/folders/${f.id}`, { name: n.trim() })); }}>Rename</button>
              <button className="small" onClick={() => run(() => patch(`/bookmarks/folders/${f.id}`, { display_order: f.display_order - 15 }))} title="Move up among siblings">↑</button>
              <button className="small" onClick={() => run(() => patch(`/bookmarks/folders/${f.id}`, { display_order: f.display_order + 15 }))} title="Move down among siblings">↓</button>
              <DeleteIconButton label="Delete folder" onClick={() => delFolder(f)} /></>) : null; })()}
          </div>
          <p className="small-text muted">Tip: drag folders and bookmarks onto a folder to move them.</p>
          {recent?.length > 0 && <><hr /><b className="small-text">Recently opened</b>{recent.slice(0, 6).map((r: any) => <div key={r.id} className="small-text"><a href={r.research_url} onClick={(e) => { e.preventDefault(); post(`/bookmarks/${r.id}/open`).catch(() => {}); nav(r.research_url); }}>{r.name}</a></div>)}</>}
        </aside>
        <section>
          <div className="row" style={{ marginBottom: 8 }}>
            {crumbs.length > 0 && <span className="small-text muted">Folder: {crumbs.map((c, i) => <span key={c.id}>{i > 0 && ' › '}<a href="#" onClick={(e) => { e.preventDefault(); setSel(c.id); }}>{c.name}</a></span>)}</span>}
            <span style={{ flex: 1 }} /><input placeholder="Search bookmarks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bookmarks" />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="order">Custom order</option><option value="name">Name</option><option value="date">Date saved</option><option value="opened">Recently opened</option></select>
          </div>
          <div className="table-wrap"><table><thead><tr><th></th><th>Name</th><th>Brand / Model</th><th>Topic · depth</th><th>Saved</th><th>Last opened</th><th></th></tr></thead>
            <tbody>{marks?.map((b: any, i: number) => (
              <tr key={b.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'bookmark', id: b.id }))}>
                <td><button className="ghost small" aria-label={b.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => run(() => patch(`/bookmarks/${b.id}`, { favorite: !b.favorite }))}>{b.favorite ? '★' : '☆'}</button></td>
                <td>
                  {b.target_status === 'unavailable' && <span className="badge warn" title="The record this bookmark points to no longer exists. It will not be redirected elsewhere.">Target unavailable</span>}{' '}
                  <a href={b.research_url} onClick={(e) => { e.preventDefault(); post(`/bookmarks/${b.id}/open`).catch(() => {}); nav(b.research_url); }}><b>{b.name}</b></a>
                  {b.tags?.map((t: string) => <span key={t} className="badge dashed" style={{ marginRight: 3 }}>{t}</span>)}
                  <div className="small-text faint mono">{b.research_url}</div>
                </td>
                <td>{b.brand_name ?? '—'}<div className="small-text muted">{b.model_name ?? ''}</div></td>
                <td className="small-text">{b.entity_type ?? '—'} · {b.research_depth ?? '—'}</td>
                <td className="small-text">{new Date(b.created_at).toLocaleDateString()}</td><td className="small-text">{b.last_opened_at ? new Date(b.last_opened_at).toLocaleDateString() : '—'}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="small" onClick={() => setEdit(b)}>Edit</button>
                  <button className="small" onClick={() => navigator.clipboard?.writeText(location.origin + b.research_url)}>Copy URL</button>
                  <button className="small" onClick={() => run(() => post(`/bookmarks/${b.id}/duplicate`))}>Duplicate</button>
                  {sort === 'order' && <><button className="small ghost" aria-label="Move up" disabled={i === 0} onClick={() => { const ids = marks.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; run(() => post('/bookmarks/reorder', { orderedIds: ids })); }}>↑</button><button className="small ghost" aria-label="Move down" disabled={i === marks.length - 1} onClick={() => { const ids = marks.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; run(() => post('/bookmarks/reorder', { orderedIds: ids })); }}>↓</button></>}
                  <DeleteIconButton label="Delete bookmark" onClick={async () => (await confirmDialog(`Delete bookmark “${b.name}”? The technical record is not affected.`, { danger: true, confirmLabel: 'Delete' })) && run(() => del(`/bookmarks/${b.id}`))} /></div></td>
              </tr>))}
              {marks && !marks.length && <tr><td colSpan={7} className="empty">No bookmarks here. Open a parameter or register in the research explorer and click “Save Research Bookmark”.</td></tr>}</tbody></table></div>
        </section>
      </div>
      {edit && <EditBookmark b={edit} folders={folders ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); all(); }} />}
    </div>
  );
}

function EditBookmark({ b, folders, onClose, onSaved }: { b: any; folders: Folder[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(b.name);
  const [notes, setNotes] = useState(b.notes ?? '');
  const [tags, setTags] = useState((b.tags ?? []).join(', '));
  const [folder, setFolder] = useState<number | null>(b.folder_id);
  const [err, setErr] = useState<any>(null);
  return (
    <Modal title="Edit bookmark" onClose={onClose}>
      <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="field"><label>Folder</label><FolderSelect folders={folders} value={folder} onChange={setFolder} /></div>
      <div className="field"><label>Tags</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <ErrorBox e={err} />
      <div className="row"><button className="primary" onClick={async () => { try { await patch(`/bookmarks/${b.id}`, { name, notes, folder_id: folder, tags: tags.split(',').map((t: string) => t.trim()).filter(Boolean) }); onSaved(); } catch (e) { setErr(e); } }}>Save</button><button onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}
