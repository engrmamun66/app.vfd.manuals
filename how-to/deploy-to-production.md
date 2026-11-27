# Deploy to production

Migration alone is NOT enough: manual data lives in the local DB, so upload it too.

## 1. Local (Windows) — prepare files

Stop the local server first, then:

```bash
npm run backup
node -e "const D=require('better-sqlite3');const d=new D('database/vfd-knowledge.db');d.pragma('wal_checkpoint(TRUNCATE)');d.close()"
```

Upload to the server (same relative paths). `vfd-manuals/` PDFs come with `git clone`, no upload needed:

- `database/vfd-knowledge.db`
- `storage/` (only if you want existing user uploads/receipts)

## 2. Server — first time

```bash
git clone https://github.com/engrmamun66/app.vfd.manuals.git
cd app.vfd.manuals
git checkout develop
npm ci
cp .env.example .env
nano .env
```

Set in `.env`:

```
NODE_ENV=production
PORT=2234
COOKIE_SECURE=true
PUBLIC_URL=https://your-domain.com
GOOGLE_CLIENT_ID=...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
NOTIFY_EMAIL=...
```

Copy the uploaded `database/vfd-knowledge.db` (and `storage/` if uploaded) into the project folder.

## 3. Build, migrate, start

```bash
npm run build
npm run migrate
npm start
```

Keep it running with pm2:

```bash
npm i -g pm2
pm2 start "npm start" --name vfd
pm2 save
pm2 startup
```

## 4. Later updates

```bash
git pull
npm ci
npm run build
npm run migrate
pm2 restart vfd
```

## 5. Google login

Google Cloud Console → Credentials → your OAuth client → **Authorized JavaScript origins** → add `https://your-domain.com`.

## Notes

- Local DB includes users, payments, subscriptions. Upload it only if you want them on the server.
- `.env` and `*.db` are gitignored. Never commit them.
- Back up on the server: `npm run backup`.
