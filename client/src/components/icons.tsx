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
  '/modbus/registers': 'M3 5h18v14H3zM3 10h18M9 5v14',
  '/modbus/communication': 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h0M2 9a15 15 0 0 1 20 0',
  '/modbus/converter': 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  '/compare': 'M4 4h6v16H4zM14 4h6v16h-6z',
  '/bookmarks': 'M6 3h12v18l-6-4-6 4z',
  '/annotations': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  '/library': 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  '/library/import': 'M12 15V3M7 8l5-5 5 5M4 17v3h16v-3',
  '/verification': 'M20 6L9 17l-5-5',
  '/admin/content': 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  '/admin/users': 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  '/admin/requests': 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  '/admin/logs': 'M22 12h-4l-3 9L9 3l-3 9H2',
};
export const NavIcon = ({ to }: { to: string }) => NAV_PATHS[to] ? <svg {...nb} className="nav-ico"><path d={NAV_PATHS[to]} /></svg> : null;
