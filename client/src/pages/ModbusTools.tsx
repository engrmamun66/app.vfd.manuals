import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api';
import { Crumbs, InfoIcon, useAsync, ModelName } from '../components/ui';
import { ModelTabs } from '../components/ModelTabs';
import { OriginalPdfButton } from '../components/OriginalPdfButton';
import { useModels } from '../lib/models';

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
    </div>
  );
}

export function CommSettings() {
  const { data } = useAsync(() => get('/parameters', { category: 'modbus-rs485', limit: 500 }), []);
  const { selected } = useModels();
  const rows = data?.rows.filter((p: any) => selected == null || p.model_id === selected) ?? [];
  const byFn = new Map<string, any[]>();
  rows.forEach((p: any) => byFn.set(p.function_name ?? 'Unmapped', [...(byFn.get(p.function_name ?? 'Unmapped') ?? []), p]));
  return (
    <div className="page">
      <Crumbs items={[{ label: 'Modbus & RS485' }, { label: 'Communication Settings' }]} />
      <div className="row between" style={{ marginBottom: 8 }}><h1 style={{ margin: 0 }}>Communication Settings</h1><OriginalPdfButton /></div>
      <p className="muted">Slave address, baud rate, parity/stop bits, timeouts and loss behavior — only parameters from approved records.</p>
      <ModelTabs />
      <div className="table-wrap"><table><thead><tr><th>Function</th><th>Brand / Model</th><th>Code</th><th>Name</th><th>Default</th><th>Range</th><th>Verification</th></tr></thead><tbody>
        {rows.map((p: any) => <tr key={p.id}><td>{p.function_name ?? '—'}</td><td>{p.brand} <span className="muted"><ModelName name={p.model} /></span></td><td className="code"><Link to={`/parameter/${p.id}`}>{p.code}</Link></td><td>{p.name}</td><td>{p.default_value ?? <span className="faint">Not Documented</span>}</td><td>{p.min_value || p.max_value ? `${p.min_value ?? '?'} … ${p.max_value ?? '?'}` : <span className="faint">Not Documented</span>}</td><td><span className="badge dashed">{p.verification_status}</span></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="empty">No communication parameters approved yet.</td></tr>}
      </tbody></table></div>
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
export const escSnippet = esc;
