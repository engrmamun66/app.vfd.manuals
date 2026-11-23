import type { Request } from 'express';

/**
 * Content display rules (Admin panel) live in `content_display`, separate from technical data.
 * Hidden items are never deleted; they are filtered from normal views only.
 */
export type DisplayEntity = 'brand' | 'model' | 'category' | 'common_function' | 'parameter' | 'modbus_register' | 'document';

export function includeHidden(req: Request) {
  return req.user?.role === 'super_admin' && (req.query.includeHidden === '1' || req.query.includeHidden === 'true');
}

/** SQL fragment: LEFT JOIN content_display for an entity alias. */
export function cdJoin(type: DisplayEntity, alias: string, cd: string) {
  return `LEFT JOIN content_display ${cd} ON ${cd}.entity_type = '${type}' AND ${cd}.entity_id = ${alias}.id`;
}
/** SQL fragment: visible + active (optionally search-visible). */
export function cdVisible(cd: string, extra: 'search' | 'nav' | 'dashboard' | null = null) {
  const base = `COALESCE(${cd}.visible,1) = 1 AND COALESCE(${cd}.active,1) = 1`;
  if (extra === 'search') return `${base} AND COALESCE(${cd}.show_search,1) = 1`;
  if (extra === 'nav') return `${base} AND COALESCE(${cd}.show_nav,1) = 1`;
  if (extra === 'dashboard') return `${base} AND COALESCE(${cd}.show_dashboard,1) = 1`;
  return base;
}
export const cdOrder = (cd: string) => `COALESCE(${cd}.display_order, 1000)`;
