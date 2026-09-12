// Find printed arabic numerals in BNCF Aldine scans 1499-1520 via OCR.
import { MongoClient } from '/Users/dereklomas/sourcelibrary/node_modules/mongodb/lib/index.js';
import fs from 'fs';
const c = await new MongoClient(process.env.MONGODB_URI).connect();
const db = c.db('bookstore');
const books = await db.collection('books').find(
  { ia_identifier: /^ita-bnc-ald/, language: /latin/i, pages_count: { $gt: 40 } },
  { projection: { id: 1, ia_identifier: 1, title: 1, published: 1, year: 1 } }).toArray();
const yr = b => { const m = String(b.year || b.published || '').match(/1[45]\d\d/); return m ? +m[0] : 0; };
const cands = books.filter(b => yr(b) >= 1499 && yr(b) <= 1520).sort((a, b) => yr(a) - yr(b));
console.error('candidate books', cands.length);
const bad = /ProQuest|Nencini|©|inc\.|Early European|Copyright|Biblioteca|Ex Libris|shelfmark|pencil|manuscript|handwritten|note|Latin\s+text\s+\d|title-page|\b1[89]\d\d\b|\b20\d\d\b/i;
const out = [];
for (const b of cands) {
  const cur = db.collection('pages').find({ book_id: b.id, page_number: { $gt: 4 } }, { projection: { page_number: 1, 'ocr.data': 1 } });
  let n = 0;
  for await (const p of cur) {
    const t = ((p.ocr && p.ocr.data) || '');
    // only the body after the tag header
    const body = t.replace(/<[^>]+>/g, ' ');
    const re = /(^|[\s.,;:(])([0-9]{2,4})(?=[\s.,;:)]|$)/g; let m;
    while ((m = re.exec(body))) {
      const snip = body.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ');
      if (bad.test(snip)) continue;
      out.push({ year: yr(b), ia: b.ia_identifier, page: p.page_number, num: m[2], snip });
      if (++n > 6) break;
    }
    if (n > 6) break;
  }
}
await c.close();
const byBook = {};
for (const o of out) (byBook[o.ia] ||= []).push(o);
for (const [ia, v] of Object.entries(byBook)) {
  console.log(`\n${v[0].year} ${ia} (${v.length} hits)`);
  for (const h of v.slice(0, 4)) console.log(`   p${h.page} [${h.num}] …${h.snip}…`);
}
fs.writeFileSync('/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/e9206fa7-e6dd-4621-9312-2ab6aa55dc1a/scratchpad/aetna/digit_hits.json', JSON.stringify(out));
