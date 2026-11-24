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
