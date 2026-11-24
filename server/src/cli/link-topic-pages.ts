/**
 * Adds the manual pages that belong to a knowledge topic (faults, wiring, installation, ...), besides its primary page.
 *
 *   npx tsx server/src/cli/link-topic-pages.ts            # report only
 *   npx tsx server/src/cli/link-topic-pages.ts --apply    # store the links (idempotent, additive)
 *
 * A page is linked ONLY when the manual's own page text proves the connection:
 *   - the topic's section heading and/or title is printed on that page (near the primary page), or
 *   - for faults / alarms / warnings / troubleshooting: the code is printed together with most of the title's words.
 * Nothing is guessed; the primary page (from the extraction) is always kept first.
 */
import { bootstrap } from '../bootstrap.js';
import { getDb } from '../db/index.js';

const apply = process.argv.includes('--apply');
await bootstrap(() => {});
const db = getDb();

const decode = (t: string | null | undefined) => (t ?? '').replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xf000));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'for', 'of', 'to', 'in', 'on', 'a', 'an', 'is', 'are', 'with', 'by', 'or', 'at']);
const sig = (s: string) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
const WINDOW = 8; // pages around the primary page that may continue the same topic
const MAX_EXTRA = 3;
const CODE_KINDS = new Set(['fault', 'alarm', 'warning', 'troubleshooting']);

interface Page { page_index: number; printed_page: string | null; n: string; words: Set<string>; toc: boolean }
const pagesByRev = new Map<number, Page[]>();
const pagesOf = (rev: number) => {
  let p = pagesByRev.get(rev);
  if (!p) {
    p = (db.prepare('SELECT page_index, printed_page, text FROM document_pages WHERE revision_id = ? ORDER BY page_index').all(rev) as any[]).map((r) => {
      const raw = decode(r.text);
      const n = norm(raw);
      // contents / index pages (dot leaders) mention every title but explain nothing
      const toc = (raw.match(/\.{5,}|(?:\. ){5,}/g) ?? []).length >= 6;
      return { page_index: r.page_index, printed_page: r.printed_page, n: ` ${n} `, words: new Set(n.split(' ')), toc };
    });
    pagesByRev.set(rev, p);
  }
  return p;
};

db.exec(`CREATE TABLE IF NOT EXISTS knowledge_item_pages (
  item_id INTEGER NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  revision_id INTEGER NOT NULL,
  page_index INTEGER NOT NULL,
  printed_page TEXT,
  role TEXT NOT NULL DEFAULT 'related' CHECK (role IN ('primary','related')),
  PRIMARY KEY (item_id, revision_id, page_index)
)`);

// Section spans: a section runs from its last extracted page to the page where the next recorded section starts.
// Pages in between continue the section; they are linked only if their text shares topic words with the item.
const allItems = db.prepare('SELECT revision_id, section, MIN(page_index) lo, MAX(page_index) hi FROM knowledge_items WHERE section IS NOT NULL GROUP BY revision_id, section').all() as any[];
const spanEnd = new Map<string, number>();
for (const rev of new Set(allItems.map((r) => r.revision_id))) {
  const secs = allItems.filter((r) => r.revision_id === rev);
  for (const sc of secs) {
    const later = secs.filter((o) => o.lo > sc.hi).map((o) => o.lo);
    spanEnd.set(`${rev}|${sc.section}`, later.length ? Math.min(...later) : sc.hi + 2);
  }
}

const items = db.prepare('SELECT id, kind, code, title, section, revision_id, page_index, printed_page FROM knowledge_items').all() as any[];
const ins = db.prepare('INSERT OR IGNORE INTO knowledge_item_pages(item_id, revision_id, page_index, printed_page, role) VALUES (?,?,?,?,?)');
const stats: Record<string, { items: number; extra: number }> = {};
let added = 0;

db.transaction(() => {
  if (apply) db.prepare("DELETE FROM knowledge_item_pages WHERE role = 'related'").run(); // the computed set is authoritative
  for (const it of items) {
    const st = (stats[it.kind] ??= { items: 0, extra: 0 });
    st.items++;
    if (apply) ins.run(it.id, it.revision_id, it.page_index, it.printed_page, 'primary');
    const pages = pagesOf(it.revision_id);
    const title = norm(it.title ?? '');
    const section = norm(String(it.section ?? '').replace(/^[\d.]+\s*/, ''));
    const titleWords = sig(it.title ?? '');
    const code = it.code ? norm(String(it.code)) : '';
    const scored: { p: Page; s: number }[] = [];
    for (const p of pages) {
      if (p.page_index === it.page_index || p.toc) continue;
      const near = Math.abs(p.page_index - it.page_index) <= WINDOW;
      let s = 0;
      if (near) {
        if (section.length >= 8 && p.n.includes(` ${section} `)) s += 2;
        if (title.length >= 10 && p.n.includes(` ${title} `)) s += 3;
      }
      if (CODE_KINDS.has(it.kind) && code.length >= 2 && titleWords.length >= 2 && p.n.includes(` ${code} `)) {
        const cover = titleWords.filter((w) => p.words.has(w)).length / titleWords.length;
        if (cover >= 0.8) s += 3;
      }
      // continuation page of the same section (between this topic's page and the next recorded section)
      const end = it.section ? spanEnd.get(`${it.revision_id}|${it.section}`) : undefined;
      if (end !== undefined && p.page_index > it.page_index && p.page_index < Math.max(end, it.page_index + 1) && p.page_index - it.page_index <= 3) {
        const topic = [...new Set([...sig(it.title ?? ''), ...sig(String(it.section ?? '').replace(/^[\d.]+\s*/, ''))])];
        const shared = topic.filter((w) => p.words.has(w)).length;
        if (shared >= Math.min(3, Math.max(2, Math.ceil(topic.length * 0.5)))) s += 3;
      }
      if (s >= 3) scored.push({ p, s });
    }
    const pick = scored.sort((a, b) => b.s - a.s || Math.abs(a.p.page_index - it.page_index) - Math.abs(b.p.page_index - it.page_index)).slice(0, MAX_EXTRA);
    st.extra += pick.length;
    if (apply) for (const { p } of pick) added += ins.run(it.id, it.revision_id, p.page_index, p.printed_page, 'related').changes;
  }
})();

console.log(JSON.stringify(stats, null, 1));
console.log(apply ? `linked: ${added} related page links` : '(dry run — pass --apply to store)');

if (process.argv.includes('--sample')) {
  const rows = db.prepare('SELECT k.id, k.kind, k.code, k.title, k.page_index, GROUP_CONCAT(p.page_index) pages FROM knowledge_items k JOIN knowledge_item_pages p ON p.item_id = k.id AND p.role = \'related\' GROUP BY k.id ORDER BY (k.id * 7919) % 101 LIMIT 14').all() as any[];
  for (const r of rows) console.log(`${r.kind} ${r.code ?? ''} "${String(r.title).slice(0, 50)}" p${r.page_index} + [${r.pages}]`);
}
