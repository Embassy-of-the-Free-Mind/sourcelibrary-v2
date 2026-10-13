#!/usr/bin/env node
// PRIOR ART: build-edition-refs.mjs (cuts a page window from a whole edition, but one page at a time against
// the production read, for SCORING; it writes refs, not line-level training data), open-engine-print-5660.mjs
// (assembles bench roots from sealed strata). Neither dumps every page of a book with its image URL and stored
// read for a training-data aligner; this is that dump, nothing else.
/**
 * dump-pages.mjs — for each book id, write <out>/<book>.json: page_number, image URL (R2 archive first),
 * and the stored OCR text (tags stripped) with its model/source. Read-only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/kraken-ft-5730/dump-pages.mjs \
 *     --books=a,b,c --out=/root/kraken-ft-5730/pages
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const BOOKS = argOf('books', '').split(',').filter(Boolean);
const OUT = argOf('out', '/root/kraken-ft-5730/pages');
fs.mkdirSync(OUT, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
for (const id of BOOKS) {
  const b = await db.collection('books').findOne({ $or: [{ id }, { _id: id }] }, { projection: { id: 1, title: 1, language: 1, published: 1, ia_identifier: 1, pages_count: 1 } });
  if (!b) { console.log(`${id}: not found`); continue; }
  const ps = await db.collection('pages').find({ book_id: b.id }, { projection: { page_number: 1, photo: 1, archived_photo: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const pages = ps.map(p => ({
    page_number: p.page_number,
    image_url: typeof p.archived_photo === 'string' && p.archived_photo.startsWith('http') ? p.archived_photo : p.photo,
    ocr_model: p.ocr?.model || null, ocr_source: p.ocr?.source || null,
    ocr_text: p.ocr?.data ? stripMarkupTags(String(p.ocr.data).replace(/<(scan-quality|language|script|page-type|image-desc|warning|meta|note|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')) : '',
  }));
  fs.writeFileSync(path.join(OUT, `${b.id}.json`), JSON.stringify({ book_id: b.id, title: b.title, language: b.language, published: b.published, ia: b.ia_identifier, pages }, null, 1));
  console.log(`${b.id}: ${pages.length} pages, ${pages.filter(p => p.ocr_text.length > 50).length} with stored OCR`);
}
await c.close();
