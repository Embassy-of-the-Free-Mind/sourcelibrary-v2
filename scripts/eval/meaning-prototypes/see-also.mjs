/**
 * PRIOR ART: scripts/eval/embed-granularity/run-arms.mjs — ranks the #6173 pool
 * for a typed QUERY under several arms and scores them; it never uses a page as
 * the query. src/lib/related-books.ts — "related books" by author, subject and
 * era, no vectors and no passages. Nothing in the repo proposes passages in
 * other traditions from the page a reader is on.
 *
 * Prototype for #6201: from one page, the same idea in other traditions.
 *
 * Reuses the #6173 pool (12,154 English pages from 304 books, each book with a
 * by-eye tradition label) and its two vector sets, both on disk already:
 *   page     the stored page vector (the translation text);
 *   concept  the vector of a two-sentence plain-language abstract of the page.
 * The seed pages are the gold set's "central" passages: pages a reader judged
 * to be squarely about one of 25 ideas. For each seed and each vector set, the
 * script takes the nearest page from each OTHER tradition (never the seed's own
 * book), and keeps the three closest traditions.
 *
 * Score: is each proposed page known to be about the seed's idea? The gold set
 * and the #6173 judgments give a by-eye verdict for some pages and none for
 * most, so every proposal is counted as relevant, not relevant, or not judged.
 *
 * Usage: node scripts/eval/meaning-prototypes/see-also.mjs --pool <dir> --out <dir>
 * No model calls. Reads files only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { arg, loadPool, loadVecs, DIMS } from '../embed-granularity/lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const POOL = arg('--pool');
const OUT = arg('--out');
if (!POOL || !OUT) { console.error('need --pool and --out'); process.exit(1); }

const pool = loadPool(POOL);
const labels = JSON.parse(fs.readFileSync(path.join(POOL, 'labels.json'), 'utf8'));
const abstracts = fs.readFileSync(path.join(POOL, 'abstracts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const abstractOf = new Map(abstracts.map((a) => [a.i, a.abstract]));
const sets = { page: loadVecs(path.join(POOL, 'vec-a.f32')), concept: loadVecs(path.join(POOL, 'vec-c.f32')) };
const gold = JSON.parse(fs.readFileSync(path.join(HERE, '../embed-granularity/gold.json'), 'utf8'));
const judgments = JSON.parse(fs.readFileSync(path.join(HERE, '../embed-granularity/results/judgments.json'), 'utf8'));
const trad = (i) => labels[pool[i].book_id] || 'other';

/** Known verdict for pool page i on query qid: true, false, or null (never judged). */
function verdict(q, i) {
  if (q.passages.some((p) => p.i === i)) return true;
  const j = judgments[q.qid]?.[String(i)];
  return j ? j.g === 2 : null; // 2 = states or develops the idea; 1 = touches it; 0 = not about it
}

function seeAlso(vecs, seed, k = 3) {
  const o = seed * DIMS;
  const best = new Map(); // tradition -> {i, sim}
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].book_id === pool[seed].book_id) continue;
    const t = trad(i);
    if (t === trad(seed) || t === 'other') continue;
    let s = 0; const p = i * DIMS;
    for (let d = 0; d < DIMS; d++) s += vecs[o + d] * vecs[p + d];
    const b = best.get(t);
    if (!b || s > b.sim) best.set(t, { i, sim: s, tradition: t });
  }
  return [...best.values()].sort((a, b) => b.sim - a.sim).slice(0, k);
}

const tally = { page: { rel: 0, not: 0, unk: 0 }, concept: { rel: 0, not: 0, unk: 0 } };
const rows = [];
for (const q of gold.queries) {
  for (const p of q.passages.filter((x) => x.strength === 'central')) {
    const row = { qid: q.qid, idea: q.query, seed: { i: p.i, tradition: trad(p.i), title: pool[p.i].title, author: pool[p.i].author, year: pool[p.i].year, url: p.url, quote: p.quote, abstract: abstractOf.get(p.i) }, arms: {} };
    for (const [arm, vecs] of Object.entries(sets)) {
      row.arms[arm] = seeAlso(vecs, p.i).map((h) => {
        const v = verdict(q, h.i);
        tally[arm][v === true ? 'rel' : v === false ? 'not' : 'unk']++;
        const pg = pool[h.i];
        return { i: h.i, sim: +h.sim.toFixed(3), tradition: h.tradition, verdict: v, title: pg.title, author: pg.author, year: pg.year, language: pg.language, book_id: pg.book_id, page_number: pg.page_number, url: `https://sourcelibrary.org/book/${pg.book_id}?page=${pg.page_number}`, abstract: abstractOf.get(h.i), text: pg.text.slice(0, 1200) };
      });
    }
    rows.push(row);
  }
}
console.log(`${rows.length} seed pages, 3 proposals each`);
for (const [arm, t] of Object.entries(tally)) {
  const n = t.rel + t.not + t.unk;
  console.log(`${arm}: known relevant ${t.rel}/${n} (${(100 * t.rel / n).toFixed(0)}%), known not relevant ${t.not}, never judged ${t.unk}; of the judged, ${(100 * t.rel / Math.max(1, t.rel + t.not)).toFixed(0)}% relevant`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'see-also.json'), JSON.stringify({ tally, rows }, null, 1));
