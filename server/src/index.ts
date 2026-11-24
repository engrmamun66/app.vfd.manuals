import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { bootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { attachPresence } from './services/presence.js';

async function main() {
  await bootstrap();
  const prod = config.isProd || process.argv.includes('--prod');
  const app = createApp({ dev: !prod });
  const server = http.createServer(app);
  attachPresence(server);

  const clientRoot = path.join(config.root, 'client');
  const dist = path.join(config.root, 'dist', 'client');
  if (prod) {
    if (!fs.existsSync(dist)) throw new Error('dist/client not found — run `npm run build` first');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    // dev: Vite in middleware mode on the same port (single URL: http://localhost:3000)
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(clientRoot, 'vite.config.ts'),
      root: clientRoot,
      server: { middlewareMode: true, hmr: { server }, allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.ngrok.io'] }, // tunnel hosts (cloudflared / ngrok)
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`
Port ${config.port} is already in use — the app is probably already running at http://localhost:${config.port}.
Stop the other instance, or set a different PORT in .env.`);
      process.exit(1);
    }
    throw e;
  });
  server.listen(config.port, config.host, () => {
    console.log(`\nVFD Knowledge Base running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`Database: ${config.dbPath}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
