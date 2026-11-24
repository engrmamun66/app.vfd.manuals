import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from server/src (tsx) and dist-server/server/src (compiled)
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (path.basename(dir) === 'server' && path.basename(path.dirname(dir)) !== 'dist-server') return path.dirname(dir);
    if (path.basename(dir) === 'dist-server') return path.dirname(dir);
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const ROOT = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : findRoot(here);

export const config = {
  root: ROOT,
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === 'production',
  functionLinksFile: path.join(ROOT, 'data', 'function-links.json'),
  dbPath: process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(ROOT, 'database', 'vfd-knowledge.db'),
  backupDir: path.join(ROOT, 'database', 'backups'),
  manualsDir: process.env.MANUALS_DIR ? path.resolve(process.env.MANUALS_DIR) : path.join(ROOT, 'vfd-manuals'),
  storageDir: process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.join(ROOT, 'storage'),
  curatedDir: path.join(ROOT, 'data', 'curated'),
  taxonomyFile: path.join(ROOT, 'data', 'taxonomy.json'),
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 7),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  regRateMax: int(process.env.REGISTRATION_RATE_LIMIT_MAX, 3),
  regRateWindowMin: int(process.env.REGISTRATION_RATE_LIMIT_WINDOW_MINUTES, 60),
  loginRateMax: int(process.env.LOGIN_RATE_LIMIT_MAX, 10),
  loginRateWindowMin: int(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 15),
  trustedProxies: (process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean),
  initialAdminEmail: process.env.INITIAL_SUPERADMIN_EMAIL || '',
  initialAdminPassword: process.env.INITIAL_SUPERADMIN_PASSWORD || '',
  defaultQuotaBytes: int(process.env.DEFAULT_USER_QUOTA_BYTES, 500 * 1024 * 1024),
  defaultMaxUploadBytes: int(process.env.DEFAULT_MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  defaultMaxAttachments: int(process.env.DEFAULT_MAX_ATTACHMENTS_PER_COMMENT, 8),
  sessionCookie: 'vfdkb_sid',
};

export const storagePaths = {
  extractedText: () => path.join(config.storageDir, 'extracted-text'),
  pageImages: () => path.join(config.storageDir, 'page-images'),
  thumbnails: () => path.join(config.storageDir, 'thumbnails'),
  ocrResults: () => path.join(config.storageDir, 'ocr-results'),
  system: () => path.join(config.storageDir, 'system'),
  users: () => path.join(config.storageDir, 'users'),
  uploadsTmp: () => path.join(config.storageDir, 'system', 'tmp-uploads'),
  importedManuals: () => path.join(config.storageDir, 'manuals'),
};
