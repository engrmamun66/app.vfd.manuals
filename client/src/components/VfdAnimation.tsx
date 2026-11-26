import './vfd-anim.css';

const ROWS = [230, 255, 280];
/** VFD U/V/W terminals → terminal-box glands of the motor (no crossings: nested routes) */
const OUT_PATHS = ['M440 230 H520 V150 H660 V182', 'M440 255 H535 V164 H639 V182', 'M440 280 H550 V178 H618 V182'];

/**
 * Looping 18.4 s explainer (~8 s wiring, then 10 s of the motor running): a VFD and an HMI appear, power and motor wires are drawn, current flows, the motor spins up
 * and the HMI counts 0 → 50 Hz, then holds 50 Hz; at the end everything fades and the cycle restarts from zero. Pure SVG + CSS (no JS timers).
 */
export function VfdAnimation() {
  return (
    <div className="vfd-anim" role="img" aria-label="Animation: a VFD with an HMI is wired to a three-phase supply and an industrial motor; current flows and the motor runs.">
      <svg viewBox="0 0 800 420" aria-hidden="true">
        <line className="stroke dim" x1="30" y1="332" x2="780" y2="332" strokeDasharray="4 6" />

        {/* 3-phase supply */}
        <g className="src">
          <rect className="body" x="20" y="212" width="66" height="86" rx="6" />
          <text className="txt" x="53" y="248" textAnchor="middle">3~</text>
          <text className="txt sm" x="53" y="266" textAnchor="middle">400 V</text>
          <text className="txt sm" x="53" y="282" textAnchor="middle">SUPPLY</text>
        </g>

        {/* HMI */}
        <g className="hmi">
          <rect className="body" x="230" y="40" width="180" height="110" rx="8" />
          <rect className="screen" x="244" y="54" width="152" height="64" rx="4" />
          <text className="txt sm stop" x="256" y="72" style={{ fill: '#ff9a9a' }}>STOP</text>
          <text className="txt sm run" x="256" y="72" style={{ fill: '#8dffb4' }}>RUN ▶</text>
          {['0.0', '10.0', '20.0', '30.0', '40.0', '50.0'].map((f, i) => (
            <text key={f} className={`txt big f${i}`} x="256" y="102">{f}<tspan fontSize="11" dx="3">Hz</tspan></text>
          ))}
          <path className="wave run" d="M338 96 q8 -16 16 0 t16 0 t16 0" />
          {[270, 320, 370].map((x) => <circle key={x} cx={x} cy="134" r="6" className="stroke" />)}
        </g>
        <path className="wire hmicable" pathLength={1} d="M320 150 V190" />

        {/* VFD */}
        <g className="vfd">
          <rect className="body" x="200" y="190" width="240" height="140" rx="8" />
          <text className="txt" x="320" y="218" textAnchor="middle">VFD</text>
          <text className="txt sm" x="320" y="234" textAnchor="middle">VARIABLE FREQUENCY DRIVE</text>
          {[262, 272, 282, 292, 302, 312].map((y) => <line key={y} className="stroke dim" x1="240" y1={y} x2="400" y2={y} />)}
          <circle className="led" cx="418" cy="208" r="5" />
        </g>

        {/* terminals + letters */}
        <g className="lbl">
          {ROWS.map((y, i) => (
            <g key={y}>
              <circle className="body" cx="200" cy={y} r="7" />
              <text className="txt sm" x="200" y={y + 3} textAnchor="middle" style={{ fill: '#fff' }}>{'RST'[i]}</text>
              <circle className="body" cx="440" cy={y} r="7" />
              <text className="txt sm" x="440" y={y + 3} textAnchor="middle" style={{ fill: '#fff' }}>{'UVW'[i]}</text>
              <circle className="body" cx="86" cy={y} r="5" />
            </g>
          ))}
        </g>

        {/* industrial motor: ribbed frame, cooling-fan cover, terminal box with glands, feet, nameplate, shaft + spinning flywheel */}
        <g className="motor">
          <rect className="body" x="546" y="228" width="26" height="56" rx="7" />
          {[236, 244, 252, 260, 268, 276].map((y) => <line key={y} className="stroke dim" x1="551" y1={y} x2="567" y2={y} />)}
          <rect className="body" x="570" y="214" width="122" height="84" rx="10" />
          {[582, 592, 602, 612, 622, 632, 642, 652, 662, 672, 682].map((x) => <line key={x} className="stroke dim" x1={x} y1="220" x2={x} y2="292" />)}
          <rect className="body" x="690" y="222" width="18" height="68" rx="5" />
          <rect className="body" x="606" y="188" width="66" height="26" rx="3" />
          {[618, 639, 660].map((x) => <rect key={x} className="body" x={x - 5} y="181" width="10" height="8" rx="2" />)}
          <rect className="body" x="618" y="256" width="40" height="26" rx="3" style={{ fill: '#222' }} />
          <text className="txt sm" x="638" y="267" textAnchor="middle" style={{ fontSize: 8 }}>3~ MOTOR</text>
          <text className="txt sm" x="638" y="278" textAnchor="middle" style={{ fontSize: 8, fill: '#ffd24a' }}>1.5 kW</text>
          <rect className="body" x="574" y="298" width="114" height="10" rx="2" />
          <rect className="body" x="566" y="308" width="130" height="8" rx="2" />
          <circle cx="580" cy="303" r="2" style={{ fill: '#f2f2f2' }} /><circle cx="682" cy="303" r="2" style={{ fill: '#f2f2f2' }} />
          <rect className="body" x="708" y="250" width="22" height="10" rx="2" />
          <g className="fan">
            <circle className="body" cx="754" cy="255" r="30" />
            <circle className="stroke dim" cx="754" cy="255" r="22" />
            {[0, 60, 120].map((a) => <line key={a} className="stroke" x1="754" y1="225" x2="754" y2="285" style={{ strokeWidth: 3 }} transform={`rotate(${a} 754 255)`} />)}
            <circle cx="754" cy="236" r="3.5" style={{ fill: '#ffd24a' }} />
            <circle className="body" cx="754" cy="255" r="7" />
          </g>
        </g>

        {/* wires */}
        {ROWS.map((y, i) => <path key={`in${i}`} className={`wire in${'ABC'[i]}`} pathLength={1} d={`M86 ${y} H200`} />)}
        {OUT_PATHS.map((d, i) => <path key={`out${i}`} className={`wire out${'UVW'[i]}`} pathLength={1} d={d} />)}

        {/* electricity */}
        {ROWS.map((y, i) => <path key={`fi${i}`} className="flow flowIn" pathLength={1} d={`M86 ${y} H200`} />)}
        {OUT_PATHS.map((d, i) => <path key={`fo${i}`} className="flow flowOut" pathLength={1} d={d} />)}
      </svg>
      <div className="vfd-captions" aria-hidden="true">
        <span className="cap1">1 · Mount the VFD and the HMI</span>
        <span className="cap2">2 · Wire the 3-phase power input</span>
        <span className="cap3">3 · Wire the motor outputs U / V / W</span>
        <span className="cap4">4 · Power on — current flows</span>
        <span className="cap5">5 · Motor running at 50 Hz</span>
      </div>
    </div>
  );
}
