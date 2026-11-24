import express from 'express';
import helmet from 'helmet';
import { requireAuth, requireCsrf, requireSuperAdmin } from './auth/middleware.js';
import { errorHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { kbRouter } from './routes/kb.js';
import { docsRouter } from './routes/documents.js';
import { bookmarksRouter } from './routes/bookmarks.js';
import { annotationsRouter } from './routes/annotations.js';
import { adminRouter } from './routes/admin.js';
import { meRouter } from './routes/me.js';
import { exportsRouter } from './routes/exports.js';
import { feedbackRouter } from './routes/feedback.js';
import { userCategoriesRouter } from './routes/userCategories.js';

export function createApp(opts: { dev?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false); // client IP logic is in auth/clientIp.ts (explicit trusted proxies only)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // dev only: Vite injects an inline React-refresh preamble. Production keeps script-src 'self'.
          'script-src': opts.dev ? ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"] : ["'self'", "'wasm-unsafe-eval'"],
          'worker-src': ["'self'", 'blob:'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.use('/auth', authRouter);
  // everything below requires a valid session + CSRF token on writes (no anonymous access, §35.1)
  api.use(requireAuth(), requireCsrf);
  api.use('/me', meRouter);
  api.use('/bookmarks', bookmarksRouter);
  api.use('/feedback', feedbackRouter);
  api.use('/my-categories', userCategoriesRouter);
  api.use('/annotations', annotationsRouter);
  api.use('/export', exportsRouter);
  api.use('/admin', requireSuperAdmin, adminRouter);
  api.use(kbRouter);
  api.use(docsRouter);
  api.use((_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use('/api', api);
  app.use('/api', errorHandler);
  return app;
}
