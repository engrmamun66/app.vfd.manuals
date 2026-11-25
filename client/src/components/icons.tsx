const base = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const SplitIcon = ({ on }: { on?: boolean }) => (
  <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" />{on && <rect x="3" y="4" width="9" height="16" fill="currentColor" stroke="none" />}</svg>
);
export const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg {...base}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{off && <path d="M4 20L20 4" />}</svg>
);
export const BookmarkIcon = () => (
  <svg {...base}><path d="M6 3h12v18l-6-4-6 4z" /></svg>
);

export const SunIcon = () => (
  <svg {...base} width={15} height={15}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
);
export const MoonIcon = () => (
  <svg {...base} width={15} height={15}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const MonitorIcon = () => (
  <svg {...base} width={15} height={15}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
);
export const StarIcon = ({ filled = true, size = 14 }: { filled?: boolean; size?: number }) => (
  <svg {...base} width={size} height={size} fill={filled ? 'currentColor' : 'none'}><path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z" /></svg>
);

const nb = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const NAV_PATHS: Record<string, string> = {
  '/': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  '/parameters': 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  '/knowledge': 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.6-.6-2.1z',
  '/knowledge/fault': 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h0',
  '/knowledge/alarm': 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  '/knowledge/warning': 'M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM12 8v4M12 16h0',
  '/knowledge/troubleshooting': 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.6-.6-2.1z',
  '/knowledge/wiring': 'M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z',
  '/knowledge/installation': 'M12 2l9 4.5v11L12 22l-9-4.5v-11zM12 22V11M3 6.5l9 4.5 9-4.5',
  '/knowledge/safety': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  '/knowledge/specification': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  '/knowledge/communication': 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h0M2 9a15 15 0 0 1 20 0',
  '/knowledge/maintenance': 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  '/knowledge/note': 'M4 4h16v12H8l-4 4z',
  '/modbus/registers': 'M3 5h18v14H3zM3 10h18M9 5v14',
  '/modbus/communication': 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h0M2 9a15 15 0 0 1 20 0',
  '/modbus/converter': 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  '/compare': 'M4 4h6v16H4zM14 4h6v16h-6z',
  '/bookmarks': 'M6 3h12v18l-6-4-6 4z',
  '/annotations': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  '/library': 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  '/superadmin/subscriptions': 'M12 2l3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5L7 14.5l-5-5 7-1z',
  '/superadmin/payments': 'M2 6h20v12H2zM2 10h20M6 15h4',
  '/superadmin/premium': 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
  '/superadmin/verification': 'M20 6L9 17l-5-5',
  '/superadmin/content': 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  '/superadmin/users': 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  '/superadmin/requests': 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  '/superadmin/logs': 'M22 12h-4l-3 9L9 3l-3 9H2',
};
export const NavIcon = ({ to }: { to: string }) => NAV_PATHS[to] ? <svg {...nb} className="nav-ico"><path d={NAV_PATHS[to]} /></svg> : null;
