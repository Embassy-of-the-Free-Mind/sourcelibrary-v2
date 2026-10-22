// PRIOR ART: scripts/eval/fragment-sort/fetch-originals.mjs (#7065) reads the OCR of pages a laptop harvest already
// found; here the harvest itself runs on the box, through Atlas Search (pages_search) with the window cut server-side,
// so only matched windows cross the wire. Lanes are in lanes.mjs. none fits #7117 as it was.
//
// Read-only. For each lane: Atlas Search finds candidate pages, $regexFindAll runs the lane's PCRE over the raw field,
// and each match comes back as a window (BEFORE + AFTER code points). Rows from books that are not public
// (visible && pages_count > 0, from the nightly mirror) are dropped. For every hit page the OTHER field (translation
// for an OCR lane, OCR for a translation lane) is fetched too, trimmed, so the classifier can read both.
// Each lane writes $OUT/<lane>.jsonl.gz and a .done marker; a rerun skips finished lanes (checkpoint).
//
// Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/harmony-census/harvest.mjs <outdir> [lane-id|def|topos ...]
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openMirror } from '../../lib/mirror.mjs';
import { LANES } from './lanes.mjs';

const [OUT, ...want] = process.argv.slice(2);
if (!OUT) { console.error('usage: harvest.mjs <outdir> [lane ids | def | topos]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const lanes = LANES.filter((l) => !want.length || want.includes(l.id) || want.includes(l.family));
const BEFORE = 400, AFTER = 700, MAX_MATCHES = 12, OTHER_MAX = 8000;

// Public catalogue, once, from the mirror (no Atlas scan): id → title, author, year, language, work.
const catFile = path.join(OUT, 'catalog.json');
let cat;
if (fs.existsSync(catFile)) cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
else {
  const m = openMirror({ collections: ['books'] });
  console.log(m.describe());
  const rows = m.query(`SELECT coalesce(id->>'$', _id) AS id, coalesce(display_title->>'$', title->>'$') AS t, author->>'$' AS a,
    year->>'$' AS y, published->>'$' AS pub, language->>'$' AS lang, work_id->>'$' AS w
    FROM books WHERE visible::BOOLEAN AND pages_count::INT > 0`);
  cat = Object.fromEntries(rows.map((r) => [r.id, { t: r.t, a: r.a, y: r.y, pub: r.pub, lang: r.lang, w: r.w }]));
  fs.writeFileSync(catFile, JSON.stringify(cat));
}
console.log('public books', Object.keys(cat).length);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pages = c.db('bookstore').collection('pages');

for (const lane of lanes) {
  const file = path.join(OUT, `${lane.id}.jsonl.gz`), done = file + '.done';
  if (fs.existsSync(done)) { console.log(lane.id, 'done already'); continue; }
  const t0 = Date.now();
  const f = '$' + lane.field;
  const pipeline = [
    { $search: { index: 'pages_search', ...lane.search } },
    { $project: { _id: 0, book_id: 1, page_number: 1, src: { $ifNull: [f, ''] } } },
    { $project: { book_id: 1, page_number: 1, src: 1, m: { $slice: [{ $regexFindAll: { input: '$src', regex: lane.regex, options: lane.opts ?? 'i' } }, MAX_MATCHES] } } },
    { $match: { 'm.0': { $exists: true } } },
    { $project: { book_id: 1, page_number: 1, len: { $strLenCP: '$src' },
      w: { $map: { input: '$m', as: 'x', in: { idx: '$$x.idx', match: '$$x.match',
        win: { $substrCP: ['$src', { $max: [0, { $subtract: ['$$x.idx', BEFORE] }] }, BEFORE + AFTER] },
        off: { $min: ['$$x.idx', BEFORE] } } } } } },
  ];
  // Collect the (small) hit rows first, then fetch the other field in batches: no cursor is held open across slow work.
  const hits = [];
  let seen = 0;
  for await (const r of pages.aggregate(pipeline, { maxTimeMS: 3_600_000, batchSize: 500 })) {
    seen++;
    const b = cat[r.book_id];
    if (!b) continue;
    hits.push({ lane: lane.id, id: r.book_id, p: r.page_number, len: r.len, w: r.w });
  }
  const other = lane.field === 'ocr.data' ? 'translation.data' : 'ocr.data';
  for (let i = 0; i < hits.length; i += 400) {
    const chunk = hits.slice(i, i + 400);
    const rows = await pages.find({ $or: chunk.map((h) => ({ book_id: h.id, page_number: h.p })) },
      { projection: { _id: 0, book_id: 1, page_number: 1, [other]: 1 } }).toArray();
    const by = new Map(rows.map((r) => [`${r.book_id}:${r.page_number}`, other.split('.').reduce((o, k) => o?.[k], r) || '']));
    for (const h of chunk) h.other = (by.get(`${h.id}:${h.p}`) || '').slice(0, OTHER_MAX);
  }
  fs.writeFileSync(file, zlib.gzipSync(hits.map((h) => JSON.stringify(h)).join('\n') + '\n'));
  fs.writeFileSync(done, JSON.stringify({ lane: lane.id, searched: seen, public_pages: hits.length, books: new Set(hits.map((h) => h.id)).size, windows: hits.reduce((a, h) => a + h.w.length, 0), s: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }));
  console.log(lane.id, fs.readFileSync(done, 'utf8'));
}
await c.close();
