import fs from 'node:fs';
import path from 'node:path';
import { config, storagePaths } from '../../config.js';
import { getDb, type DB } from '../../db/index.js';
import { normalizeForMatch, sha256, slugify, json } from '../../lib/util.js';
import { audit } from '../../lib/audit.js';
import { createBackup } from '../backup.js';
import { sniff } from '../storage.js';
import { extractPdfText, renderPdfPage } from './pdf.js';
import { ocrImage } from './ocr.js';
import { findCuratedFor, type CuratedFile, type CuratedParameter, type CuratedRegister } from './curated.js';

/**
 * DocumentIngestionService — the single ingestion pipeline used by the UI (REST),
 * the CLI (`npm run import:manual -- <path>`) and any future Claude Code Skill.
 *
 * Non-destructive by design (§29): it never deletes or overwrites existing records.
 * Extracted technical records go to `staged_records` for human review.
 */

export interface IngestOptions {
  path: string; // path to the manual (absolute or relative to project root); must be inside vfd-manuals/
  dryRun?: boolean;
  ocr?: boolean; // run OCR on pages without a usable text layer (default true)
  userId?: number | null;
  onProgress?: (msg: string) => void;
  onJobCreated?: (importJobId: number) => void;
}

export interface IngestResult {
  importJobId: number | null;
  document: { name: string; path: string; sha256: string | null; format: string | null; sizeBytes: number | null };
  status: 'completed' | 'duplicate' | 'dry_run' | 'failed';
  dryRun: boolean;
  documentId: number | null;
  revisionId: number | null;
  detected: {
    folderHint: string | null;
    brandFromContent: { name: string; hits: number }[];
    brand: string | null;
    model: string | null;
    identificationSource: string;
    identificationStatus: 'needs_review';
    modelEvidenceQuoteMatch: string | null;
  };
  pages: { total: number; withTextLayer: number; ocrProcessed: number; ocrFailed: number; empty: number };
  ocrStatus: string;
  extraction: { source: string | null; parametersExtracted: number; registersExtracted: number; knowledgeItems: number; staged: number; skippedAlreadyStaged: number };
  comparison: Record<string, number>;
  duplicates: { existingRevisionId: number; existingDocumentId: number; existingPath: string } | null;
  conflicts: { recordType: string; code: string; existingId: number; fields: string[] }[];
  pendingReview: number;
  verificationTasksCreated: number;
  backup: { id: number | null; path: string } | null;
  errors: string[];
  warnings: string[];
}

const KNOWN_MANUFACTURERS = ['Siemens', 'Delta', 'Schneider', 'Fuji', 'Yaskawa', 'OMRON', 'Mitsubishi', 'ABB', 'Danfoss', 'Hitachi', 'Toshiba', 'LS', 'Invt', 'CLV', 'Lenze', 'Rockwell', 'Allen-Bradley', 'Hyundai', 'Vacon', 'Eaton', 'WEG', 'Panasonic'];
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

export class IngestionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/** Resolves and validates that the path is an existing file inside the permitted manuals directory. */
export function resolveManualPath(input: string): { abs: string; rel: string } {
  if (!input || typeof input !== 'string') throw new IngestionError('A document path is required', 'PATH_REQUIRED');
  const abs = path.resolve(path.isAbsolute(input) ? input : path.join(config.root, input));
  const base = fs.existsSync(config.manualsDir) ? fs.realpathSync(config.manualsDir) : path.resolve(config.manualsDir);
  if (!fs.existsSync(abs)) throw new IngestionError(`File not found: ${input}`, 'NOT_FOUND');
  const real = fs.realpathSync(abs);
  const r = path.relative(base, real);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new IngestionError('Document must be inside the vfd-manuals/ directory', 'OUTSIDE_MANUALS_DIR');
  if (!fs.statSync(real).isFile()) throw new IngestionError('Path is not a file', 'NOT_A_FILE');
  if (!ALLOWED_EXT.has(path.extname(real).toLowerCase())) throw new IngestionError(`Unsupported file type: ${path.extname(real)}`, 'UNSUPPORTED_FORMAT');
  const rel = path.relative(config.root, real).replace(/\\/g, '/');
  return { abs: real, rel };
}

