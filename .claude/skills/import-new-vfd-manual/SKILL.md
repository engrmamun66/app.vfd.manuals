---
name: import-new-vfd-manual
description: Import a NEW VFD (variable frequency drive) manual PDF into the VFD Knowledge Base and extract ALL its parameters (Important / Medium / Optional), Modbus and communication data, faults, alarms, warnings, troubleshooting, wiring, installation and specifications. Use when the user wants to add, import or implement a new VFD manual/model. Takes one argument - the PDF file path.
argument-hint: <filepath-to-manual.pdf>
---

# Import a new VFD manual (full extraction)

**Input (dynamic): `filepath`** = `$ARGUMENTS` — path to the manual PDF (absolute, or relative to the project root).
If `$ARGUMENTS` is empty, ask the user for the PDF path and stop.

Project root: the VFD Knowledge Base repo (contains `package.json`, `vfd-manuals/`, `data/curated/`).
Non-negotiable rules:

1. **100% manual-based.** Every value is copied from the manual. Unknown → `null`. Never invent, assume, or use outside knowledge.
2. **Non-destructive.** Never delete or overwrite other manuals' data. Never overwrite an existing curated file of another manual. Imports are staged; conflicts are kept, not overwritten.
3. **Complete.** Extract ALL parameters, not a sample. A manual that yields only a few dozen parameters is almost certainly incomplete.
4. Use the Bash tool from the project root. Put your helper/parser scripts in the session scratchpad directory, never in the project.

## Step 1 — Preview the PDF (no changes)

```bash
npm run manual:new -- "<filepath>"
```

Read the JSON: `pages`, `pagesWithTextLayer`, `scanned`, `firstPages`.
- Identify **brand**, **model / series**, **revision** and **document title** from the first pages. If the brand or model is not clearly printed, ask the user — do not guess.
- If `scanned` is true: warn the user that OCR text is noisy and a text-based PDF would give far better results; continue only if they accept.
- Reuse the exact existing brand spelling: `node -e "const D=require('better-sqlite3');const db=new D('database/vfd-knowledge.db',{readonly:true});console.log(db.prepare('select name from brands').all())"`.

## Step 2 — Prepare (copy PDF, create extraction stub, import pages)

```bash
npm run backup
npm run manual:new -- "<filepath>" --brand "<Brand>" --model "<Model>" --revision "<revision>" --title "<document title>"
```

This copies the PDF to `vfd-manuals/<Brand>/`, creates `data/curated/<brand>-<model>.json` (stub; never overwrites an existing one) and imports the pages (text, OCR if needed, searchable). Note `revisionId`, `document_file` and `curatedFile` from the output. If `ok` is false, report the error and stop.

**Page counting (must match the Dashboard "Manuals — pages" table).** The dashboard counts, per manual (`documents` row), the `page_count` of its **latest revision** (`MAX(document_revisions.id)`) and sums these for the total. It does not count `document_pages` rows of older revisions. After the import, confirm the new manual is counted correctly:

```bash
node -e "const D=require('better-sqlite3');const d=new D('database/vfd-knowledge.db',{readonly:true});console.log(d.prepare(\"SELECT d.title, r.page_count pages, (SELECT COUNT(*) FROM document_pages p WHERE p.revision_id=r.id) stored FROM documents d JOIN document_revisions r ON r.id=(SELECT MAX(id) FROM document_revisions WHERE document_id=d.id) ORDER BY d.title\").all(), d.prepare(\"SELECT SUM(r.page_count) total FROM documents d JOIN document_revisions r ON r.id=(SELECT MAX(id) FROM document_revisions WHERE document_id=d.id)\").get())"
```

For the new manual, `pages` must equal the PDF page count from Step 1 and `stored`. If they differ, fix the import (re-run it) before extracting. A manual with several imported revisions counts only its newest one.

Edit the stub: set `model_evidence.evidence_quote` to a verbatim quote from page 1 that shows the model/title.

## Step 3 — Extract EVERYTHING into the curated JSON

