# VFD Knowledge Base & Technical Research Explorer

Local, multi-user web app: Node.js + Express + SQLite (`better-sqlite3`) + React/Vite. All technical facts come from the manuals in `vfd-manuals/`; nothing is invented.

## Install & run

```bash
npm install
cp .env.example .env        # set INITIAL_SUPERADMIN_EMAIL / INITIAL_SUPERADMIN_PASSWORD
npm run dev                 # http://localhost:3000  (Vite + API on one port)
# production
npm run build && npm start
npm test                    # 26 API/integration tests (vitest, temp DB)
npm run test:e2e            # 38 browser tests (Playwright/Chromium, seeded temp DB on port 3077)
npm run test:all            # both
# first time only: npx playwright install chromium
npm run typecheck
```

First start: creates `database/vfd-knowledge.db`, applies migrations, seeds the taxonomy (10 categories, 88 common functions — no manufacturer values) and creates the Super Admin (only if none exists; password from `.env`, must be changed at first login).

## Importing manuals

- UI: Documentation Library → Import Documents (Super Admin). Dry run available.
- CLI (same `DocumentIngestionService`): `npm run import:manual -- "vfd-manuals/Delta/New.pdf" [--dry-run] [--no-ocr]` → JSON result on stdout.
- `npm run import:curated` imports every manual that has a file in `data/curated/*.json`.
- Pipeline: validate path (must be inside `vfd-manuals/`), completeness check, SHA-256 duplicate check, verified DB backup, text extraction (pdf.js), OCR for pages without a text layer (tesseract.js, first run downloads language data), page storage with PDF page index + FTS5 index, brand/model detection, staging of extracted records with comparison against existing data.
- Extracted records are **staged**, never written directly. Review them in Verification Center: approve / reject / attach as evidence / create separate record. Conflicts never overwrite — both sources are kept and a task is created. Approved records start as `Unverified`; you mark them `Verified` after checking the manual page.
- `data/curated/*.json` were produced by AI-assisted reading of the manuals; every `evidence_quote` is machine-checked against the page text (`exact` / `normalized` / `not_found` / `no_text_layer`). Treat all of them as Unverified.

## Adding a new VFD manual (skill)

Run the project skill **`/import-new-vfd-manual <path-to-pdf>`** (in `.claude/skills/import-new-vfd-manual/`). It previews the PDF, copies it to `vfd-manuals/<Brand>/`, imports the pages and extracts ALL parameters (tiered `Important` / `Medium` / `Optional`), Modbus/communication data and knowledge items (faults, alarms, warnings, troubleshooting, wiring, installation, specifications), validates the result against the manual text, imports, approves and auto-verifies. The extraction format is documented in `data/curated/README.md`.

Helper commands: `npm run manual:new`, `npm run curated:check -- <file>`, `npm run approve:all`, `npm run verify:records [-- --apply]`.

## Layout

```
server/src   config, db (migrations, seed), auth, routes, services (ingestion, review, backup, storage, presence), cli
client/src   React app (pages, components)
data/        taxonomy.json (categories + common functions), curated/ (extraction files)
database/    vfd-knowledge.db, backups/
storage/     extracted-text, page-images, ocr, users/user-{id}/…, system
tests/       integration tests
```

## Notes

- Roles: exactly `super_admin` and `user`. Sessions are server-side in SQLite (hashed tokens), 7 days by default (`SESSION_TTL_DAYS`), HttpOnly SameSite cookies, CSRF header on writes, Argon2id passwords, registration limited to 3/IP/hour (`REGISTRATION_RATE_LIMIT_*`).
- Backup/restore: Admin → App Settings & Backups, or `npm run backup`. Restore = stop app, replace the `.db` file with a backup, start.
- Schema changes: add a new entry to `server/src/db/migrations.ts` (never edit applied ones).
