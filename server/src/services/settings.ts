import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { parseJson } from '../lib/util.js';

/** Global application settings (Super Admin controlled). */
export const APP_SETTING_DEFAULTS: Record<string, unknown> = {
  registration_enabled: true,
  app_title: 'VFD Knowledge Base & Technical Research Explorer',
  default_language: 'en',
  allowed_image_types: ['image/jpeg', 'image/png', 'image/webp'],
};

export function getAppSetting<T = unknown>(key: string): T {
  const row = getDb().prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as { value_json: string } | undefined;
  return (row ? parseJson(row.value_json, APP_SETTING_DEFAULTS[key]) : APP_SETTING_DEFAULTS[key]) as T;
}
export function getAllAppSettings() {
  const out: Record<string, unknown> = { ...APP_SETTING_DEFAULTS };
  for (const r of getDb().prepare('SELECT key, value_json FROM app_settings').all() as { key: string; value_json: string }[])
    out[r.key] = parseJson(r.value_json, null);
  return out;
}
export function setAppSetting(key: string, value: unknown, userId: number) {
  getDb()
    .prepare(
      `INSERT INTO app_settings(key, value_json, updated_by_user_id, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by_user_id=excluded.updated_by_user_id, updated_at=excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), userId, new Date().toISOString());
}

/** Per-user preferences (layout, annotation display, language...). Keys are allowlisted. */
export const USER_SETTING_DEFAULTS: Record<string, unknown> = {
  annotation_display: { showOthersPublic: true, showOwn: true, showHighlightBackgrounds: true },
  highlight_mode: true,
  default_highlight_color: 'yellow',
  split_view: { enabled: false, ratio: 0.55, collapsed: null },
  language: 'en',
  theme: 'light',
  explanation_levels_open: ['short'],
  selected_model: null, // model id used as the global filter on every page (null = all models)
  model_aliases: {}, // { [modelId]: short tab label }
  ui_settings: { show_verification_filter: false, show_evidence_filter: false, show_export_csv: false, show_export_json: false }, // optional list filters / export buttons, hidden by default
  page_transition_ms: 300, // duration of that animation in milliseconds
  page_transition: 'none', // animation played when navigating between pages
  model_order: [], // personal tab/list order: model ids, first = leftmost
  hidden_models: [], // model ids switched Off (not shown as tabs)
};

export function getUserSettings(userId: number) {
  const out: Record<string, unknown> = structuredClone(USER_SETTING_DEFAULTS);
  for (const r of getDb().prepare('SELECT key, value_json FROM user_settings WHERE user_id = ?').all(userId) as { key: string; value_json: string }[])
    if (r.key in USER_SETTING_DEFAULTS) out[r.key] = parseJson(r.value_json, USER_SETTING_DEFAULTS[r.key]);
  return out;
}
export function setUserSetting(userId: number, key: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO user_settings(user_id, key, value_json, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    )
    .run(userId, key, JSON.stringify(value), new Date().toISOString());
}

export function userLimits(userId: number) {
  const r = getDb().prepare('SELECT * FROM user_storage_limits WHERE user_id = ?').get(userId) as any;
  return {
    quotaBytes: r?.quota_bytes ?? config.defaultQuotaBytes,
    maxFileBytes: r?.max_file_bytes ?? config.defaultMaxUploadBytes,
    maxAttachmentsPerComment: r?.max_attachments_per_comment ?? config.defaultMaxAttachments,
  };
}
