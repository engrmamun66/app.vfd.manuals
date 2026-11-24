import { EyeIcon } from './icons';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, del, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal, ErrorBox } from './ui';
import { ListIcon, NotesListModal } from './SavedLists';
import { confirmDialog } from './dialogs';

export const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'] as const;

export function hashText(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}:${s.length}`;
}

export interface Ann {
  id: number;
  anchorId: number;
  isOwn: boolean;
  author: string;
  comment: string | null;
  links: { url: string; text: string | null }[];
  color: string | null;
  visibility: 'private' | 'public';
  status: string;
  favorite: boolean;
  researchUrl: string | null;
  createdAt: string;
  attachments: { id: number; alt_text: string | null; has_thumb: number; width: number | null; height: number | null }[];
  anchor: { contentKey: string; selectedText: string; start: number | null; end: number | null; prefix: string | null; suffix: string | null; contentHash: string | null; brand?: string | null; model?: string | null };
}

/** Per-page context: shared by all <Annotatable> blocks so the research URL & entity ids are saved with every annotation. */
interface PageCtx {
  researchUrl: string;
  context: Record<string, unknown>;
  version: number;
  bump(): void;
}
const Ctx = createContext<PageCtx>({ researchUrl: '', context: {}, version: 0, bump() {} });
export function AnnotationScope({ researchUrl, context, children }: { researchUrl: string; context: Record<string, unknown>; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const v = useMemo(() => ({ researchUrl, context, version, bump: () => setVersion((x) => x + 1) }), [researchUrl, JSON.stringify(context), version]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** Locates an annotation inside the current text using offsets, then exact text + prefix/suffix. Never guesses. */
export function locate(text: string, a: Ann): { start: number; end: number } | null {
  const sel = a.anchor.selectedText;
  const { start, end, prefix, suffix } = a.anchor;
  if (start !== null && end !== null && text.slice(start, end) === sel) return { start, end };
  const hits: number[] = [];
  let i = text.indexOf(sel);
  while (i >= 0) {
    hits.push(i);
    i = text.indexOf(sel, i + 1);
  }
  if (!hits.length) return null;
  const score = (p: number) => {
    let s = 0;
    if (prefix && text.slice(Math.max(0, p - prefix.length), p).endsWith(prefix.slice(-Math.min(prefix.length, 24)))) s++;
    if (suffix && text.slice(p + sel.length, p + sel.length + suffix.length).startsWith(suffix.slice(0, Math.min(suffix.length, 24)))) s++;
    return s;
  };
  if (hits.length === 1) return prefix || suffix ? (score(hits[0]) > 0 ? { start: hits[0], end: hits[0] + sel.length } : null) : { start: hits[0], end: hits[0] + sel.length };
  const ranked = hits.map((p) => ({ p, s: score(p) })).sort((x, y) => y.s - x.s);
  if (ranked[0].s > 0 && ranked[0].s > ranked[1].s) return { start: ranked[0].p, end: ranked[0].p + sel.length };
  return null; // ambiguous → requires reattachment, never attach to the wrong occurrence
}

function useVisible(anns: Ann[]) {
  const { settings } = useAuth();
  const d = settings?.annotation_display ?? { showOthersPublic: true, showOwn: true, showHighlightBackgrounds: true };
  return {
    d,
    list: anns.filter((a) => (a.isOwn ? d.showOwn : d.showOthersPublic)),
  };
}

export function Annotatable({ contentKey, text, as = 'div', className, children }: { contentKey: string; text: string; as?: 'div' | 'span' | 'pre'; className?: string; children?: never }) {
  const page = useContext(Ctx);
  const { settings } = useAuth();
  const [anns, setAnns] = useState<Ann[]>([]);
  const host = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<null | { x: number; y: number; sel: { text: string; start: number; end: number; prefix: string; suffix: string } }>(null);
  const [editor, setEditor] = useState<null | { sel: any; ann?: Ann; color?: string | null }>(null);
  const [panel, setPanel] = useState<null | Ann[]>(null);
  const hash = useMemo(() => hashText(text), [text]);

  const load = useCallback(() => {
    get<Ann[]>('/annotations/for-content', { keys: contentKey }).then(setAnns).catch(() => setAnns([]));
  }, [contentKey]);
  useEffect(load, [load, page.version]);

  const { d, list } = useVisible(anns);
  const highlightMode = settings?.highlight_mode !== false;

  // build non-overlapping segments; overlapping annotations → combined "multi" marker listing all
  const segments = useMemo(() => {
    const placed: { a: Ann; start: number; end: number }[] = [];
    const lost: Ann[] = [];
    for (const a of list) {
      const loc = locate(text, a);
      if (loc) placed.push({ a, ...loc });
      else lost.push(a);
    }
    const cuts = new Set<number>([0, text.length]);
    placed.forEach((p) => (cuts.add(p.start), cuts.add(p.end)));
    const pts = [...cuts].sort((x, y) => x - y);
    const segs: { s: number; e: number; anns: Ann[] }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i];
      const e = pts[i + 1];
      segs.push({ s, e, anns: placed.filter((p) => p.start <= s && p.end >= e).map((p) => p.a) });
    }
    return { segs, lost };
  }, [list, text]);

  // report anchors we could not re-locate (never silently attached elsewhere)
  useEffect(() => {
    for (const a of segments.lost) if (a.isOwn && a.status !== 'Requires Reattachment') post(`/annotations/anchors/${a.anchorId}/status`, { status: 'requires_reattachment' }).catch(() => {});
  }, [segments.lost]);

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !host.current || !s.rangeCount) return setMenu(null);
    const r = s.getRangeAt(0);
    if (!host.current.contains(r.commonAncestorContainer)) return;
    const pre = document.createRange();
    pre.selectNodeContents(host.current);
    pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    const selected = r.toString();
    if (!selected.trim() || selected.length > 5000) return setMenu(null);
    const end = start + selected.length;
    if (text.slice(start, end) !== selected) return setMenu(null); // DOM text differs from source text: do not guess
    const rect = r.getBoundingClientRect();
    const hostRect = host.current.getBoundingClientRect();
    setMenu({
      x: rect.left - hostRect.left,
      y: rect.top - hostRect.top - 38,
      sel: { text: selected, start, end, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) },
    });
  };

  const Tag: any = as;
  const quickHighlight = async (sel: any) => {
    await post('/annotations', {
      contentKey,
      contentHash: hash,
      selectedText: sel.text,
      start: sel.start,
      end: sel.end,
      prefix: sel.prefix,
      suffix: sel.suffix,
      color: settings?.default_highlight_color || 'yellow',
      visibility: 'private',
      researchUrl: page.researchUrl,
      context: page.context,
    });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
    page.bump();
  };

  return (
    <Tag ref={host} className={`annot-host ${className ?? ''}`} onMouseUp={onMouseUp} data-content-key={contentKey}>
      {segments.segs.map((g, i) => {
        const t = text.slice(g.s, g.e);
        if (!g.anns.length) return <span key={i}>{t}</span>;
        const colors = g.anns.map((a) => a.color).filter(Boolean) as string[];
        const showBg = d.showHighlightBackgrounds && highlightMode;
        const own = g.anns.some((a) => a.isOwn);
        const top = colors[colors.length - 1];
        return (
          <span
            key={i}
            className={`annot ${showBg && top ? `c-${top}` : 'nobg'} ${g.anns.length > 1 ? 'multi' : ''} ${own ? 'own' : 'other'}`}
            style={showBg && colors.length > 1 ? { backgroundImage: `linear-gradient(90deg, ${colors.map((c, k) => `var(--hl-${c}) ${(k * 100) / colors.length}% ${((k + 1) * 100) / colors.length}%`).join(',')})` } : undefined}
            role="button"
            tabIndex={0}
            aria-label={`Annotated text, ${g.anns.length} annotation(s)`}
            onClick={(e) => {
              e.stopPropagation();
              if (!window.getSelection()?.toString()) setPanel(g.anns);
            }}
            onKeyDown={(e) => e.key === 'Enter' && setPanel(g.anns)}
          >
            {t}
          </span>
        );
      })}
      {segments.lost.length > 0 && segments.lost.some((a) => a.isOwn) && (
        <span className="badge warn" style={{ marginLeft: 8 }} title="The text of some of your annotations changed and could not be safely re-located">
          {segments.lost.filter((a) => a.isOwn).length} annotation(s) require reattachment
        </span>
      )}
      {menu && (
        <span className="sel-menu" style={{ left: Math.max(0, menu.x), top: Math.max(0, menu.y) }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => setEditor({ sel: menu.sel })}>Add Comment</button>
          <button onClick={() => quickHighlight(menu.sel)}>Highlight</button>
          <button onClick={() => (navigator.clipboard?.writeText(menu.sel.text), setMenu(null))}>Copy</button>
          <button onClick={() => (setMenu(null), window.getSelection()?.removeAllRanges())}>Cancel</button>
        </span>
      )}
      {editor && (
        <AnnotationEditor
          contentKey={contentKey}
          contentHash={hash}
          sel={editor.sel}
          ann={editor.ann}
          onClose={() => {
            setEditor(null);
            setMenu(null);
            window.getSelection()?.removeAllRanges();
          }}
          onSaved={() => {
            setEditor(null);
            setMenu(null);
            page.bump();
          }}
        />
      )}
      {panel && (
        <AnnotationPanel
          anns={panel}
          onClose={() => setPanel(null)}
          onEdit={(a) => {
            setPanel(null);
            setEditor({ sel: { text: a.anchor.selectedText }, ann: a });
          }}
          onChanged={() => {
            setPanel(null);
            page.bump();
          }}
        />
      )}
    </Tag>
  );
}

export function AnnotationEditor({ contentKey, contentHash, sel, ann, onClose, onSaved }: { contentKey: string; contentHash: string; sel: any; ann?: Ann; onClose: () => void; onSaved: () => void }) {
  const page = useContext(Ctx);
  const { settings } = useAuth();
  const [comment, setComment] = useState(ann?.comment ?? '');
  const [color, setColor] = useState<string | null>(ann ? ann.color : settings?.default_highlight_color ?? 'yellow');
  const [vis, setVis] = useState<'private' | 'public'>(ann?.visibility ?? 'private');
  const [links, setLinks] = useState<{ url: string; text: string }[]>(ann?.links?.map((l) => ({ url: l.url, text: l.text ?? '' })) ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [existing, setExisting] = useState(ann?.attachments ?? []);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const cleanLinks = links.filter((l) => l.url.trim()).map((l) => ({ url: l.url.trim(), text: l.text.trim() || null }));
      let id = ann?.id;
      if (ann) await patch(`/annotations/${ann.id}`, { comment: comment || null, color, visibility: vis, links: cleanLinks });
      else {
        const r = await post<Ann>('/annotations', {
          contentKey,
          contentHash,
          selectedText: sel.text,
          start: sel.start,
          end: sel.end,
          prefix: sel.prefix,
          suffix: sel.suffix,
          comment: comment || null,
          color,
          visibility: vis,
          links: cleanLinks,
          researchUrl: page.researchUrl,
          context: page.context,
        });
        id = r.id;
      }
      if (files.length && id) {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        await api(`/annotations/${id}/attachments`, { form: fd, method: 'POST' });
      }
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={ann ? 'Edit annotation' : 'Add comment'} onClose={onClose}>
      <div className="evidence-quote" style={{ maxHeight: 90, overflow: 'auto' }}>{sel.text}</div>
      <div className="field">
        <label htmlFor="ann-comment">Comment</label>
        <textarea id="ann-comment" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Highlight color</label>
        <div className="row">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`ghost small`} onClick={() => setColor(c)} aria-pressed={color === c} aria-label={`Highlight ${c}`}>
              <span className={`swatch c-${c} ${color === c ? 'sel' : ''}`} />
            </button>
          ))}
          <button type="button" className="small ghost" onClick={() => setColor(null)} aria-pressed={color === null}>{color === null ? '✓ ' : ''}No highlight</button>
        </div>
      </div>
      <div className="field">
        <label>Visibility</label>
        <div className="row">
          <label style={{ display: 'inline-flex', gap: 5, margin: 0 }}><input type="radio" checked={vis === 'private'} onChange={() => setVis('private')} /> Private (only me)</label>
          <label style={{ display: 'inline-flex', gap: 5, margin: 0 }}><input type="radio" checked={vis === 'public'} onChange={() => setVis('public')} /> Public (all signed-in users, read-only)</label>
        </div>
      </div>
      <div className="field">
        <label>Links</label>
        {links.map((l, i) => (
          <div className="row" key={i} style={{ marginBottom: 4 }}>
            <input style={{ flex: 2 }} placeholder="https://…" value={l.url} onChange={(e) => setLinks(links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
            <input style={{ flex: 1 }} placeholder="Display text" value={l.text} onChange={(e) => setLinks(links.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
            <button className="small" onClick={() => setLinks(links.filter((_, k) => k !== i))}>Remove</button>
          </div>
        ))}
        <button className="small" onClick={() => setLinks([...links, { url: '', text: '' }])}>+ Add link</button>
      </div>
      <div className="field">
        <label>Images (JPEG, PNG, WebP)</label>
        <div className="att-grid">
          {existing.map((a) => (
            <div key={a.id}>
              <img src={`/api/annotations/attachments/${a.id}/file?thumb=1`} alt={a.alt_text || 'attachment'} />
              <button
                className="small danger"
                onClick={async () => {
                  if (!ann || !(await confirmDialog('Remove this image attachment? The comment is kept.', { danger: true }))) return;
                  await del(`/annotations/${ann.id}/attachments/${a.id}`);
                  setExisting(existing.filter((x) => x.id !== a.id));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={p}>
              <img src={p} alt="new attachment preview" />
              <button className="small" onClick={() => setFiles(files.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </div>
      <ErrorBox e={err} />
      <div className="row">
        <button className="primary" disabled={busy || (!comment.trim() && !color)} onClick={save}>Save</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

export function AnnotationPanel({ anns, onClose, onEdit, onChanged }: { anns: Ann[]; onClose: () => void; onEdit: (a: Ann) => void; onChanged: () => void }) {
  const [big, setBig] = useState<number | null>(null);
  const [err, setErr] = useState<any>(null);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal title={`Annotations (${anns.length})`} onClose={onClose}>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span>Underlined = yours</span><span>Dotted edge = another user’s public annotation</span>
      </div>
      <ErrorBox e={err} />
      {anns.map((a) => (
        <div key={a.id} className="card" style={{ marginBottom: 8 }}>
          <div className="row between">
            <span>
              {a.color && <span className={`swatch c-${a.color}`} />} <b>{a.isOwn ? 'You' : a.author}</b>{' '}
              <span className="badge dashed">{a.isOwn ? a.visibility : 'public'}</span>
              {a.status !== 'Active' && <span className="badge warn" style={{ marginLeft: 4 }}>{a.status}</span>}
            </span>
            <span className="faint small-text">{new Date(a.createdAt).toLocaleString()}</span>
          </div>
          {a.comment ? <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{a.comment}</p> : <p className="muted">(highlight only)</p>}
          {(a.links ?? []).map((l, i) => (
            <div key={i}><a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.text || l.url}</a></div>
          ))}
          {a.attachments.length > 0 && (
            <div className="att-grid">
              {a.attachments.map((t) => (
                <img key={t.id} src={`/api/annotations/attachments/${t.id}/file?thumb=1`} alt={t.alt_text || 'attached image'} onClick={() => setBig(t.id)} />
              ))}
            </div>
          )}
          {a.isOwn && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small" onClick={() => onEdit(a)}>Edit</button>
              <select aria-label="Change highlight color" value={a.color ?? ''} onChange={(e) => run(() => patch(`/annotations/${a.id}`, { color: e.target.value || null }))} style={{ padding: '1px 4px' }}>
                <option value="">No highlight</option>
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select aria-label="Visibility" title="Who can see this annotation" value={a.visibility} onChange={(e) => run(() => patch(`/annotations/${a.id}`, { visibility: e.target.value }))} style={{ padding: '1px 4px' }}>
                <option value="private">Private (only me)</option>
                <option value="public">Public (all users)</option>
              </select>
              {a.color && a.comment && <button className="small" onClick={() => run(() => patch(`/annotations/${a.id}`, { color: null }))}>Remove highlight</button>}
              {a.comment && <button className="small icon-only" title="Delete comment" aria-label="Delete comment" style={{ background: 'var(--inv-bg)', color: 'var(--inv-fg)', borderColor: 'var(--inv-bg)' }} onClick={async () => (await confirmDialog('Delete this comment? (Moves to Trash if there is no highlight.)', { danger: true })) && run(() => post(`/annotations/${a.id}/delete-comment`))}>🗑</button>}
              <button className="small danger" onClick={async () => (await confirmDialog('Delete the complete annotation (comment, highlight and attachments)? It can be restored from Trash.', { danger: true })) && run(() => post(`/annotations/${a.id}/trash`))}>Delete annotation</button>
            </div>
          )}
          {a.researchUrl && <div className="small-text faint" style={{ marginTop: 6 }}>Context: <a href={a.researchUrl}>{a.researchUrl}</a></div>}
        </div>
      ))}
      {big && <Modal title="Image" onClose={() => setBig(null)} wide><img src={`/api/annotations/attachments/${big}/file`} alt="full size attachment" style={{ maxWidth: '100%' }} /></Modal>}
    </Modal>
  );
}

/** Compact eye icon + popover for per-user annotation display preferences (§36). */
export function AnnotationDisplayControl() {
  const { settings, updateSettings } = useAuth();
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  // open left-aligned with the button; flip to right-aligned only when that would run off the screen
  useLayoutEffect(() => {
    if (!open) return setAlignRight(false);
    const r = popRef.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 8) setAlignRight(true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', esc));
  }, [open]);
  if (!settings) return null;
  const d = settings.annotation_display;
  const set = (k: keyof typeof d, v: boolean) => updateSettings({ annotation_display: { ...d, [k]: v } } as any);
  const anyShown = d.showOthersPublic || d.showOwn;
  return (
    <span className="btn-group" role="group" aria-label="Notes">
    <span className="pop-anchor" ref={ref}>
      <button className="small" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} title={`Annotations: ${anyShown ? 'shown' : 'hidden'}`}>
        <EyeIcon off={!anyShown} /> Notes
      </button>
      {open && (
        <div className="popover" ref={popRef} role="dialog" aria-label="Annotation Display Settings" style={alignRight ? { top: '100%', right: 0 } : { top: '100%', left: 0 }}>
          <b>Annotation Display Settings</b>
          <p className="muted small-text">Affects only what you see. Nothing is deleted or made private/public.</p>
          {([
            ['showOthersPublic', "Other users' public content"],
            ['showOwn', 'My own content'],
            ['showHighlightBackgrounds', 'Highlight backgrounds'],
          ] as const).map(([k, label]) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--fg)', fontSize: '.9rem', fontWeight: 400 }}>
              <input type="checkbox" checked={d[k]} onChange={(e) => set(k, e.target.checked)} />
              {label}: <b>{d[k] ? 'Show' : 'Hide'}</b>
            </label>
          ))}
          <hr />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--fg)', fontWeight: 400 }}>
            <input type="checkbox" checked={settings.highlight_mode} onChange={(e) => updateSettings({ highlight_mode: e.target.checked })} /> Highlight Mode: <b>{settings.highlight_mode ? 'ON' : 'OFF'}</b>
          </label>
          <div className="row" style={{ marginTop: 6, flexWrap: 'nowrap', gap: 4 }}>
            <span className="small-text muted" style={{ marginRight: 4, whiteSpace: 'nowrap' }}>Default color</span>
            {COLORS.map((c) => (
              <button key={c} className="ghost small" style={{ padding: '3px 4px' }} aria-label={`Default highlight ${c}`} aria-pressed={settings.default_highlight_color === c} onClick={() => updateSettings({ default_highlight_color: c })}>
                <span className={`swatch c-${c} ${settings.default_highlight_color === c ? 'sel' : ''}`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
    <button className="small icon-only" onClick={() => setListOpen(true)} aria-label="Show my notes" title="Show my notes"><ListIcon /></button>
    {listOpen && <NotesListModal onClose={() => setListOpen(false)} />}
    </span>
  );
}