/** Detects files still being copied: size/mtime must be stable and PDFs must end with %%EOF. */
async function assertComplete(abs: string, format: string) {
  const a = fs.statSync(abs);
  await new Promise((r) => setTimeout(r, 600));
  const b = fs.statSync(abs);
  if (a.size !== b.size || a.mtimeMs !== b.mtimeMs) throw new IngestionError('File appears to still be copying (size changed). Try again when the copy finishes.', 'INCOMPLETE');
  if (b.size === 0) throw new IngestionError('File is empty', 'INCOMPLETE');
  if (format === 'pdf') {
    const fd = fs.openSync(abs, 'r');
    const len = Math.min(2048, b.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, b.size - len);
    fs.closeSync(fd);
    if (!buf.toString('latin1').includes('%%EOF')) throw new IngestionError('PDF has no %%EOF marker — file may be incomplete or corrupt', 'INCOMPLETE');
  }
}

function detectBrands(db: DB, text: string) {
  const names = new Set<string>(KNOWN_MANUFACTURERS);
  for (const b of db.prepare('SELECT name FROM brands').all() as { name: string }[]) names.add(b.name);
  const hits: { name: string; hits: number }[] = [];
  for (const n of names) {
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const c = text.match(re)?.length ?? 0;
    if (c) hits.push({ name: n, hits: c });
  }
  return hits.sort((a, b) => b.hits - a.hits).slice(0, 5);
}

/** Checks an evidence quote against the extracted text of the cited page. */
export function matchQuote(pageText: string | null | undefined, quote: string | null | undefined): 'exact' | 'normalized' | 'not_found' | 'no_text_layer' | 'unchecked' {
  if (!quote) return 'unchecked';
  if (!pageText || pageText.trim().length < 5) return 'no_text_layer';
  if (pageText.includes(quote)) return 'exact';
  const nq = normalizeForMatch(quote);
  if (nq.length && normalizeForMatch(pageText).includes(nq)) return 'normalized';
  return 'not_found';
}

const PARAM_COMPARE_FIELDS: [keyof CuratedParameter, string][] = [
  ['name', 'name'],
  ['unit', 'unit'],
  ['default_value', 'default_value'],
  ['min_value', 'min_value'],
  ['max_value', 'max_value'],
  ['resolution', 'resolution'],
  ['importance', 'importance'],
  ['param_group', 'param_group'],
];
const REG_COMPARE_FIELDS: [keyof CuratedRegister, string][] = [
  ['name', 'name'],
  ['access', 'access'],
  ['data_type', 'data_type'],
  ['scaling', 'scaling'],
  ['unit', 'unit'],
  ['function_codes', 'function_codes'],
];

const normVal = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).replace(/\s+/g, ' ').trim().toLowerCase());
export const normAddress = (a: string) => a.replace(/\s+/g, '').toUpperCase();

