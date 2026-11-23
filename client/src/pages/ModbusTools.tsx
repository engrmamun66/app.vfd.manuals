import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api';
import { Crumbs, InfoIcon, useAsync } from '../components/ui';

/** Pure arithmetic only. Never decides that a result is a valid PLC address or a 4xxxx reference. */
function parseAddr(s: string): { value: number; base: 'hex' | 'dec'; error?: string } | { error: string } {
  const t = s.trim();
  if (!t) return { error: '' };
  const hex = /^(?:0x)?([0-9a-f]+)\s*h?$/i.exec(t);
  const explicitHex = /^0x/i.test(t) || /h$/i.test(t) || /[a-f]/i.test(t);
  if (explicitHex && hex) return { value: parseInt(hex[1], 16), base: 'hex' };
  if (/^\d+$/.test(t)) return { value: parseInt(t, 10), base: 'dec' };
  return { error: 'Enter a hexadecimal (2103H, 0x2103) or decimal (8451) number.' };
}

export function AddressConverter() {
  const [hexIn, setHexIn] = useState('2103H');
  const [decIn, setDecIn] = useState('');
  const h = parseAddr(hexIn);
  const d = decIn.trim() ? (/^\d+$/.test(decIn.trim()) ? parseInt(decIn.trim(), 10) : NaN) : null;
  const hv = 'value' in h ? h.value : null;
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Modbus & RS485' }, { label: 'Address Converter' }]} />
      <h1>Modbus Address Converter</h1>
      <p className="muted prose">Performs <b>mathematical base conversion only</b>. It does not decide that a result is a valid PLC address, a 3xxxx/4xxxx reference, or a zero- or one-based register — that depends on the specific drive communication manual and the PLC instruction used.</p>
      <div className="grid2">
        <div className="card">
          <h3>HEX → Decimal</h3>
          <div className="field"><label htmlFor="hx">Hexadecimal (e.g. 2103H, 0x2103)</label><input id="hx" value={hexIn} onChange={(e) => setHexIn(e.target.value)} className="mono" /></div>
          {'error' in h && h.error ? <div className="err">{h.error}</div> : hv !== null && (
            <table><tbody>
              <tr><th>Original (kept unchanged)</th><td className="code">{hexIn.trim()}</td></tr>
              <tr><th>Decimal</th><td className="code">{hv}</td></tr>
              <tr><th>Calculation</th><td className="code">0x{hv.toString(16).toUpperCase()} = {hv}</td></tr>
              <tr><th>Binary</th><td className="code">{hv.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim()}</td></tr>
            </tbody></table>)}
        </div>
        <div className="card">
          <h3>Decimal → HEX</h3>
          <div className="field"><label htmlFor="dc">Decimal (e.g. 8451)</label><input id="dc" value={decIn} onChange={(e) => setDecIn(e.target.value)} className="mono" /></div>
          {d !== null && (Number.isNaN(d) ? <div className="err">Enter a non-negative whole number.</div> : (
            <table><tbody>
              <tr><th>Original (kept unchanged)</th><td className="code">{decIn.trim()}</td></tr>
              <tr><th>Hexadecimal</th><td className="code">0x{d.toString(16).toUpperCase().padStart(4, '0')}</td></tr>
              <tr><th>Calculation</th><td className="code">{d} = 0x{d.toString(16).toUpperCase()}</td></tr>
            </tbody></table>))}
        </div>
      </div>
      <h2 style={{ marginTop: 22 }}>Address representations are not interchangeable <InfoIcon text="Never add 40001 (or any offset) unless the drive manual AND your PLC communication instruction both state that convention." /></h2>
      <div className="table-wrap"><table><thead><tr><th>Term</th><th>Meaning</th><th>Who defines it</th></tr></thead><tbody>
        <tr><td><b>Manufacturer register address</b></td><td>The address exactly as printed in the drive’s manual (e.g. <span className="mono">2103H</span>, <span className="mono">40100</span>). Preserved unchanged in this application.</td><td>Drive manufacturer manual</td></tr>
        <tr><td><b>Modbus PDU address</b></td><td>The 16-bit address field transmitted inside the Modbus request (zero-based numbering of the data model).</td><td>Modbus protocol</td></tr>
        <tr><td><b>One-based register number</b></td><td>A human-oriented numbering where the first register is 1. May differ from the PDU address by 1.</td><td>Vendor documentation / PLC tool</td></tr>
        <tr><td><b>3xxxx / 4xxxx reference</b></td><td>A legacy notation combining object type and a number (e.g. “4xxxx” holding registers).</td><td>Only where a manual explicitly uses it</td></tr>
        <tr><td><b>PLC instruction address</b></td><td>What you type into the PLC communication instruction (e.g. a data pointer / starting address parameter). Its numbering convention is defined by the PLC vendor.</td><td>PLC vendor documentation</td></tr>
      </tbody></table></div>
      <p className="muted small-text">See <Link to="/modbus/plc">PLC Integration</Link> for what is documented about Siemens S7-1200 communication instructions in the imported documents.</p>
    </div>
  );
}

