// PRIOR ART: /root/tib-step2/build-todo.mjs (step-2 todo, per book, checkpointed) and
// /root/tibetan-reocr/build-eap-todo.mjs (archived_photo URL, no-image skip file). Same shapes;
// scope here is books-527.jsonl and every page the read can see (page mode was never run on these).
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { isLiteModel, scriptGate as gate } from './lane-lib.mjs';
const DIR = process.env.YIG_DIR || '/root/yig527';
const SKIP_TYPES = new Set(['blank', 'archived-spread']);
const EXCL = JSON.parse(fs.readFileSync(new URL('./exclude-books.json', import.meta.url), 'utf8')).books;
const books = fs.readFileSync(`${DIR}/books-527.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((b) => !EXCL[b.book]);
const m = new MongoClient(process.env.MONGODB_URI); await m.connect();
const db = m.db('bookstore');
const out = fs.createWriteStream(`${DIR}/todo-all.jsonl`); const skip = fs.createWriteStream(`${DIR}/todo-skipped.jsonl`);
const c = { rows: 0, noImage: 0, typeSkip: 0, badKey: 0, lite: 0, flash: 0, none: 0 };
for (const b of books) {
  const pages = await db.collection('pages').find({ book_id: b.book },
    { projection: { id: 1, page_number: 1, page_type: 1, archived_photo: 1, 'ocr.model': 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  for (const p of pages) {
    const base = { id: p.id, book: b.book, page: p.page_number };
    if (SKIP_TYPES.has(p.page_type)) { skip.write(JSON.stringify({ ...base, why: `type:${p.page_type}` }) + '\n'); c.typeSkip++; continue; }
    if (!p.archived_photo) { skip.write(JSON.stringify({ ...base, why: 'no-archived_photo' }) + '\n'); c.noImage++; continue; }
    if (!p.archived_photo.includes(`/${b.book}/`)) { skip.write(JSON.stringify({ ...base, why: 'key-not-book-scoped', url: p.archived_photo }) + '\n'); c.badKey++; continue; }
    const mo = p.ocr?.model || 'none';
    c[isLiteModel(mo) ? 'lite' : mo === 'gemini-3-flash-preview' ? 'flash' : 'none']++;
    out.write(JSON.stringify({ ...base, stem: `${b.book}_${String(p.page_number).padStart(5, '0')}`, url: p.archived_photo, type: p.page_type ?? null, prior: mo, gate: gate(p.ocr?.data) }) + '\n');
    c.rows++;
  }
}
out.end(); skip.end();
console.log(JSON.stringify(c));
await m.close();
