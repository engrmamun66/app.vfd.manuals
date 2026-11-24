import { useEffect, useMemo, useRef, useState } from 'react';
import { api, get, fmtDate } from '../lib/api';
import { ErrorBox, Loading, Modal, useAsync } from './ui';

const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const OPTIONS = [
  { value: 'request', title: 'Request', hint: 'Ask for a manual, a model, a feature or a change' },
  { value: 'complaint', title: 'Complaint', hint: 'Report a wrong value, a problem or something not working' },
] as const;

/** "Send request" dialog: pick Request or Complaint, write the message, optionally attach images. */
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'request' | 'complaint'>('request');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    let problem: string | null = null;
    for (const f of Array.from(list)) {
      if (!TYPES.includes(f.type)) problem = `“${f.name}” is not a JPEG, PNG or WebP image`;
      else if (f.size > MAX_BYTES) problem = `“${f.name}” is larger than 10 MB`;
      else if (next.length >= MAX_IMAGES) problem = `At most ${MAX_IMAGES} images`;
      else next.push(f);
    }
    setFiles(next);
    setError(problem);
    if (input.current) input.current.value = '';
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 3) return setError('Please write a few words (at least 3 characters).');
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('kind', kind);
      if (phone.trim()) form.append('contact_phone', phone.trim());
      if (email.trim()) form.append('contact_email', email.trim());
      form.append('message', message.trim());
      files.forEach((f) => form.append('files', f));
      await api('/feedback', { method: 'POST', form });
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Could not send. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Send request" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'new'} className={`tab ${tab === 'new' ? 'active' : ''}`} onClick={() => setTab('new')}>New message</button>
        <button role="tab" aria-selected={tab === 'mine'} className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>My messages</button>
      </div>
      {tab === 'mine' ? <MyMessages /> : sent ? (
        <div className="stack">
          <p role="status"><b>Sent.</b> Thank you — the administrator will review your {kind}.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <form className="stack" onSubmit={send}>
          <div className="radio-cards" role="radiogroup" aria-label="Type of message">
            {OPTIONS.map((o) => (
              <label key={o.value} className={`radio-card ${kind === o.value ? 'on' : ''}`}>
                <input type="radio" name="feedback-kind" value={o.value} checked={kind === o.value} onChange={() => setKind(o.value)} />
                <span className="rc-title">{o.title}</span>
                <span className="rc-hint">{o.hint}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="fb-phone">Phone number <span className="faint">(optional)</span></label>
              <input id="fb-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+880 1XXX-XXXXXX" style={{ width: '100%' }} autoFocus />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="fb-email">Email <span className="faint">(optional)</span></label>
              <input id="fb-email" type="email" autoComplete="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" style={{ width: '100%' }} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="fb-msg">Your message</label>
            <textarea id="fb-msg" rows={6} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={kind === 'request' ? 'What would you like us to add or change?' : 'What went wrong? Include the model and parameter if you can.'} />
            <div className="small-text faint" style={{ textAlign: 'right' }}>{message.length} / 4000</div>
          </div>
          <div className="field">
            <label>Images <span className="faint">(optional, up to {MAX_IMAGES}; JPEG, PNG or WebP)</span></label>
            <div
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
              onPaste={(e) => add(Array.from(e.clipboardData.files))}
              tabIndex={0}
            >
              <button type="button" className="small" onClick={() => input.current?.click()} disabled={files.length >= MAX_IMAGES}>Choose images</button>
              <span className="small-text faint">or drag &amp; drop / paste here</span>
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} aria-label="Attach images" />
            </div>
            {files.length > 0 && (
              <div className="thumbs">
                {files.map((f, i) => (
                  <div key={f.name + i} className="thumb">
                    <img src={previews[i]} alt={f.name} />
                    <button type="button" className="thumb-x" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => setFiles(files.filter((_, k) => k !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const STATUS_LABEL: Record<string, string> = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };

/** The user's own earlier messages with their status and the administrator's note. */
function MyMessages() {
  const { data, error } = useAsync(() => get('/feedback/mine'), []);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <Loading />;
  if (!data.rows.length) return <div className="empty">You have not sent any message yet.</div>;
  return (
    <div className="stack" style={{ maxHeight: '55vh', overflow: 'auto' }}>
      {data.rows.map((r: any) => (
        <div key={r.id} className="card">
          <div className="row between">
            <span><span className="badge strong">{r.kind === 'complaint' ? 'Complaint' : 'Request'}</span> <span className="badge dashed">{STATUS_LABEL[r.status] ?? r.status}</span></span>
            <span className="small-text muted">{fmtDate(r.created_at)}</span>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{r.message}</p>
          {r.images.length > 0 && <div className="thumbs">{r.images.map((im: any) => <a key={im.upload_id} className="thumb" href={`/api/feedback/images/${im.upload_id}`} target="_blank" rel="noreferrer"><img src={`/api/feedback/images/${im.upload_id}?thumb=1`} alt={im.name ?? 'attachment'} /></a>)}</div>}
          {r.admin_note && <p className="small-text" style={{ marginBottom: 0 }}><b>Administrator:</b> {r.admin_note}</p>}
        </div>
      ))}
    </div>
  );
}