The exact format and rubric are in `data/curated/README.md` (section "Full-manual extraction (format v2)") — read it first. Manual text is already in SQLite (`database/vfd-knowledge.db`, table `document_pages(revision_id, page_index, printed_page, text)`): open it **read-only** from a node script (`require('better-sqlite3')` with `{readonly:true}`), write a parser for this manual's table layout, review samples against the raw page text, and fix the parser. Odd cases are handled by reading the pages manually. Process large manuals in page-range batches.

Write into the curated file (`parameters`, `modbus_registers`, `knowledge_items`, `notes`):

**A. Parameters — all of them.** For each: `code`, `name`, `description`, `unit`, `default_value`, `min_value`, `max_value`, `resolution`, `access`, `setting_conditions`, `options`, `page_index`, `printed_page`, `section`, `evidence_quote` (verbatim, ≤ 300 chars, must exist on the cited page), plus:
- `param_group` — the group/menu name printed in the manual.
- `importance` — exactly one of:
  - `Important`: needed to commission and run safely — motor nameplate data, run-command source, frequency source/reference, min/max/base frequency, accel/decel time, V/f pattern, motor overload protection, basic I/O function selection, **communication setup** (address, baud rate, parity, protocol, timeout/loss action), reset/lock/initialization, auto-tune.
  - `Medium`: commonly used features — multi-speed, jog, basic PID, carrier frequency, stall prevention, DC braking, auto-restart, analog scaling, skip frequency, S-curve, torque boost, output terminal functions, display/monitor selection.
  - `Optional`: advanced, rarely changed, fine-tuning, read-only monitor values, reserved/manufacturer parameters.
- `common_function` + `equivalence`: only when the manual clearly documents that exact function (slugs: `select slug from common_functions`); otherwise `null`.

**B. Communication.** All Modbus/serial registers in `modbus_registers` (address, function codes, access, scaling, bit definitions, `page_index`, quote). Communication topics that are not registers (framing, CRC, function codes, exception codes, timing, connector pinout, protocol selection) → `knowledge_items` with `kind: "communication"`. If the manual has no register map, say so in `notes`; do not invent one.

**C. `knowledge_items`** (one per item; each with `page_index`, `printed_page`, `section`, verbatim `evidence_quote`, `importance`):
- `fault` / `alarm` — every error/fault/alarm code with `description`, `cause`, `remedy`.
- `warning` / `safety` — every distinct warning/caution/danger statement.
- `troubleshooting` — symptom → cause → remedy entries.
- `wiring` — each terminal / terminal block (main circuit and control circuit): name, function, rating in `details`.
- `installation` — mounting, environment, clearances, cabling requirements.
- `specification` — ratings and technical-specification tables (use `details` for per-model values).
- `maintenance` — inspection/replacement intervals and procedures.
- `note` — other important documented facts.

## Step 4 — Validate (loop until clean)

```bash
npm run curated:check -- data/curated/<file>.json
```

Fix until: `problems` is empty, `quoteMatch.not_found` is ~0 (< 2 %), every parameter has `importance`, and `possibleMissingParameterCodes` has been reviewed (numbers like default values are noise; real missing parameter codes must be added). Re-run after each fix.

## Step 5 — Import, approve, verify

```bash
npm run backup
npm run import:manual -- "<document_file>"      # stages all extracted records + inserts knowledge items
npm run approve:all                             # approves staged records (conflicts are preserved, never overwritten)
npm run verify:records                          # dry run: shows what would be auto-verified
npm run verify:records -- --apply               # marks records Verified only if the page text confirms them
```

`verify:records` marks a record `Verified` only when its code/address, evidence quote and stored numbers are found on the cited page; everything else stays `Requires Manual Verification` with the reason stored.

## Step 6 — Report to the user (short)

- Brand / model / pages (latest-revision count, as on the Dashboard) / scanned or text PDF, and the new total pages of all manuals from the query above.
- Counts: parameters (Important / Medium / Optional), Modbus registers, knowledge items per kind.
- How many records are `Verified` vs `Requires Manual Verification` (and why, e.g. scanned pages or glyph-image codes).
- Anything not extractable or uncertain, with page numbers.
- Where to look in the app: Parameters (filter by model tab and Importance), Modbus Register Explorer, Troubleshooting & Manual Topics, Library.

Do not restart the server; the running app shows the new data after a page refresh.