/** Classifies a new extracted record against existing records (§29.4). Never decides by name similarity alone. */
export function compareRecord(db: DB, type: 'parameter' | 'modbus_register', modelId: number | null, rec: any, cfId: number | null) {
  if (!modelId) return { comparison: 'No Existing Record', matchedId: null as number | null, detail: { reason: 'model not yet in database' } };
  let existing: any;
  let fields: [string, string][];
  if (type === 'parameter') {
    existing = db.prepare('SELECT * FROM parameters WHERE model_id = ? AND code = ?').get(modelId, String(rec.code).trim());
    fields = PARAM_COMPARE_FIELDS as any;
  } else {
    const all = db.prepare('SELECT * FROM modbus_registers WHERE model_id = ?').all(modelId) as any[];
    const sameAddr = all.filter((r) => normAddress(r.original_address) === normAddress(String(rec.original_address)));
    existing = sameAddr.find((r) => normVal(r.name) === normVal(rec.name));
    if (!existing && sameAddr.length) {
      return { comparison: 'Uncertain Match', matchedId: sameAddr[0].id, detail: { reason: 'same original address, different register name', candidates: sameAddr.map((r) => r.id) } };
    }
    fields = REG_COMPARE_FIELDS as any;
  }
  if (!existing) {
    if (cfId) {
      const table = type === 'parameter' ? 'parameters' : 'modbus_registers';
      const sameFn = db.prepare(`SELECT id FROM ${table} WHERE model_id = ? AND common_function_id = ?`).all(modelId, cfId) as { id: number }[];
      if (sameFn.length)
        return { comparison: 'Possible Duplicate', matchedId: sameFn[0].id, detail: { reason: 'another record of this model is mapped to the same common function', candidates: sameFn.map((r) => r.id) } };
    }
    return { comparison: 'No Existing Record', matchedId: null, detail: null };
  }
  const differing: string[] = [];
  const added: string[] = [];
  for (const [src, col] of fields) {
    const nv = normVal(rec[src]);
    const ov = normVal(existing[col]);
    if (nv === null) continue;
    if (ov === null) added.push(col);
    else if (nv !== ov) differing.push(col);
  }
  if (differing.length)
    return { comparison: 'Conflicting Information', matchedId: existing.id, detail: { differing, existing: Object.fromEntries(differing.map((f) => [f, existing[f]])) } };
  if (added.length) return { comparison: 'Updated Information', matchedId: existing.id, detail: { addsFields: added } };
  return { comparison: 'Exact Match', matchedId: existing.id, detail: null };
}

export function ensureBrandModel(db: DB, brandName: string, modelName: string | null) {
  const bslug = slugify(brandName);
  db.prepare('INSERT OR IGNORE INTO brands(slug, name) VALUES (?,?)').run(bslug, brandName.trim());
  const brand = db.prepare('SELECT id FROM brands WHERE slug = ?').get(bslug) as { id: number };
  db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES ('brand', ?)").run(brand.id);
  let modelId: number | null = null;
  if (modelName) {
    const mslug = slugify(modelName);
    db.prepare('INSERT OR IGNORE INTO models(brand_id, slug, name) VALUES (?,?,?)').run(brand.id, mslug, modelName.trim());
    modelId = (db.prepare('SELECT id FROM models WHERE brand_id = ? AND slug = ?').get(brand.id, mslug) as { id: number }).id;
    db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES ('model', ?)").run(modelId);
  }
  return { brandId: brand.id, modelId };
}

function cfIdFor(db: DB, slug: string | null | undefined): number | null {
  if (!slug) return null;
  const r = db.prepare('SELECT id FROM common_functions WHERE slug = ?').get(slug) as { id: number } | undefined;
  return r?.id ?? null;
}

export class DocumentIngestionService {
  constructor(private db: DB = getDb()) {}

