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
