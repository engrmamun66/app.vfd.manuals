import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AnnotationEditor, AnnotationPanel, AnnotationScope, hashText, locate, type Ann } from './Annotatable';

/**
 * Highlight + comment on ANY text of a page (lists, tables, headings, ...).
 *
 * - A selection inside one text block (cell, paragraph, heading, ...) gets the same "Add Comment / Highlight" menu.
 * - The annotation is stored under a content-based key: page path + table-row context + the block's text.
 *   It is painted with the CSS Custom Highlight API, so React-rendered DOM is never modified.
 * - Blocks that already are <Annotatable> (descriptions, manual page text) keep their own mechanism and are skipped here.
 */
const BLOCK = 'td,th,p,li,dd,dt,h1,h2,h3,h4,h5,h6,label,pre,blockquote,.small-text';
const SKIP = 'input,textarea,select,button,a,[contenteditable="true"],.annot-host,.pager,.sel-menu';
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function rowContext(el: Element) {
  const cell = el.closest('td,th');
  const tr = el.closest('tr');
  if (!tr || !cell) return '';
  const cells = Array.from(tr.children);
  return `${cells.slice(0, 2).map((c) => norm(c.textContent ?? '')).join('|')}#${cells.indexOf(cell)}`;
}
const keyFor = (el: Element, pathHash: string) => `ui:${pathHash}:${hashText(rowContext(el))}:${hashText(norm(el.textContent ?? ''))}`;

