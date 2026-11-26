import { useLocation } from 'react-router-dom';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnnotationDisplayControl } from './Annotatable';
import { OriginalPdfButton } from './OriginalPdfButton';
import { SplitToggle } from './Viewer';
import { SaveBookmarkButton } from '../pages/Bookmarks';

/** What the current page tells the global header toolbar (bookmark label/context, record model, split availability). */
export interface PageInfo { title?: string; context?: Record<string, unknown>; modelId?: number }

interface Ctx { info: PageInfo | null; setInfo: (i: PageInfo | null) => void; splitCount: number; bumpSplit: (d: number) => void }
const PageToolsCtx = createContext<Ctx>({ info: null, setInfo: () => {}, splitCount: 0, bumpSplit: () => {} });

export function PageToolsProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [splitCount, setSplit] = useState(0);
  const value = useMemo<Ctx>(() => ({ info, setInfo, splitCount, bumpSplit: (d) => setSplit((n) => Math.max(0, n + d)) }), [info, splitCount]);
  return <PageToolsCtx.Provider value={value}>{children}</PageToolsCtx.Provider>;
}

/** A page calls this to describe itself to the header toolbar (cleared when the page unmounts). */
export function usePageInfo(info: PageInfo | null) {
  const { setInfo } = useContext(PageToolsCtx);
  const key = JSON.stringify(info);
  useEffect(() => { setInfo(info); return () => setInfo(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** SplitView calls this so the toolbar shows the Split button only on pages that support it. */
export function useSplitAvailable() {
  const { bumpSplit } = useContext(PageToolsCtx);
  useEffect(() => { bumpSplit(1); return () => bumpSplit(-1); }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Global header toolbar: [Split — only where supported] [Notes] [Save] [Open PDF — always last]. */
export function PageToolbar() {
  const { info } = useContext(PageToolsCtx);
  const adminPage = useLocation().pathname.startsWith('/superadmin'); // no notes / bookmarks on Superadmin Panel pages
  return (
    <div className="page-toolbar">
      {!adminPage && <AnnotationDisplayControl />}
      {!adminPage && <SaveBookmarkButton title={info?.title} context={info?.context ?? {}} />}
      <span className="tb-pdf"><OriginalPdfButton modelId={info?.modelId} /></span>
    </div>
  );
}

/**
 * Desktop: the "Open PDF" button sits on the page-title line, at the right edge of the content.
 * It is positioned over the first <h1> of the page (re-measured when the page changes or resizes).
 * On mobile the same button lives in the header toolbar instead.
 */
export function TitleLinePdf({ scrollRef }: { scrollRef: React.RefObject<HTMLElement | null> }) {
  const { info, splitCount } = useContext(PageToolsCtx);
  const adminPage = useLocation().pathname.startsWith('/superadmin');
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const main = scrollRef.current;
    if (!main) return;
    const place = () => {
      const h1 = main.querySelector('.page h1') as HTMLElement | null;
      const b = box.current;
      if (!h1 || !b) return setTop(null);
      const m = main.getBoundingClientRect();
      const r = h1.getBoundingClientRect();
      setTop(Math.round(r.top - m.top + main.scrollTop + Math.max(0, (Math.min(r.height, 44) - b.offsetHeight) / 2)));
    };
    let tm: ReturnType<typeof setTimeout>;
    const later = () => { place(); clearTimeout(tm); tm = setTimeout(place, 250); }; // re-measure once layout has settled
    later();
    const mo = new MutationObserver(later);
    mo.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', later);
    const ro = new ResizeObserver(later);
    ro.observe(main);
    return () => { clearTimeout(tm); mo.disconnect(); ro.disconnect(); window.removeEventListener('resize', later); };
  }, [scrollRef]);
  if (adminPage) return null;
  return <div ref={box} className="title-pdf" style={top == null ? { display: 'none' } : { top }}><OriginalPdfButton modelId={info?.modelId} />{splitCount > 0 && <SplitToggle />}</div>;
}
