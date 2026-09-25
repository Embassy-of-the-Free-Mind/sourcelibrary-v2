// PRIOR ART: scripts/eval/lib/sampling.mjs (samplePages / getPage) — samples pages for paid evals; this needs EVERY
// page of a named book with its OCR and translation text stripped of markup, written to a file the Python scorers
// read. Kept deliberately tiny.
//
// usage (repo root, env loaded): node scripts/eval/syriac-vs-published/dump-pages.mjs <outDir> <bookId> [<bookId>…]
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const [outDir, ...ids] = process.argv.slice(2);
if (!outDir || !ids.length) { console.error('usage: dump-pages.mjs <outDir> <bookId>…'); process.exit(1); }
const strip = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
fs.mkdirSync(outDir, { recursive: true });
for (const bid of ids) {
  const out = fs.createWriteStream(path.join(outDir, `${bid}.jsonl`));
  const cur = db.collection('pages').find({ book_id: bid }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, display_photo: 1, photo: 1, page_type: 1 } }).sort({ page_number: 1 });
  let n = 0, o = 0, t = 0;
  for await (const p of cur) {
    n++; if (p.ocr?.data) o++; if (p.translation?.data) t++;
    out.write(JSON.stringify({ pn: p.page_number, type: p.page_type, model: p.ocr?.model, ocr: strip(p.ocr?.data), tr: strip(p.translation?.data), tr_model: p.translation?.model, img: p.display_photo, src: p.photo }) + '\n');
  }
  out.end(); console.log(bid, 'pages', n, 'ocr', o, 'tr', t);
}
await c.close();
