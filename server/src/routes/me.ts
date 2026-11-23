import { Router } from 'express';
import { ah, badRequest } from '../lib/http.js';
import { getUserSettings, setUserSetting, USER_SETTING_DEFAULTS } from '../services/settings.js';
import { storageUsage } from '../services/storage.js';
import { userLimits } from '../services/settings.js';

/** Current user's own preferences & storage. The user id always comes from the session, never the request. */
export const meRouter = Router();

const COLORS = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'];

function validate(key: string, v: any) {
  switch (key) {
    case 'annotation_display':
      if (typeof v !== 'object' || v === null) throw badRequest('annotation_display must be an object');
      return { showOthersPublic: v.showOthersPublic !== false, showOwn: v.showOwn !== false, showHighlightBackgrounds: v.showHighlightBackgrounds !== false };
    case 'highlight_mode':
      return !!v;
    case 'default_highlight_color':
      if (!COLORS.includes(v)) throw badRequest('invalid color');
      return v;
    case 'split_view': {
      const ratio = Number(v?.ratio);
      return {
        enabled: !!v?.enabled,
        ratio: Number.isFinite(ratio) ? Math.min(0.85, Math.max(0.15, ratio)) : 0.55,
        collapsed: v?.collapsed === 'left' || v?.collapsed === 'right' ? v.collapsed : null,
      };
    }
    case 'language':
      if (!['en', 'bn'].includes(v)) throw badRequest('language must be en or bn');
      return v;
    case 'theme':
      if (!['light', 'dark'].includes(v)) throw badRequest('theme must be light or dark');
      return v;
    case 'explanation_levels_open':
      if (!Array.isArray(v)) throw badRequest('must be an array');
      return v.filter((x) => typeof x === 'string').slice(0, 10);
    default:
      throw badRequest(`Unknown setting: ${key}`);
  }
}

meRouter.get('/settings', ah(async (req, res) => res.json(getUserSettings(req.user!.id))));

meRouter.patch(
  '/settings',
  ah(async (req, res) => {
    const body = req.body ?? {};
    if ('userId' in body || 'user_id' in body) throw badRequest('user id cannot be supplied');
    for (const [k, v] of Object.entries(body)) {
      if (!(k in USER_SETTING_DEFAULTS)) throw badRequest(`Unknown setting: ${k}`);
      setUserSetting(req.user!.id, k, validate(k, v));
    }
    res.json(getUserSettings(req.user!.id));
  }),
);

meRouter.get(
  '/storage',
  ah(async (req, res) => {
    const lim = userLimits(req.user!.id);
    const u = storageUsage(req.user!.id);
    res.json({ ...u, quota: lim.quotaBytes, remaining: Math.max(0, lim.quotaBytes - u.total), percent: lim.quotaBytes ? +((u.total / lim.quotaBytes) * 100).toFixed(2) : 0, maxFileBytes: lim.maxFileBytes });
  }),
);
