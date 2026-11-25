import { getDb } from '../db/index.js';

/**
 * Forgiving text search for the header search box.
 *
 * People copy a few words from a manual page image: the words may differ a little from the stored text layer
 * (OCR slips, 0/O and 1/I/l, plural forms, hyphenation, a missing or extra word, another word order).
 * A query is split into words; every word is expanded to the spellings that exist in the manual text
 * (prefix, same word with 0/O 1/I/l folded, same stem, one or two letters different, joined / split words).
 * A text matches when most of the query words are found in it; the best-covered texts come first.
 */
const STOP = new Set('a an the of to is are was were be been and or in on for at by it its as with this that from can may will shall if then than'.split(' '));

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const fold = (w: string) => (/\d/.test(w) ? w.replace(/o/g, '0').replace(/[il]/g, '1') : w);
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);

function lev(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// every word that occurs in the manual pages (from the full-text index), refreshed when pages change
let vocab: { sig: string; terms: string[] } | null = null;
function vocabulary(): string[] {
  const db = getDb();
  try {
    const r = db.prepare('SELECT COUNT(*) c, COALESCE(MAX(id),0) m FROM document_pages').get() as { c: number; m: number };
    const sig = `${r.c}:${r.m}`;
    if (vocab?.sig === sig) return vocab.terms;
    const terms = (db.prepare('SELECT term FROM document_pages_vocab').all() as { term: string }[]).map((x) => x.term).filter((t) => t.length >= 2 && t.length <= 40);
    vocab = { sig, terms };
    return terms;
  } catch {
    return [];
  }
}

function expand(token: string, terms: string[]): Set<string> {
  const out = new Set<string>([token, fold(token), stem(token)]);
  const ft = fold(token);
  const st = stem(token);
  const maxEdit = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;
  let prefixCount = 0;
  for (const t of terms) {
    if (out.size >= 45) break;
    if (token.length >= 3 && t.length > token.length && t.length <= token.length + 8 && t.startsWith(token) && prefixCount < 20) { out.add(t); prefixCount++; continue; }
    if (fold(t) === ft || stem(t) === st) { out.add(t); continue; }
    if (maxEdit && Math.abs(t.length - token.length) <= maxEdit && t[0] === token[0] && lev(t, token, maxEdit) <= maxEdit) out.add(t);
  }
  return out;
}

export interface Matcher {
  tokens: string[];
  /** all spellings to look for in the full-text index */
  terms: string[];
  score(text: string): { coverage: number; bonus: number };
  snippet(text: string, width?: number): string;
}

export function buildMatcher(q: string): Matcher {
  const all = words(q);
  let tokens = [...new Set(all.filter((w) => !STOP.has(w)))];
  if (!tokens.length) tokens = [...new Set(all)];
  tokens = tokens.slice(0, 24);
  const vt = tokens.length ? vocabulary() : [];
  const groups = tokens.map((t) => expand(t, vt));
  const every = new Set<string>();
  groups.forEach((g) => g.forEach((x) => every.add(x)));
  const phrase = all.join(' ');
  const owner = new Map<string, number[]>(); // spelling -> indexes of the query words it stands for
  groups.forEach((g, i) => g.forEach((e) => owner.set(e, [...(owner.get(e) ?? []), i])));
  /** 0..1: how many query words sit together inside a window of 25 page words (words that are close belong to the same sentence). */
  const proximity = (ws: string[]) => {
    const at: [number, number[]][] = [];
    ws.forEach((w, i) => { const o = owner.get(w) ?? owner.get(fold(w)) ?? owner.get(stem(w)); if (o) at.push([i, o]); });
    let best = 0, j = 0;
    const cnt = new Map<number, number>();
    for (let i = 0; i < at.length; i++) {
      at[i][1].forEach((t) => cnt.set(t, (cnt.get(t) ?? 0) + 1));
      while (at[i][0] - at[j][0] > 25) { at[j][1].forEach((t) => { const c = (cnt.get(t) ?? 1) - 1; c ? cnt.set(t, c) : cnt.delete(t); }); j++; }
      best = Math.max(best, cnt.size);
    }
    return best / tokens.length;
  };

  const wordSet = (ws: string[]) => {
    const s = new Set<string>();
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      s.add(w); s.add(fold(w)); s.add(stem(w));
      if (i + 1 < ws.length && w.length + ws[i + 1].length <= 24) s.add(w + ws[i + 1]); // "over" "current" = "overcurrent"
    }
    return s;
  };
  const found = (set: Set<string>, token: string, g: Set<string>) => {
    for (const e of g) if (set.has(e)) return true;
    if (token.length >= 7) for (let k = 3; k <= token.length - 3; k++) if (set.has(token.slice(0, k)) && set.has(token.slice(k))) return true; // page has the word split in two
    return false;
  };

  return {
    tokens,
    terms: [...every].filter((x) => x.length >= 1).slice(0, 200),
    score(text) {
      if (!tokens.length) return { coverage: 0, bonus: 0 };
      const ws = words(text);
      const set = wordSet(ws);
      let n = 0;
      tokens.forEach((t, i) => { if (found(set, t, groups[i])) n++; });
      const coverage = n / tokens.length;
      const phraseHit = coverage > 0 && phrase && ws.join(' ').includes(phrase);
      return { coverage, bonus: coverage > 0 ? (phraseHit ? 2 : 0) + proximity(ws) : 0 };
    },
    snippet(text, width = 230) {
      const hits: { i: number; len: number }[] = [];
      for (const m of text.matchAll(/[A-Za-z0-9]+/g)) {
        const w = m[0].toLowerCase();
        if (every.has(w) || every.has(fold(w)) || every.has(stem(w))) hits.push({ i: m.index!, len: m[0].length });
      }
      if (!hits.length) return text.replace(/\s+/g, ' ').slice(0, width);
      let best = 0, bestN = 0, j = 0;
      for (let i = 0; i < hits.length; i++) {
        while (hits[j].i + hits[j].len < hits[i].i + hits[i].len - width) j++;
        const n = i - j + 1;
        if (n > bestN) { bestN = n; best = j; }
      }
      const start = Math.max(0, hits[best].i - 40);
      const end = Math.min(text.length, start + width);
      let out = '';
      let pos = start;
      for (const h of hits) {
        if (h.i < start || h.i + h.len > end) continue;
        out += text.slice(pos, h.i) + '[[' + text.slice(h.i, h.i + h.len) + ']]';
        pos = h.i + h.len;
      }
      out += text.slice(pos, end);
      return `${start > 0 ? ' … ' : ''}${out.replace(/\s+/g, ' ').trim()}${end < text.length ? ' … ' : ''}`;
    },
  };
}

/** Keeps the rows that cover the query well: the best coverage found, and anything within a third below it. Best first. */
export function rankRows<T>(rows: T[], m: Matcher, textOf: (r: T) => string): { row: T; coverage: number }[] {
  const scored = rows.map((row, k) => ({ row, k, ...m.score(textOf(row)) })).filter((x) => x.coverage > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.coverage));
  const min = Math.max(0.4, best - 0.35);
  return scored.filter((x) => x.coverage >= min).sort((a, b) => b.coverage - a.coverage || b.bonus - a.bonus || a.k - b.k);
}
