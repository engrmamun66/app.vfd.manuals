import { useEffect, useState } from 'react';

type T = { id: number; text: string; kind: 'success' | 'error' };
let push: ((t: T) => void) | null = null;
let n = 0;

/** Shows a short toast (bottom-right, auto-hides). Usage anywhere: toast('Saved'), toast('Failed', 'error'). */
export function toast(text: string, kind: 'success' | 'error' = 'success') {
  push?.({ id: ++n, text, kind });
}

export function Toaster() {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      setList((l) => [...l.slice(-3), t]);
      window.setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.kind === 'error' ? 5000 : 2800);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span aria-hidden="true">{t.kind === 'success' ? '✓' : '!'}</span> {t.text}
        </div>
      ))}
    </div>
  );
}
