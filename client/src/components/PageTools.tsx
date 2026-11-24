import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/** Global header toolbar: [Split — only where supported] [Notes] [Save] [Open original PDF — always last]. */
export function PageToolbar() {
  const { info, splitCount } = useContext(PageToolsCtx);
  return (
    <div className="page-toolbar">
      {splitCount > 0 && <SplitToggle />}
      <AnnotationDisplayControl />
      <SaveBookmarkButton title={info?.title} context={info?.context ?? {}} />
      <OriginalPdfButton modelId={info?.modelId} />
    </div>
  );
}
