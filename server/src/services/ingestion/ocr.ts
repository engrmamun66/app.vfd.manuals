import fs from 'node:fs';
import path from 'node:path';
import { storagePaths } from '../../config.js';

/**
 * Optional OCR via tesseract.js (pure WASM, no paid API).
 * Language data is downloaded once on first use and cached in storage/system/tessdata;
 * after that OCR runs offline. If OCR is unavailable the import records ocr_status='failed'
 * and pages remain flagged for manual verification — nothing is silently approved.
 */
let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const cachePath = path.join(storagePaths.system(), 'tessdata');
      fs.mkdirSync(cachePath, { recursive: true });
      return createWorker('eng', 1, { cachePath, logger: () => {} });
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export interface OcrResult {
  text: string;
  confidence: number; // 0-100 as reported by tesseract
}

export async function ocrImage(imageFile: string): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageFile);
  return { text: String(data.text || '').trim(), confidence: Number(data.confidence ?? 0) };
}

export async function shutdownOcr() {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {
      /* ignore */
    }
    workerPromise = null;
  }
}
