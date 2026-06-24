#!/usr/bin/env node
/**
 * Map our Mongo books onto catalog works -> work_holdings (#2453).
 *
 * v1 matching is deliberately conservative (matched_by 'title-auto'):
 *  - Chinese works: extract CJK runs from the book title, variant-normalize,
 *    exact-match against works.title_normalized (tradition 'chinese').
 *    Longest CJK run wins; runs < 2 chars ignored.
 *  - Other traditions: exact match of the full normalized book title against
 *    title_normalized or title_romanized (case-insensitive) — rare, but free.
 * No fuzzy matching in v1: a wrong holding is worse than a missing one.
 * Re-runnable; clears and rebuilds only rows with matched_by 'title-auto'.
 *
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/build-holdings.mjs
 */
import { MongoClient } from 'mongodb';
import { pgClient, normalizeCjk } from './lib.mjs';

const client = pgClient();
await client.connect();

// works lookup
const works = await client.query(`select id, tradition, title_normalized, title_romanized from works`);
const cjkByNorm = new Map();
const romByNorm = new Map();
for (const w of works.rows) {
  if (w.tradition === 'chinese' && w.title_normalized && !cjkByNorm.has(w.title_normalized)) {
    cjkByNorm.set(w.title_normalized, w.id);
  }
  if (w.title_romanized) {
    const k = w.title_romanized.toLowerCase().replace(/[^a-z]/g, '');
    if (k.length >= 8 && !romByNorm.has(k)) romByNorm.set(k, w.id);
  }
}
// distinctive (>=16 alpha-char) romanized keys, longest first, for containment
// matching (book titles carry vol/subtitle noise the exact key misses). Long
// threshold keeps precision: a 16-char Wylie/Arabic string rarely collides.
const longRomKeys = [...romByNorm.keys()].filter(k => k.length >= 16).sort((a, b) => b.length - a.length);
console.log(`works: ${works.rows.length} (${cjkByNorm.size} CJK keys, ${romByNorm.size} romanized keys, ${longRomKeys.length} long)`);

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const books = mongo.db('bookstore').collection('books');
const cur = books.find(
  { pages_count: { $gt: 0 } },
  { projection: { title: 1, language: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1, visible: 1 } },
);

const holdings = [];
let scanned = 0;
for await (const b of cur) {
  scanned++;
  const title = String(b.title || '');
  let workId = null;
  // CJK runs, longest first; require >= 2 chars
  const runs = (title.match(/[㐀-鿿]{2,}/g) || []).sort((a, c) => c.length - a.length);
  for (const run of runs) {
    workId = cjkByNorm.get(normalizeCjk(run));
    if (workId) break;
  }
  let matchedBy = runs.length && workId ? 'title-auto' : null;
  if (!workId && !runs.length) {
    const k = title.toLowerCase().replace(/[^a-z]/g, '');
    if (k.length >= 8 && romByNorm.has(k)) { workId = romByNorm.get(k); matchedBy = 'title-auto'; }
    // containment fallback: distinctive work key inside the (noisier) book title
    if (!workId && k.length >= 16) {
      const hit = longRomKeys.find(rk => k.includes(rk));
      if (hit) { workId = romByNorm.get(hit); matchedBy = 'romanized-contains'; }
    }
  }
  if (!workId) continue;
  const readable = (b.pages_ocr || b.pages_count || 0);
  holdings.push({
    work_id: workId,
    book_id: String(b._id),
    matched_by: matchedBy,
    pages: b.pages_count || null,
    translated_pct: readable > 0 ? Math.min(100, Math.round(100 * (b.pages_translated || 0) / readable)) : null,
  });
}
await mongo.close();
const byKind = holdings.reduce((m, h) => ((m[h.matched_by] = (m[h.matched_by] || 0) + 1), m), {});
console.log(`scanned ${scanned} books -> ${holdings.length} matches`, JSON.stringify(byKind));

// rebuild auto rows (keep any future hand-verified rows)
await client.query(`delete from work_holdings where matched_by in ('title-auto','romanized-contains')`);
for (let i = 0; i < holdings.length; i += 500) {
  const chunk = holdings.slice(i, i + 500);
  const values = [];
  const params = [];
  chunk.forEach((h, j) => {
    const base = j * 5;
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
    params.push(h.work_id, h.book_id, h.pages, h.translated_pct, h.matched_by);
  });
  await client.query(
    `insert into work_holdings (work_id, book_id, pages, translated_pct, matched_by)
     values ${values.join(',')}
     on conflict (work_id, book_id) do update set
       pages = excluded.pages, translated_pct = excluded.translated_pct, matched_by = excluded.matched_by`,
    params,
  );
}
const stats = (await client.query(`
  select w.tradition, count(distinct h.work_id) works_held, count(*) books
  from work_holdings h join works w on w.id = h.work_id group by 1`)).rows;
await client.end();
console.log('holdings by tradition:', JSON.stringify(stats));
