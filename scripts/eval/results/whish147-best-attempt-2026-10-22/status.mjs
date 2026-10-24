// Per-page outcome of the Whish 147 run (#7119): OCR written by method, translation written, or the recorded reason
// it is not. Writes summary.json here. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, BOOK } from './lib.mjs';
const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const ps = await db.collection('pages').find({ book_id: BOOK }, { projection: { page_number: 1, id: 1, 'ocr.pipeline': 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
const book = await db.collection('books').findOne({ id: BOOK }, { projection: { pages_ocr: 1, pages_translated: 1, visible: 1, 'publication.state': 1, 'pipeline_auto.status': 1 } });
const out = { book, pages: [], by_method: {}, leaves: {} };
for (const p of ps) {
  const f = path.join(HERE, 'pages', `${p.page_number}.json`);
  const P = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const methods = P?.methods?.join('+') || null;
  const row = { n: p.page_number, id: p.id, ocr: p.ocr?.pipeline === 'whish147-best-attempt', warning: !!p.ocr?.data?.startsWith('<warning>'), translation: !!p.translation?.data, tr_warning: !!p.translation?.data?.startsWith('<warning>'), methods };
  if (!row.translation && row.ocr) row.translation_skip = 'refused by the translation write door (collapsed: long OCR, near-empty English); the page carries its OCR warning';
  out.pages.push(row);
  out.by_method[methods || 'none'] = (out.by_method[methods || 'none'] || 0) + 1;
  for (const l of Object.values(P?.leaves || {})) out.leaves[l.method] = (out.leaves[l.method] || 0) + 1;
}
out.no_translation = out.pages.filter((r) => !r.translation).map((r) => r.n);
out.no_ocr = out.pages.filter((r) => !r.ocr).map((r) => r.n);
fs.writeFileSync(path.join(HERE, 'summary.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ book, by_method: out.by_method, leaves: out.leaves, no_ocr: out.no_ocr, no_translation: out.no_translation, bad_warning: out.pages.filter((r) => r.ocr && (!r.warning || (r.translation && !r.tr_warning))).map((r) => r.n) }, null, 1));
await c.close();
