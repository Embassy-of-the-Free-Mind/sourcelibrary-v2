#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-risk-5021.mjs (per-page features, but it pulls every page's full OCR and English
// to run the number classifier; 45 min on 8 shards) and scripts/eval/caseless-shift-5021/extract.mjs (Han/Tibetan only,
// 80 pages a book). Neither keeps what this job needs on EVERY translated page: the write time to the millisecond,
// the English's first and last characters (the "..." continuation markers), and the source's internal rules ("---"),
// so this walks the library once with a server-side projection (lengths and edges only, no texts). Read-only.
/**
 *   node --env-file=.env.production.local scripts/eval/wrong-leaf-find-5021/walk.mjs --out DIR [--shard i/n]
 * One line per translated page (live books: visible, pages_count > 0, pages_translated > 0) into
 * DIR/pages.s<i>.jsonl.gz: b (book), n, t (translation.updated_at ms), m (model), pv, src/en (lengths, code points),
 * h/tl (first/last 24 chars of the English), sh/st (first/last 24 chars of the source prose), hr (count of "---" rule
 * lines inside the source), ty (page_type), wh (withheld), hu (human-edited). Books: DIR/books.jsonl (id, language).
 * Resumable: a shard skips books already in DIR/done.s<i>.txt.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('out'); const [SI, SN] = (arg('shard', '0/1')).split('/').map(Number);
fs.mkdirSync(OUT, { recursive: true });
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const booksFile = `${OUT}/books.jsonl`;
let books;
if (fs.existsSync(booksFile)) books = fs.readFileSync(booksFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
else {
  books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } }, { projection: { _id: 0, id: 1, language: 1, title: 1, pages_translated: 1 } }).toArray();
  books.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (SI === 0) fs.writeFileSync(booksFile, books.map((b) => JSON.stringify(b)).join('\n') + '\n');
}
const mine = books.filter((_, i) => i % SN === SI);
const doneFile = `${OUT}/done.s${SI}.txt`;
const done = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, 'utf8').split('\n').filter(Boolean) : []);
const gz = zlib.createGzip(); const ws = fs.createWriteStream(`${OUT}/pages.s${SI}.${Date.now()}.jsonl.gz`); gz.pipe(ws);
const S = (x) => ({ $cond: [{ $eq: [{ $type: x }, 'string'] }, x, ''] });
let nb = 0, np = 0; const t0 = Date.now();
for (const b of mine) {
  if (done.has(b.id)) continue;
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: b.id, 'translation.data': { $type: 'string' } } },
    { $project: { _id: 0, n: '$page_number', t: '$translation.updated_at', m: '$translation.model', pv: '$translation.prompt_version', ty: '$page_type',
      wh: { $cond: [{ $ifNull: ['$translation_withheld', false] }, 1, 0] }, hu: { $cond: [{ $or: [{ $ifNull: ['$translation.edited_by', false] }, { $in: ['$translation.source', ['human', 'manual']] }] }, 1, 0] },
      tr: S('$translation.data'), oc: S('$ocr.data') } },
    { $project: { n: 1, t: 1, m: 1, pv: 1, ty: 1, wh: 1, hu: 1, en: { $strLenCP: '$tr' }, src: { $strLenCP: '$oc' },
      h: { $substrCP: ['$tr', 0, 24] }, tl: { $substrCP: ['$tr', { $max: [0, { $subtract: [{ $strLenCP: '$tr' }, 24] }] }, 24] },
      st: { $substrCP: ['$oc', { $max: [0, { $subtract: [{ $strLenCP: '$oc' }, 60] }] }, 60] },
      hr: { $size: { $regexFindAll: { input: '$oc', regex: /\n\s*(?:-{3,}|\*{3,}|_{3,})\s*\n/ } } } } },
  ], { allowDiskUse: false }).toArray();
  for (const r of rows) { r.b = b.id; r.t = r.t ? new Date(r.t).getTime() : null; gz.write(JSON.stringify(r) + '\n'); }
  fs.appendFileSync(doneFile, b.id + '\n');
  nb++; np += rows.length;
  if (nb % 200 === 0) console.log(new Date().toISOString(), `s${SI}`, nb, '/', mine.length - done.size, 'books', np, 'pages', Math.round((Date.now() - t0) / 1000) + 's');
}
gz.end(); await new Promise((r) => ws.on('close', r));
console.log('DONE', SI, nb, np);
await c.close();