/** The text of a block the way offsets are counted: textContent (not normalised, so offsets stay valid). */
function rangeFromOffsets(el: Element, start: number, end: number): Range | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Node | null;
  const r = document.createRange();
  let started = false;
  while ((n = w.nextNode())) {
    const len = (n.textContent ?? '').length;
    if (!started && start < pos + len) { r.setStart(n, start - pos); started = true; }
    if (started && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  return null;
}

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (window as any).Highlight === 'function';

interface Hit { range: Range; anns: Ann[] }

export function PageAnnotations() {
  const loc = useLocation();
  const { settings } = useAuth();
  const [anns, setAnns] = useState<Ann[]>([]);
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState<null | { x: number; y: number; el: Element; sel: { text: string; start: number; end: number; prefix: string; suffix: string } }>(null);
  const [editor, setEditor] = useState<null | { key: string; hash: string; sel: any; ann?: Ann }>(null);
  const [panel, setPanel] = useState<null | Ann[]>(null);
  const hits = useRef<Hit[]>([]);
  const pathHash = hashText(loc.pathname);
  const d = settings?.annotation_display ?? { showOthersPublic: true, showOwn: true, showHighlightBackgrounds: true };

  // load this page's annotations
  useEffect(() => {
    let live = true;
    get<Ann[]>('/annotations/for-prefix', { prefix: `ui:${pathHash}:` }).then((r) => live && setAnns(r)).catch(() => live && setAnns([]));
    return () => { live = false; };
  }, [pathHash, version]);

  const paint = useCallback(() => {
    hits.current = [];
    if (!supported) return;
    const reg = (CSS as any).highlights as Map<string, unknown>;
    for (const k of Array.from(reg.keys())) if (k.startsWith('ann-')) reg.delete(k);
    const visible = anns.filter((a) => (a.isOwn ? d.showOwn : d.showOthersPublic));
    if (!visible.length) return;
    const byKey = new Map<string, Ann[]>();
    for (const a of visible) byKey.set(a.anchor.contentKey, [...(byKey.get(a.anchor.contentKey) ?? []), a]);
    const root = document.querySelector('.main .page');
    if (!root) return;
    const groups = new Map<string, Range[]>();
    const add = (name: string, r: Range) => groups.set(name, [...(groups.get(name) ?? []), r]);
    root.querySelectorAll(BLOCK).forEach((el) => {
      if (el.closest('.annot-host')) return;
      const found = byKey.get(keyFor(el, pathHash));
      if (!found) return;
      const text = el.textContent ?? '';
      for (const a of found) {
        const at = locate(text, a);
        const range = at && rangeFromOffsets(el, at.start, at.end);
        if (!range) continue;
        hits.current.push({ range, anns: [a] });
        if (a.color && d.showHighlightBackgrounds) add(`ann-${a.color}`, range);
        add(a.isOwn ? 'ann-own' : 'ann-other', range);
      }
    });
    for (const [name, ranges] of groups) reg.set(name, new (window as any).Highlight(...ranges));
  }, [anns, pathHash, d.showOwn, d.showOthersPublic, d.showHighlightBackgrounds]);

  // repaint when the page content changes (rows, pagination, filters, data loading)
  useEffect(() => {
    paint();
    const root = document.querySelector('.main');
    if (!root) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(paint, 200); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(t); mo.disconnect(); if (supported) for (const k of Array.from(((CSS as any).highlights as Map<string, unknown>).keys())) if (k.startsWith('ann-')) ((CSS as any).highlights as Map<string, unknown>).delete(k); };
  }, [paint]);

  // selection → floating menu
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('.sel-menu')) return;
      setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) return setMenu(null);
        const r = s.getRangeAt(0);
        const root = document.querySelector('.main .page');
        const anc = r.commonAncestorContainer.nodeType === 1 ? (r.commonAncestorContainer as Element) : r.commonAncestorContainer.parentElement;
        if (!root || !anc || !root.contains(anc)) return setMenu(null);
        if (anc.closest(SKIP)) return setMenu(null);
        const el = anc.closest(BLOCK);
        if (!el || !root.contains(el) || el.closest('.annot-host')) return setMenu(null);
        const selected = r.toString();
        if (!selected.trim() || selected.length > 5000) return setMenu(null);
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(r.startContainer, r.startOffset);
        const start = pre.toString().length;
        const text = el.textContent ?? '';
        const end = start + selected.length;
        if (text.slice(start, end) !== selected) return setMenu(null);
        const rect = r.getBoundingClientRect();
        setMenu({ x: Math.max(8, Math.min(rect.left, window.innerWidth - 300)), y: Math.max(8, rect.top - 40), el, sel: { text: selected, start, end, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) } });
      }, 0);
    };
    const onDown = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest('.sel-menu')) setMenu(null); };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('mousedown', onDown); };
  }, []);

  // click on a highlighted text → annotation panel
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!hits.current.length || window.getSelection()?.toString()) return;
      const t = e.target as Element | null;
      if (!t || !t.closest('.main .page') || t.closest('a,button,input,select,textarea,.annot-host,.sel-menu')) return;
      const doc = document as any;
      let node: Node | null = null;
      let offset = 0;
      if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(e.clientX, e.clientY); node = p?.offsetNode ?? null; offset = p?.offset ?? 0; }
      else if (doc.caretRangeFromPoint) { const r = doc.caretRangeFromPoint(e.clientX, e.clientY); node = r?.startContainer ?? null; offset = r?.startOffset ?? 0; }
      if (!node) return;
      const found = hits.current.filter((h) => { try { return h.range.isPointInRange(node!, offset); } catch { return false; } });
      if (found.length) setPanel(found.flatMap((h) => h.anns));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const url = loc.pathname + loc.search;
  const quickHighlight = async () => {
    if (!menu) return;
    await post('/annotations', {
      contentKey: keyFor(menu.el, pathHash),
      contentHash: hashText(menu.el.textContent ?? ''),
      selectedText: menu.sel.text,
      start: menu.sel.start,
      end: menu.sel.end,
      prefix: menu.sel.prefix,
      suffix: menu.sel.suffix,
      color: settings?.default_highlight_color || 'yellow',
      visibility: 'private',
      researchUrl: url,
      context: {},
    });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
    setVersion((v) => v + 1);
  };

  return (
    <AnnotationScope researchUrl={url} context={{}}>
      {menu && createPortal(
        <span className="sel-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 90 }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => { setEditor({ key: keyFor(menu.el, pathHash), hash: hashText(menu.el.textContent ?? ''), sel: menu.sel }); setMenu(null); }}>Add Comment</button>
          <button onClick={quickHighlight}>Highlight</button>
          <button onClick={() => { navigator.clipboard?.writeText(menu.sel.text); setMenu(null); }}>Copy</button>
          <button onClick={() => { setMenu(null); window.getSelection()?.removeAllRanges(); }}>Cancel</button>
        </span>,
        document.body,
      )}
      {editor && (
        <AnnotationEditor
          contentKey={editor.key}
          contentHash={editor.hash}
          sel={editor.sel}
          ann={editor.ann}
          onClose={() => { setEditor(null); window.getSelection()?.removeAllRanges(); }}
          onSaved={() => { setEditor(null); window.getSelection()?.removeAllRanges(); setVersion((v) => v + 1); }}
        />
      )}
      {panel && (
        <AnnotationPanel
          anns={panel}
          onClose={() => setPanel(null)}
          onEdit={(a) => { setPanel(null); setEditor({ key: a.anchor.contentKey, hash: a.anchor.contentHash ?? '', sel: { text: a.anchor.selectedText }, ann: a }); }}
          onChanged={() => { setPanel(null); setVersion((v) => v + 1); }}
        />
      )}
    </AnnotationScope>
  );
}
