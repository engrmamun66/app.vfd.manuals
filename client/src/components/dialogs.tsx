import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './ui';

/**
 * App-styled replacements for window.confirm / window.prompt.
 * Usage (anywhere, no hook needed):  if (!(await confirmDialog('Delete this?', { danger: true }))) return;
 *                                     const name = await promptDialog('New folder name');   // null = cancelled
 * <DialogProvider> (mounted once in App) renders them. Without a provider they fall back to the native dialogs.
 */
interface Base { message: string; title?: string; confirmLabel?: string; danger?: boolean }
type Req =
  | ({ kind: 'confirm'; resolve: (v: boolean) => void } & Base)
  | ({ kind: 'prompt'; defaultValue?: string; placeholder?: string; resolve: (v: string | null) => void } & Base)
  | ({ kind: 'choose'; choices: { label: string; value: string; hint?: string }[]; resolve: (v: string | null) => void } & Base);
type Input<T extends Req> = Omit<T, 'kind' | 'resolve' | 'message'>;

let push: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, opts: Input<Extract<Req, { kind: 'confirm' }>> = {}): Promise<boolean> {
  return new Promise((resolve) => (push ? push({ kind: 'confirm', message, ...opts, resolve }) : resolve(window.confirm(message))));
}
export function promptDialog(message: string, opts: Input<Extract<Req, { kind: 'prompt' }>> = {}): Promise<string | null> {
  return new Promise((resolve) => (push ? push({ kind: 'prompt', message, ...opts, resolve }) : resolve(window.prompt(message, opts.defaultValue ?? ''))));
}
export function chooseDialog(message: string, choices: { label: string; value: string; hint?: string }[], opts: Omit<Input<Extract<Req, { kind: 'choose' }>>, 'choices'> = {}): Promise<string | null> {
  return new Promise((resolve) => (push ? push({ kind: 'choose', message, choices, ...(opts as object), resolve }) : resolve(null)));
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Req[]>([]);
  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => { push = null; };
  }, []);
  const cur = queue[0];
  const done = (v: unknown) => {
    (cur.resolve as (x: unknown) => void)(v);
    setQueue((q) => q.slice(1));
  };
  return (
    <>
      {children}
      {cur && <DialogView key={queue.length + cur.message} req={cur} done={done} />}
    </>
  );
}

function DialogView({ req, done }: { req: Req; done: (v: unknown) => void }) {
  const [text, setText] = useState(req.kind === 'prompt' ? req.defaultValue ?? '' : '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const cancel = () => done(req.kind === 'confirm' ? false : null);
  const title = req.title ?? (req.kind === 'confirm' ? 'Please confirm' : req.kind === 'prompt' ? 'Enter a value' : 'Choose an option');
  return (
    <Modal title={title} onClose={cancel}>
      <p style={{ whiteSpace: 'pre-line', marginTop: 0 }}>{req.message}</p>
      {req.kind === 'confirm' && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={cancel}>Cancel</button>
          <button className={req.danger ? 'danger' : 'primary'} autoFocus onClick={() => done(true)}>{req.confirmLabel ?? 'Confirm'}</button>
        </div>
      )}
      {req.kind === 'prompt' && (
        <form onSubmit={(e) => { e.preventDefault(); done(text); }}>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={req.placeholder} aria-label={req.message} style={{ width: '100%', marginBottom: 12 }} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={cancel}>Cancel</button>
            <button className="primary">{req.confirmLabel ?? 'OK'}</button>
          </div>
        </form>
      )}
      {req.kind === 'choose' && (
        <div>
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginBottom: 12 }}>
            {req.choices.map((c) => (
              <button key={c.value} className="primary" style={{ textAlign: 'left' }} onClick={() => done(c.value)}>
                {c.label}{c.hint && <div className="small-text" style={{ opacity: 0.8 }}>{c.hint}</div>}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={cancel}>Cancel</button></div>
        </div>
      )}
    </Modal>
  );
}
