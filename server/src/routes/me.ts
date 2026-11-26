import { Router } from 'express';
import { ah, badRequest } from '../lib/http.js';
import { getDb } from '../db/index.js';
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
      if (!['light', 'dark', 'system'].includes(v)) throw badRequest('theme must be light, dark or system');
      return v;
    case 'accent':
      if (!['mono', 'blue', 'green', 'red', 'orange', 'purple', 'teal'].includes(v)) throw badRequest('invalid accent');
      return v;
    case 'page_transition_ms': {
      const ms = Number(v);
      if (!Number.isFinite(ms)) throw badRequest('page_transition_ms must be a number');
      return Math.min(2000, Math.max(100, Math.round(ms)));
    }
    case 'page_transition':
      if (!['none', 'fade', 'slide-up', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'blur', 'flip'].includes(v)) throw badRequest('invalid page_transition');
      return v;
    case 'explanation_levels_open':
      if (!Array.isArray(v)) throw badRequest('must be an array');
      return v.filter((x) => typeof x === 'string').slice(0, 10);
    case 'selected_model': {
      if (v === null) return null;
      const id = Number(v);
      if (!Number.isInteger(id) || !getDb().prepare('SELECT 1 FROM models WHERE id = ?').get(id)) throw badRequest('unknown model');
      return id;
    }
    case 'ui_settings': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw badRequest('ui_settings must be an object');
      return { show_verification_filter: v.show_verification_filter === true, show_evidence_filter: v.show_evidence_filter === true, show_export_csv: v.show_export_csv === true, show_export_json: v.show_export_json === true, show_searchable_text: v.show_searchable_text === true, importance_filter_style: v.importance_filter_style === 'stars' ? 'stars' : 'dropdown', access_filter_style: v.access_filter_style === 'buttons' ? 'buttons' : 'dropdown', selection_menu_autohide: v.selection_menu_autohide !== false, show_verification_column: v.show_verification_column !== false };
    }
    case 'model_order':
      if (!Array.isArray(v)) throw badRequest('model_order must be an array');
      return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
    case 'hidden_models':
      if (!Array.isArray(v)) throw badRequest('hidden_models must be an array');
      return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
    case 'model_aliases': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw badRequest('model_aliases must be an object');
      const out: Record<string, string> = {};
      for (const [k, a] of Object.entries(v)) {
        if (!/^\d+$/.test(k)) throw badRequest('invalid model id');
        const alias = String(a ?? '').trim();
        if (!alias) continue; // empty = no alias (tab shows the model name)
        if (alias.length > 16) throw badRequest('alias must be at most 16 characters');
        out[k] = alias;
      }
      return out;
    }
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
