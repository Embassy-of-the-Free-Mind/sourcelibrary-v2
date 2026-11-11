// PRIOR ART: scripts/eval/ (INDEX.md lib table: no attribution/fragment matcher; term-harvest.mjs reads a laptop-only sqlite mirror, so this re-reads the same pages from Mongo) — none fits #7065.
// Read-only. For every pre-1700 public book in a harvest file (term-harvest.mjs output), fetch the
// ORIGINAL-language OCR of each passage page that carries an attribution verb (q) or a quotation (quoted).
// Usage: node --env-file=.env.production.local fetch-originals.mjs <harvest.json> <out.jsonl>
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const [IN, OUT] = process.argv.slice(2);
const books = JSON.parse(fs.readFileSync(IN, 'utf8'));
const cands = books
  .filter((b) => b.v && b.y && +b.y < 1700)
  .map((b) => ({ ...b, passages: b.passages.filter((p) => p.q || p.quoted) }))
  .filter((b) => b.passages.length);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pages = c.db('bookstore').collection('pages');
const out = fs.createWriteStream(OUT);
let n = 0;
for (const b of cands) {
  const nums = [...new Set(b.passages.map((p) => p.p))];
  const rows = await pages
    .find({ book_id: b.id, page_number: { $in: nums } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.language': 1 } })
    .toArray();
  const byP = new Map(rows.map((r) => [r.page_number, r]));
  for (const p of b.passages) {
    const r = byP.get(p.p);
    out.write(JSON.stringify({ id: b.id, t: b.t, a: b.a, y: +b.y, lang: b.lang, w: b.w, p: p.p, s: p.s, ctx: p.ctx, q: p.q, quoted: p.quoted, ocr: r?.ocr?.data || '' }) + '\n');
    n++;
  }
}
out.end();
await c.close();
console.log(IN, 'books', cands.length, 'passages', n);
