#!/usr/bin/env node
/**
 * Draw and freeze a RANDOM benchmark sample, and dump each book's front matter
 * for independent readers.
 *
 * The first benchmark took the first twenty rows of a filtered list — a
 * convenience sample. Checked afterwards it was HARDER than the pool (60% of its
 * evidence sat on a page other than a title page, against 40% in the rest), so
 * the direction of the bias was benign, but the draw was still wrong and the
 * result could not carry a significance claim (McNemar p = 0.070 on 18 rows).
 *
 * This draws at random, writes the draw to disk before anything reads a page, and
 * never re-draws — so the sample cannot drift toward whatever the readers turn
 * out to be good at. Re-running reuses the frozen draw.
 *
 * Usage: node --env-file=.env.production.local scripts/audit/titlepage-benchmark-draw.mjs --n=50
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { attributionWindowOf } from '../lib/title-page-ocr.mjs';

const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1] || 50);
const DRAW = 'scripts/output/titlepage-benchmark-sample.json';
const DIR = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/99d9b906-8887-4b60-ab4c-e4747d013447/scratchpad/bench50';

const PLACEHOLDER = /^(unknown|anonymous|anon|n\/?a|none|s\.?\s*n\.?|sine nomine|no author|not stated|unbekannt|onbekend|\[?unknown author\]?)$/i;
const NONLATIN = new Set(['Chinese', 'Literary Chinese', 'Classical Chinese', 'Japanese', 'Korean', 'Tibetan', 'Arabic', 'Persian', 'Hebrew', 'Sanskrit', 'Sumerian', 'Syriac', 'Armenian', 'Malay']);

const rows = readFileSync('scripts/output/titlepage-attribution-proposals.jsonl', 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.proposed)
  .filter((r) => !r.catalogued_author || PLACEHOLDER.test(String(r.catalogued_author).trim()));
const byBook = new Map();
for (const r of rows) {
  const cur = byBook.get(r.book_id);
  if (!cur || (r.page_type === 'title-page' && cur.page_type !== 'title-page')) byBook.set(r.book_id, r);
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const all = [...byBook.values()];
const meta = new Map();
for (let i = 0; i < all.length; i += 400) {
  for (const b of await db.collection('books').find({ id: { $in: all.slice(i, i + 400).map((r) => r.book_id) } },
    { projection: { id: 1, language: 1, year: 1, published: 1, provider: 1 } }).toArray()) meta.set(b.id, b);
}
const pool = all.filter((r) => !NONLATIN.has(meta.get(r.book_id)?.language));

let draw;
if (existsSync(DRAW)) {
  draw = JSON.parse(readFileSync(DRAW, 'utf8'));
  console.log(`reusing frozen draw of ${draw.book_ids.length} from ${draw.drawn_at}`);
} else {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  draw = { drawn_at: new Date().toISOString(), pool_size: pool.length, n: Math.min(N, pool.length), book_ids: shuffled.slice(0, N).map((r) => r.book_id) };
  writeFileSync(DRAW, JSON.stringify(draw, null, 1));
  console.log(`drew ${draw.book_ids.length} at random from a pool of ${pool.length}; frozen to ${DRAW}`);
}

mkdirSync(DIR, { recursive: true });
const index = [];
for (const [i, bookId] of draw.book_ids.entries()) {
  const r = byBook.get(bookId);
  const win = await attributionWindowOf(db.collection('pages'), { id: bookId });
  if (!win.length) continue;
  const m = meta.get(bookId) ?? {};
  const n = String(i + 1).padStart(2, '0');
  // The reader sees the pages and the catalogue header. It does NOT see what any
  // other reader proposed — that is the whole point.
  writeFileSync(`${DIR}/book-${n}.txt`, [
    `CATALOGUE TITLE : ${r.title}`,
    `CATALOGUE BYLINE: ${r.catalogued_author ?? '(none)'}`,
    `LANGUAGE / YEAR : ${m.language ?? '?'} / ${m.year ?? m.published ?? '?'}`,
    '', '=== FRONT MATTER, AS TRANSCRIBED FROM THE SCANS ===', '',
    ...win.map((w) => `--- PAGE ${w.page_number} [${w.page_type}${w.untyped_fallback ? ', page type not labelled — this is a guess' : ''}] ---\n${w.prose.slice(0, 2600)}`),
  ].join('\n'));
  index.push({ n, book_id: bookId, title: r.title, flash_lite: r.proposed, flash_lite_quote: r.quoted_line, page_type: r.page_type, language: m.language, year: m.year ?? m.published });
}
await mc.close();
writeFileSync(`${DIR}/index.json`, JSON.stringify(index, null, 1));
console.log(`wrote ${index.length} window files to ${DIR}`);
console.log(`flash-lite's answers are recorded in index.json but NOT in the window files.`);