export function CommSettings() {
  const { data } = useAsync(() => get('/parameters', { category: 'modbus-rs485', limit: 500 }), []);
  const { data: models } = useAsync(() => get('/models'), []);
  const [model, setModel] = useState('');
  const rows = data?.rows.filter((p: any) => !model || String(p.model_id) === model) ?? [];
  const byFn = new Map<string, any[]>();
  rows.forEach((p: any) => byFn.set(p.function_name ?? 'Unmapped', [...(byFn.get(p.function_name ?? 'Unmapped') ?? []), p]));
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Modbus & RS485' }, { label: 'Communication Settings' }]} />
      <h1>Communication Settings</h1>
      <p className="muted">Slave address, baud rate, parity/stop bits, timeouts and loss behavior — only parameters from approved records.</p>
      <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" style={{ marginBottom: 12 }}><option value="">All models</option>{models?.map((m: any) => <option key={m.id} value={m.id}>{m.brand} {m.name}</option>)}</select>
      <div className="table-wrap"><table><thead><tr><th>Function</th><th>Brand / Model</th><th>Code</th><th>Name</th><th>Default</th><th>Range</th><th>Verification</th></tr></thead><tbody>
        {rows.map((p: any) => <tr key={p.id}><td>{p.function_name ?? '—'}</td><td>{p.brand} <span className="muted">{p.model}</span></td><td className="code"><Link to={`/parameter/${p.id}`}>{p.code}</Link></td><td>{p.name}</td><td>{p.default_value ?? <span className="faint">Not Documented</span>}</td><td>{p.min_value || p.max_value ? `${p.min_value ?? '?'} … ${p.max_value ?? '?'}` : <span className="faint">Not Documented</span>}</td><td><span className="badge dashed">{p.verification_status}</span></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="empty">No communication parameters approved yet.</td></tr>}
      </tbody></table></div>
    </div>
  );
}

const S7_TOPICS = ['MB_COMM_LOAD', 'MB_MASTER', 'Modbus RTU communication module configuration (CM 1241 RS485 / CB 1241)', 'Register addressing convention (MODE / DATA_ADDR)', 'Function code selection', 'Data pointer (DATA_PTR) configuration', 'Data type handling', 'Read / write operations', 'Communication status (DONE / BUSY / ERROR / STATUS)', 'Error handling', 'TIA Portal / firmware version differences'];

export function PlcIntegration() {
  const [term, setTerm] = useState('MB_MASTER');
  const { data } = useAsync(() => get('/search', { q: term }), [term]);
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Modbus & RS485' }, { label: 'PLC Integration (Siemens S7-1200)' }]} />
      <h1>PLC Integration — Siemens S7-1200</h1>
      <div className="ok-box prose"><b>No Siemens S7-1200 / TIA Portal documentation has been imported into this database.</b> To avoid inventing instruction parameters or address conventions, none are shown here. Import the relevant Siemens PLC communication manuals (Documentation Library → Import) and they become searchable below, with page references.</div>
      <h2>Topics to document (status)</h2>
      <div className="table-wrap"><table><thead><tr><th>Topic</th><th>Status</th></tr></thead><tbody>{S7_TOPICS.map((t) => <tr key={t}><td>{t}</td><td><span className="badge dashed">Not Documented</span></td></tr>)}</tbody></table></div>
      <h2 style={{ marginTop: 20 }}>Search imported documents</h2>
      <div className="row"><input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search imported documents" style={{ minWidth: 280 }} /></div>
      <div className="stack" style={{ marginTop: 10 }}>
        {data?.pages?.map((p: any) => <div className="card" key={p.page_id}><Link to={`/library/revision/${p.revision_id}/page/${p.page_index}`}>{p.document_title} — page {p.page_index}</Link> <span className="badge dashed">{p.text_source}</span><div className="snippet small-text" dangerouslySetInnerHTML={{ __html: esc(p.snippet) }} /></div>)}
        {data && !data.pages?.length && <p className="muted">No page in the imported documents mentions “{term}”.</p>}
      </div>
    </div>
  );
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
export const escSnippet = esc;