  async ingest(opts: IngestOptions): Promise<IngestResult> {
    const db = this.db;
    const log = opts.onProgress ?? (() => {});
    const dryRun = !!opts.dryRun;
    const result: IngestResult = {
      importJobId: null,
      document: { name: path.basename(opts.path || ''), path: opts.path, sha256: null, format: null, sizeBytes: null },
      status: 'failed',
      dryRun,
      documentId: null,
      revisionId: null,
      detected: { folderHint: null, brandFromContent: [], brand: null, model: null, identificationSource: 'none', identificationStatus: 'needs_review', modelEvidenceQuoteMatch: null },
      pages: { total: 0, withTextLayer: 0, ocrProcessed: 0, ocrFailed: 0, empty: 0 },
      ocrStatus: 'not_needed',
      extraction: { source: null, parametersExtracted: 0, registersExtracted: 0, knowledgeItems: 0, staged: 0, skippedAlreadyStaged: 0 },
      comparison: {},
      duplicates: null,
      conflicts: [],
      pendingReview: 0,
      verificationTasksCreated: 0,
      backup: null,
      errors: [],
      warnings: [],
    };

    const jobId = Number(
      db.prepare('INSERT INTO document_import_jobs(file_path, dry_run, status, created_by_user_id) VALUES (?,?,?,?)').run(String(opts.path ?? ''), dryRun ? 1 : 0, 'running', opts.userId ?? null).lastInsertRowid,
    );
    result.importJobId = jobId;
    opts.onJobCreated?.(jobId);
    const finish = (status: IngestResult['status']) => {
      result.status = status;
      const jobStatus = status === 'dry_run' ? 'dry_run' : status;
      db.prepare('UPDATE document_import_jobs SET status = ?, result_json = ?, finished_at = ?, error = ?, backup_id = ? WHERE id = ?').run(
        jobStatus,
        json(result),
        new Date().toISOString(),
        result.errors.join('\n') || null,
        result.backup?.id ?? null,
        jobId,
      );
      return result;
    };

    try {
      // ---- 1. validate ----
      const { abs, rel } = resolveManualPath(opts.path);
      result.document.path = rel;
      result.document.name = path.basename(abs);
      const buf = fs.readFileSync(abs);
      const sn = sniff(buf);
      if (!sn) throw new IngestionError('File content is not a supported PDF/JPEG/PNG/WebP document', 'INVALID_FORMAT');
      const format = sn.ext === 'jpg' ? 'jpeg' : sn.ext;
      result.document.format = format;
      result.document.sizeBytes = buf.length;
      await assertComplete(abs, format);
      const hash = sha256(buf);
      result.document.sha256 = hash;
      const parts = rel.split('/');
      result.detected.folderHint = parts.length >= 3 ? parts[parts.length - 2] : null;
      log(`Validated ${rel} (${format}, ${buf.length} bytes, sha256 ${hash.slice(0, 12)}…)`);

      const curated = findCuratedFor(rel);

      // ---- 2. duplicate detection ----
      const dup = db.prepare('SELECT id, document_id, source_rel_path FROM document_revisions WHERE sha256 = ?').get(hash) as
        | { id: number; document_id: number; source_rel_path: string }
        | undefined;
      if (dup) {
        result.duplicates = { existingRevisionId: dup.id, existingDocumentId: dup.document_id, existingPath: dup.source_rel_path };
        result.documentId = dup.document_id;
        result.revisionId = dup.id;
        result.warnings.push(`Identical file (same SHA-256) already imported as revision #${dup.id}${dup.source_rel_path !== rel ? ` from ${dup.source_rel_path}` : ''}. Pages were not re-imported.`);
        const pc = db.prepare('SELECT COUNT(*) n, SUM(text_source != \'none\') t FROM document_pages WHERE revision_id = ?').get(dup.id) as { n: number; t: number };
        result.pages.total = pc.n;
        result.pages.withTextLayer = pc.t ?? 0;
        if (curated) {
          if (!dryRun) result.backup = this.backup(`import-job-${jobId}`, opts.userId);
          this.stageCurated(curated, dup.id, dup.document_id, jobId, dryRun, result);
        }
        return finish(dryRun ? 'dry_run' : 'duplicate');
      }

      // ---- 3. backup before modifying anything ----
      if (!dryRun) {
        result.backup = this.backup(`import-job-${jobId}`, opts.userId);
        log(`Backup created: ${result.backup?.path}`);
      }

      // ---- 4. extract text (+ OCR) ----
      type Page = { pageIndex: number; text: string; source: 'pdf-text' | 'ocr' | 'none'; conf: number | null; width: number | null; height: number | null };
      const pages: Page[] = [];
      let title: string | null = null;
      const cacheKey = `sha-${hash.slice(0, 16)}`;
      if (format === 'pdf') {
        const ex = await extractPdfText(abs, (p) => {
          if (p.pageIndex % 50 === 0) log(`  text: page ${p.pageIndex}`);
        });
        title = ex.title;
        for (const p of ex.pages) pages.push({ pageIndex: p.pageIndex, text: p.text, source: p.text.length >= 30 ? 'pdf-text' : 'none', conf: null, width: p.width, height: p.height });
      } else {
        pages.push({ pageIndex: 1, text: '', source: 'none', conf: null, width: null, height: null });
      }
      result.pages.total = pages.length;
      result.pages.withTextLayer = pages.filter((p) => p.source === 'pdf-text').length;
      const needOcr = pages.filter((p) => p.source === 'none');
      if (needOcr.length) {
        if (opts.ocr === false) {
          result.ocrStatus = 'pending';
          result.warnings.push(`${needOcr.length} page(s) have no text layer; OCR was skipped (ocr=false). They are flagged for OCR/manual review.`);
        } else {
          log(`OCR: ${needOcr.length} page(s) without text layer`);
          for (const p of needOcr) {
            try {
              const img = format === 'pdf' ? await renderPdfPage(abs, p.pageIndex, 2, cacheKey) : abs;
              const o = await ocrImage(img);
              if (o.text.length >= 5) {
                p.text = o.text;
                p.source = 'ocr';
                p.conf = o.confidence;
              }
              result.pages.ocrProcessed++;
              if (p.pageIndex % 10 === 0) log(`  OCR page ${p.pageIndex}/${pages.length}`);
            } catch (e) {
              result.pages.ocrFailed++;
              if (result.pages.ocrFailed <= 3) result.errors.push(`OCR failed on page ${p.pageIndex}: ${(e as Error).message}`);
            }
          }
          result.ocrStatus = result.pages.ocrFailed === 0 ? 'completed' : result.pages.ocrProcessed > 0 ? 'partial' : 'failed';
        }
      }
      result.pages.empty = pages.filter((p) => p.source === 'none').length;

      // ---- 5. identification (content-based; folder name is only a hint) ----
      const headText = pages.slice(0, 15).map((p) => p.text).join('\n');
      result.detected.brandFromContent = detectBrands(db, headText);
      const contentBrand = result.detected.brandFromContent[0]?.name ?? null;
      if (curated) {
        result.detected.brand = curated.brand;
        result.detected.model = curated.model;
        result.detected.identificationSource = `curated extraction file (${curated._file}) — AI-assisted, requires review`;
        const me = curated.model_evidence;
        if (me?.page_index) result.detected.modelEvidenceQuoteMatch = matchQuote(pages[me.page_index - 1]?.text, me.evidence_quote);
      } else if (contentBrand) {
        result.detected.brand = contentBrand;
        result.detected.identificationSource = 'brand name frequency in first 15 pages';
      } else {
        result.detected.identificationSource = 'not identified';
        result.warnings.push('Brand could not be identified from document content; marked for manual review.');
      }
      if (result.detected.folderHint && result.detected.brand && !result.detected.folderHint.toLowerCase().includes(result.detected.brand.toLowerCase().slice(0, 4)))
        result.warnings.push(`Folder name "${result.detected.folderHint}" does not match detected brand "${result.detected.brand}". Verify manually.`);

      if (dryRun) {
        if (curated) this.stageCurated(curated, null, null, jobId, true, result, pages.map((p) => p.text));
        return finish('dry_run');
      }

      // ---- 6. persist document / revision / pages (one transaction) ----
      const textDir = storagePaths.extractedText();
      fs.mkdirSync(textDir, { recursive: true });
      db.transaction(() => {
        let brandId: number | null = null;
        let modelId: number | null = null;
        if (result.detected.brand) ({ brandId, modelId } = ensureBrandModel(db, result.detected.brand, result.detected.model));
        const docTitle = curated?.document_title || title || path.basename(abs, path.extname(abs));
        const docId = Number(
          db.prepare('INSERT INTO documents(brand_id, title, doc_type, identification_status, notes) VALUES (?,?,?,?,?)').run(
            brandId,
            docTitle,
            format === 'pdf' ? 'manual' : 'image',
            'needs_review',
            (curated?.notes ?? []).join('\n') || null,
          ).lastInsertRowid,
        );
        db.prepare("INSERT OR IGNORE INTO content_display(entity_type, entity_id) VALUES ('document', ?)").run(docId);
        if (modelId) db.prepare('INSERT OR IGNORE INTO document_models(document_id, model_id) VALUES (?,?)').run(docId, modelId);
        const revId = Number(
          db
            .prepare(
              `INSERT INTO document_revisions(document_id, revision_label, source_rel_path, original_filename, file_format, mime, file_size, sha256, page_count, text_layer_pages, ocr_status, import_job_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(docId, curated?.document_revision ?? null, rel, path.basename(abs), format, sn.mime, buf.length, hash, pages.length, result.pages.withTextLayer, result.ocrStatus, jobId).lastInsertRowid,
        );
        const ins = db.prepare(
          'INSERT INTO document_pages(revision_id, page_index, text, text_source, ocr_confidence, char_count, width, height, image_rel_path) VALUES (?,?,?,?,?,?,?,?,?)',
        );
        for (const p of pages)
          ins.run(revId, p.pageIndex, p.text || null, p.source, p.conf, p.text.length, p.width, p.height, format === 'pdf' ? null : rel);
        result.documentId = docId;
        result.revisionId = revId;

        // similar existing documents → possible revision relationship (never auto-linked)
        const similar = db
          .prepare('SELECT d.id, d.title FROM documents d WHERE d.id != ? AND d.brand_id IS ? AND lower(d.title) = lower(?)')
          .all(docId, brandId, docTitle) as { id: number; title: string }[];
        if (similar.length) {
          this.task('duplicate', 'document', docId, `Possible new revision of existing document "${docTitle}"`, { similarDocumentIds: similar.map((s) => s.id) }, jobId);
          result.verificationTasksCreated++;
          result.warnings.push('A document with the same brand and title exists; a review task was created to decide whether this is a new revision.');
        }
        this.task('identification', 'document', docId, `Verify brand/model identification for ${path.basename(abs)}`, { detected: result.detected }, jobId);
        result.verificationTasksCreated++;
        if (result.pages.ocrProcessed > 0 || result.pages.empty > 0) {
          this.task('ocr_review', 'document', docId, `Review OCR/unreadable pages of ${path.basename(abs)}`, { ocrPages: result.pages.ocrProcessed, emptyPages: result.pages.empty }, jobId);
          result.verificationTasksCreated++;
        }
        audit({ entityType: 'document', entityId: docId, operation: 'import', next: { revisionId: revId, sha256: hash, rel }, source: 'DocumentIngestionService', importJobId: jobId, userId: opts.userId ?? null });
      })();
      fs.writeFileSync(path.join(textDir, `rev-${result.revisionId}.txt`), pages.map((p) => `=== page ${p.pageIndex} [${p.source}] ===\n${p.text}`).join('\n\n'));
      log(`Stored document #${result.documentId}, revision #${result.revisionId}, ${pages.length} pages`);

      // ---- 7. stage extracted technical records ----
      if (curated) this.stageCurated(curated, result.revisionId, result.documentId, jobId, false, result);
      else result.warnings.push('No structured extraction available for this document. Pages are searchable; add records from the Document Viewer or provide a curated extraction file in data/curated/.');

      return finish('completed');
    } catch (e) {
      const err = e as Error & { code?: string };
      result.errors.push(err.code ? `[${err.code}] ${err.message}` : err.message);
      return finish('failed');
    }
  }

  private backup(op: string, userId?: number | null) {
    const hasData = this.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
    if (!hasData) return null;
    const b = createBackup(this.db, op, userId ?? null);
    return { id: b.id, path: b.relPath };
  }

  private task(type: string, entityType: string, entityId: number | null, title: string, details: unknown, jobId: number | null) {
    this.db
      .prepare('INSERT INTO verification_tasks(entity_type, entity_id, task_type, title, details_json, import_job_id) VALUES (?,?,?,?,?,?)')
      .run(entityType, entityId, type, title, json(details), jobId);
  }

  /** Stages curated records into staged_records with comparison results. Skips records already staged/pending for this revision. */
  stageCurated(curated: CuratedFile, revisionId: number | null, documentId: number | null, jobId: number, dryRun: boolean, result: IngestResult, pageTexts?: string[]) {
    const db = this.db;
    result.extraction.source = `data/curated/${curated._file} (${curated.extraction_method ?? 'unspecified'})`;
    const params = curated.parameters ?? [];
    const regs = curated.modbus_registers ?? [];
    result.extraction.parametersExtracted = params.length;
    result.extraction.registersExtracted = regs.length;
    let modelId: number | null = null;
    if (!dryRun && curated.brand) {
      modelId = ensureBrandModel(db, curated.brand, curated.model).modelId;
      if (documentId && modelId) db.prepare('INSERT OR IGNORE INTO document_models(document_id, model_id) VALUES (?,?)').run(documentId, modelId);
    } else if (curated.brand) {
      const m = db.prepare('SELECT m.id FROM models m JOIN brands b ON b.id = m.brand_id WHERE b.slug = ? AND m.slug = ?').get(slugify(curated.brand), slugify(curated.model)) as { id: number } | undefined;
      modelId = m?.id ?? null;
    }
    const pageText = (idx: number | null | undefined) => {
      if (!idx) return null;
      if (pageTexts) return pageTexts[idx - 1] ?? null;
      if (!revisionId) return null;
      return (db.prepare('SELECT text FROM document_pages WHERE revision_id = ? AND page_index = ?').get(revisionId, idx) as { text: string } | undefined)?.text ?? null;
    };
    const already = (type: string, key: string) =>
      revisionId
        ? !!db
            .prepare(
              `SELECT 1 FROM staged_records WHERE revision_id = ? AND record_type = ? AND status IN ('pending','approved')
               AND (json_extract(payload_json,'$.code') = ? OR (json_extract(payload_json,'$.original_address') || '|' || json_extract(payload_json,'$.name')) = ?)`,
            )
            .get(revisionId, type, key, key)
        : false;
    const ins = db.prepare(
      `INSERT INTO staged_records(import_job_id, revision_id, record_type, payload_json, comparison, comparison_detail_json, matched_entity_id, quote_match)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    const stage = (type: 'parameter' | 'modbus_register', rec: any) => {
      const key = type === 'parameter' ? String(rec.code) : `${rec.original_address}|${rec.name}`;
      const cfId = cfIdFor(db, rec.common_function);
      if (rec.common_function && !cfId) result.warnings.push(`Unknown common_function slug "${rec.common_function}" for ${key}; staged without mapping.`);
      const qm = matchQuote(pageText(rec.page_index), rec.evidence_quote);
      const cmp = compareRecord(db, type, modelId, rec, cfId);
      result.comparison[cmp.comparison] = (result.comparison[cmp.comparison] ?? 0) + 1;
      if (cmp.comparison === 'Conflicting Information')
        result.conflicts.push({ recordType: type, code: key, existingId: cmp.matchedId!, fields: (cmp.detail as any)?.differing ?? [] });
      if (dryRun) return;
      if (already(type, key)) {
        result.extraction.skippedAlreadyStaged++;
        return;
      }
      ins.run(
        jobId,
        revisionId,
        type,
        json({ ...rec, _brand: curated.brand, _model: curated.model, _model_id: modelId, _common_function_id: cfId, _document_id: documentId, _extraction_method: curated.extraction_method ?? null }),
        cmp.comparison,
        json(cmp.detail),
        cmp.matchedId,
        qm,
      );
      result.extraction.staged++;
    };
    db.transaction(() => {
      for (const p of params) if (p?.code) stage('parameter', p);
      for (const r of regs) if (r?.original_address && r?.name) stage('modbus_register', r);
      // faults / warnings / troubleshooting / wiring / specs etc. go straight into knowledge_items (additive, INSERT OR IGNORE; never overwrites)
      if (!dryRun && modelId && revisionId) {
        const insKi = db.prepare(
          `INSERT OR IGNORE INTO knowledge_items(model_id, revision_id, kind, code, title, description, cause, remedy, details_json, section, page_index, printed_page, evidence_quote, quote_match, importance, evidence_status, verification_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        for (const k of curated.knowledge_items ?? []) {
          if (!k?.kind || !k?.title) continue;
          const qm = matchQuote(pageText(k.page_index), k.evidence_quote);
          const ok = qm === 'exact' || qm === 'normalized';
          const r = insKi.run(modelId, revisionId, k.kind, k.code?.trim() || null, k.title.trim(), k.description ?? null, k.cause ?? null, k.remedy ?? null, k.details ? json(k.details) : null, k.section ?? null, k.page_index ?? null, k.printed_page ?? null, k.evidence_quote ?? null, qm, ['Important', 'Medium', 'Optional'].includes(k.importance as string) ? k.importance : null, ok ? 'Explicitly Documented' : 'Unverified', ok ? 'Unverified' : 'Requires Manual Verification');
          result.extraction.knowledgeItems += r.changes;
        }
      } else result.extraction.knowledgeItems = (curated.knowledge_items ?? []).length;
      if (!dryRun && result.extraction.staged) {
        this.task('review_import', 'import_job', jobId, `Review ${result.extraction.staged} extracted record(s) from ${curated.document_file}`, { curatedFile: curated._file }, jobId);
        result.verificationTasksCreated++;
      }
      if (!dryRun && result.conflicts.length) {
        this.task('conflict', 'import_job', jobId, `${result.conflicts.length} documentation conflict(s) detected in ${curated.document_file}`, { conflicts: result.conflicts }, jobId);
        result.verificationTasksCreated++;
      }
    })();
    for (const n of curated.notes ?? []) result.warnings.push(`Extraction note: ${n}`);
    result.pendingReview = (db.prepare("SELECT COUNT(*) c FROM staged_records WHERE import_job_id = ? AND status = 'pending'").get(jobId) as { c: number }).c;
  }

  /** Re-run OCR for pages of a revision that still have no text. Existing text is never overwritten. */
  async reprocessOcr(revisionId: number, onProgress?: (m: string) => void) {
    const db = this.db;
    const rev = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(revisionId) as any;
    if (!rev) throw new IngestionError('Revision not found', 'NOT_FOUND');
    const abs = path.join(config.root, rev.source_rel_path);
    if (!fs.existsSync(abs)) throw new IngestionError('Original file is missing from disk', 'MISSING_SOURCE');
    const pages = db.prepare("SELECT id, page_index FROM document_pages WHERE revision_id = ? AND text_source = 'none'").all(revisionId) as { id: number; page_index: number }[];
    let ok = 0;
    let failed = 0;
    for (const p of pages) {
      try {
        const img = rev.file_format === 'pdf' ? await renderPdfPage(abs, p.page_index, 2, `sha-${rev.sha256.slice(0, 16)}`) : abs;
        const o = await ocrImage(img);
        if (o.text.length >= 5) {
          db.prepare("UPDATE document_pages SET text = ?, text_source = 'ocr', ocr_confidence = ?, char_count = ? WHERE id = ? AND text_source = 'none'").run(o.text, o.confidence, o.text.length, p.id);
          ok++;
        }
        onProgress?.(`OCR page ${p.page_index}`);
      } catch {
        failed++;
      }
    }
    const remaining = (db.prepare("SELECT COUNT(*) c FROM document_pages WHERE revision_id = ? AND text_source = 'none'").get(revisionId) as { c: number }).c;
    db.prepare('UPDATE document_revisions SET ocr_status = ? WHERE id = ?').run(remaining === 0 ? 'completed' : ok ? 'partial' : 'failed', revisionId);
    return { pagesAttempted: pages.length, ocrUpdated: ok, failed, remainingWithoutText: remaining };
  }
}
