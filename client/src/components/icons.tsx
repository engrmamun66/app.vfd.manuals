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
