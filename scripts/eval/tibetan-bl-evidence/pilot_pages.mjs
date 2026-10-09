// PRIOR ART: scripts/eval/tengyur-ref/dump-pages.mjs (dumps Tengyur volumes for run-arms.mjs in its pages/ format).
// That reads whole Tengyur volumes by edition; this takes a 10-page window of each pilot BL Kangyur book (#4523 C),
// plus the page before (run-arms' lead-in), in the same pages/ + ref/ format so run-arms.mjs runs on it unchanged.
// Read-only. Also records the CURRENT served English per page (the judge's comparison candidate).
//   node --env-file=/root/sourcelibrary/.env.production.local pilot_pages.mjs <c-candidates.json> <outDir> <bookId>...
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
const [candFile, OUT, ...ids] = process.argv.slice(2);
const cand = JSON.parse(fs.readFileSync(candFile, 'utf8'));
fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'ref'), { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = {}, refRows = [];
for (const id of ids) {
  const ps = cand[id].map((x) => x[0]).sort((a, b) => a - b);
  let best = ps[0], bestN = 0;
  for (const p of ps) { const n = ps.filter((q) => q >= p && q <= p + 9).length; if (n > bestN) { best = p; bestN = n; } }
  const lo = best, hi = best + 9;
  const b = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, translation_context: 1, categories: 1 } });
  books[id] = b;
  const pages = await db.collection('pages').find({ book_id: id, page_number: { $gte: lo - 1, $lte: hi } },
    { projection: { _id: 1, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.verdict.verdict': 1, 'ocr.unreadable': 1, 'translation.data': 1, 'translation.model': 1 } }).sort({ page_number: 1 }).toArray();
  const rows = pages.map((p) => ({ vol: id, book_id: id, page_id: p.id || String(p._id), page_number: p.page_number,
    src: p.ocr?.unreadable ? '' : (p.ocr?.data || ''), ocr_model: p.ocr?.model || null, verdict: p.ocr?.verdict?.verdict || null,
    current_en: p.translation?.data || '', current_en_model: p.translation?.model || null }));
  fs.writeFileSync(path.join(OUT, 'pages', `${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const r of rows) if (r.page_number >= lo) refRows.push({ toh: id, vol: id, page_number: r.page_number, page_id: r.page_id });
  console.log(id, `pp.${lo}-${hi}`, `anchors in window ${bestN}`, rows.map((r) => `${r.page_number}:${(r.ocr_model || '-').slice(0, 12)}/${r.verdict || '-'}/${r.src.length}`).join(' '));
}
fs.writeFileSync(path.join(OUT, 'pages', 'books.json'), JSON.stringify(books));
fs.writeFileSync(path.join(OUT, 'ref', 'reference.jsonl'), refRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
await c.close();
