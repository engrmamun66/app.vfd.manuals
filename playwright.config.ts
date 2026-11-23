import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// unique dir per run: a leftover server holding an old DB can never leak state (e.g. login rate-limit hits) into a new run
const tmp = path.join(os.tmpdir(), `vfdkb-e2e-${process.env.E2E_RUN_ID ?? (process.env.E2E_RUN_ID = String(Date.now()))}`);
const env = {
  DB_PATH: path.join(tmp, 'e2e.db'),
  STORAGE_DIR: path.join(tmp, 'storage'),
  PORT: '3077',
  INITIAL_SUPERADMIN_EMAIL: 'root@e2e.test',
  INITIAL_SUPERADMIN_PASSWORD: 'Initial-Pass-9876!',
  REGISTRATION_RATE_LIMIT_MAX: '100',
  LOGIN_RATE_LIMIT_MAX: '1000',
};

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3077', viewport: { width: 1600, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node -e "require(\'fs\').rmSync(process.env.DB_PATH.replace(/e2e\.db$/,\'\'),{recursive:true,force:true});require(\'fs\').mkdirSync(process.env.DB_PATH.replace(/e2e\.db$/,\'\'),{recursive:true})" && npx tsx tests/e2e/seed.ts && npx tsx server/src/index.ts',
    url: 'http://127.0.0.1:3077/api/auth/registration-status',
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ...process.env as Record<string, string>, ...env },
  },
});
