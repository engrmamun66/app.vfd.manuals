import fs from 'node:fs';
import path from 'node:path';
import { storagePaths } from '../../config.js';

// pdf.js legacy build works in Node without a DOM. Loaded lazily (heavy).
async function pdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export interface PdfPageText {
  pageIndex: number; // 1-based physical page index
  text: string;
  width: number;
  height: number;
}

export async function openPdf(data: Uint8Array) {
  const { getDocument } = await pdfjs();
  const task = getDocument({ data, verbosity: 0, useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

/** Rebuilds readable lines from pdf.js text items (keeps EOL markers, sorts nothing — preserves stream order). */
function itemsToText(items: any[]): string {
  let out = '';
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    out += it.str;
    if (it.hasEOL) out += '\n';
    else if (it.str && !out.endsWith(' ')) out += ' ';
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdfText(file: string, onPage?: (p: PdfPageText) => void): Promise<{ pageCount: number; pages: PdfPageText[]; title: string | null }> {
  const { doc, close } = await openPdf(new Uint8Array(fs.readFileSync(file)));
  try {
    let title: string | null = null;
    try {
      const meta = await doc.getMetadata();
      title = ((meta?.info as any)?.Title as string) || null;
    } catch {
      /* metadata optional */
    }
    const pages: PdfPageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const p = { pageIndex: i, text: itemsToText(tc.items as any[]), width: vp.width, height: vp.height };
      pages.push(p);
      onPage?.(p);
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages, title };
  } finally {
    await close();
  }
}

/** Renders one PDF page to PNG (cached on disk). Used for page images, OCR and evidence display. */
export async function renderPdfPage(file: string, pageIndex: number, scale: number, cacheKey: string): Promise<string> {
  const dir = path.join(storagePaths.pageImages(), cacheKey);
  const out = path.join(dir, `p${pageIndex}@${scale}.png`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(dir, { recursive: true });
  const { createCanvas } = await import('@napi-rs/canvas');
  const { doc, close } = await openPdf(new Uint8Array(fs.readFileSync(file)));
  try {
    if (pageIndex < 1 || pageIndex > doc.numPages) throw new Error(`Page ${pageIndex} out of range (1-${doc.numPages})`);
    const page = await doc.getPage(pageIndex);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as any, viewport: vp, canvas: canvas as any }).promise;
    const buf = await canvas.encode('png');
    fs.writeFileSync(out + '.part', buf);
    fs.renameSync(out + '.part', out);
    return out;
  } finally {
    await close();
  }
}

export interface PageWord { s: string; x: number; y: number; w: number; h: number }
export interface PageWords { width: number; height: number; items: PageWord[] }

/** Text runs of one PDF page with their position as fractions of the page size (0..1, origin top-left). Cached on disk. */
export async function pdfPageWords(file: string, pageIndex: number, cacheKey: string): Promise<PageWords> {
  const dir = path.join(storagePaths.pageImages(), cacheKey);
  const out = path.join(dir, `p${pageIndex}.words.json`);
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.mkdirSync(dir, { recursive: true });
  const { Util } = await pdfjs();
  const { doc, close } = await openPdf(new Uint8Array(fs.readFileSync(file)));
  try {
    if (pageIndex < 1 || pageIndex > doc.numPages) throw new Error(`Page ${pageIndex} out of range (1-${doc.numPages})`);
    const page = await doc.getPage(pageIndex);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const r5 = (n: number) => Math.round(n * 100000) / 100000;
    const items: PageWord[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const tx = (Util as any).transform(vp.transform, it.transform) as number[];
      if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue; // rotated / skewed text: no overlay for it
      const h = Math.hypot(tx[2], tx[3]);
      const scaleX = Math.hypot(tx[0], tx[1]) / (Math.hypot(it.transform[0], it.transform[1]) || 1);
      const w = it.width * scaleX;
      if (!(h > 0) || !(w > 0)) continue;
      items.push({ s: it.str, x: r5(tx[4] / vp.width), y: r5((tx[5] - h) / vp.height), w: r5(w / vp.width), h: r5(h / vp.height) });
    }
    const res: PageWords = { width: vp.width, height: vp.height, items };
    fs.writeFileSync(out + '.part', JSON.stringify(res));
    fs.renameSync(out + '.part', out);
    return res;
  } finally {
    await close();
  }
}
