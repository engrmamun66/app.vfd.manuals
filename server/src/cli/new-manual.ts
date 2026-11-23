/**
 * Prepares a NEW VFD manual for full extraction. Used by the "import-new-vfd-manual" skill.
 *
 *   npm run manual:new -- "<path to pdf>"                                  # PREVIEW only: page count, text layer, first pages (no copy, no DB write)
 *   npm run manual:new -- "<path to pdf>" --brand "Delta" --model "VFD-EL" [--revision "V1.14"] [--title "..."]
 *                                                                           # copies the PDF into vfd-manuals/<Brand>/, creates the extraction stub
 *                                                                           # data/curated/<brand>-<model>.json (if absent) and imports the pages (searchable, page images)
 *
 * Prints JSON on stdout. The PDF is never modified; an existing curated file is never overwritten.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';
import { slugify } from '../lib/util.js';
import { extractPdfText } from '../services/ingestion/pdf.js';
import { DocumentIngestionService } from '../services/ingestion/DocumentIngestionService.js';
import { shutdownOcr } from '../services/ingestion/ocr.js';

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const input = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!input) {
  console.error('Usage: npm run manual:new -- "<pdf path>" [--brand B --model M [--revision R] [--title T]]');
  process.exit(2);
}
const src = path.resolve(input);
if (!fs.existsSync(src) || !/\.pdf$/i.test(src)) {
  console.log(JSON.stringify({ ok: false, error: `PDF not found: ${src}` }));
  process.exit(1);
}
const brand = opt('brand');
const model = opt('model');

if (!brand || !model) {
  const t = await extractPdfText(src);
  const withText = t.pages.filter((p) => p.text.replace(/\s/g, '').length > 80).length;
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'preview',
        file: src,
        pdfTitle: t.title,
        pages: t.pageCount,
        pagesWithTextLayer: withText,
        scanned: withText < t.pageCount * 0.5,
        note: 'Identify brand, model and revision from these pages, then re-run with --brand and --model.',
        firstPages: t.pages.slice(0, 3).map((p) => ({ page: p.pageIndex, text: p.text.slice(0, 1500) })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ---- prepare: copy into vfd-manuals/<Brand>/, stub, import pages
const brandDir = path.join(config.manualsDir, brand.replace(/[\\/:*?"<>|]/g, '').trim());
fs.mkdirSync(brandDir, { recursive: true });
let dest = src;
if (!path.resolve(src).toLowerCase().startsWith(path.resolve(config.manualsDir).toLowerCase() + path.sep)) {
  dest = path.join(brandDir, path.basename(src));
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
}
const ROOT = path.resolve(config.curatedDir, "..", "..");
const rel = path.relative(ROOT, dest).replace(/\\/g, '/');
const curatedFile = path.join(config.curatedDir, `${slugify(brand)}-${slugify(model)}.json`);
if (!fs.existsSync(curatedFile)) {
  fs.mkdirSync(config.curatedDir, { recursive: true });
  fs.writeFileSync(
    curatedFile,
    JSON.stringify(
      {
        document_file: rel,
        document_title: opt('title') ?? null,
        document_revision: opt('revision') ?? null,
        brand,
        model,
        model_evidence: { page_index: 1, evidence_quote: '' },
        extraction_method: 'ai-assisted-reading',
        parameters: [],
        modbus_registers: [],
        knowledge_items: [],
        notes: [],
      },
      null,
      2,
    ),
  );
}
await bootstrap(() => {});
const svc = new DocumentIngestionService(getDb());
const r = await svc.ingest({ path: rel, ocr: true, onProgress: (m) => console.error(m) });
await shutdownOcr();
const rev = r.revisionId ?? (getDb().prepare('SELECT id FROM document_revisions WHERE lower(source_rel_path) = lower(?) ORDER BY id DESC LIMIT 1').get(rel) as { id: number } | undefined)?.id ?? null;
console.log(
  JSON.stringify(
    {
      ok: r.status !== 'failed',
      mode: 'prepared',
      status: r.status,
      document_file: rel,
      curatedFile: path.relative(ROOT, curatedFile).replace(/\\/g, '/'),
      revisionId: rev,
      pages: r.pages,
      ocrStatus: r.ocrStatus,
      errors: r.errors,
      warnings: r.warnings,
      next: 'Extract with the v2 spec in data/curated/README.md into the curated file, validate with check-curated, then import it again (npm run import:manual), npm run approve:all and npm run verify:records -- --apply.',
    },
    null,
    2,
  ),
);
process.exit(r.status === 'failed' ? 1 : 0);
