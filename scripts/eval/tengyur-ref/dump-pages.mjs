#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-pilot-qa/dump.mjs (PR #5676) — dumps only the pilot's TRANSLATED
// pages of 5 volumes, selected by model + updated_at; this test needs every page (translated or not)
// of the volumes that carry an 84000-published Tengyur text, with the e-text's folio + Tohoku marks.
/**
 * dump-pages.mjs — read-only dump of whole Derge Tengyur volumes for the 84000-reference test (#5497).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-ref/dump-pages.mjs \
 *        --vols 3,4,28 --out /root/tref/pages
 *
 * Writes <out>/v<vol>.jsonl (one page per line, page order) and <out>/books.json (the book docs, which
 * the prompt builders read). Never writes to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const vols = String(arg('vols', '')).split(',').filter(Boolean).map(Number);
const out = arg('out', '/root/tref/pages');
fs.mkdirSync(out, { recursive: true });

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ 'catalog_ids.derge_tengyur_volume': { $in: vols } }).toArray();
const booksOut = {};
for (const b of books) {
  const vol = b.catalog_ids.derge_tengyur_volume;
  booksOut[vol] = b;
  const lines = [];
  const cur = db.collection('pages').find({ book_id: b.id }, {
    projection: { id: 1, book_id: 1, page_number: 1, page_label: 1, page_type: 1, photo: 1, archived_photo: 1, ocr: 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1 },
  }).sort({ page_number: 1 });
  for await (const p of cur) {
    lines.push(JSON.stringify({
      vol, book_id: b.id, page_id: p.id, page_number: p.page_number, page_label: p.page_label, page_type: p.page_type || null,
      image: p.archived_photo || p.photo || null,
      folio: p.ocr?.text_edition?.folio || null, tohoku: p.ocr?.text_edition?.tohoku || [],
      src: p.ocr?.data || '', ocr: p.ocr ? { data: p.ocr.data, source: p.ocr.source } : null,
      prod_en: p.translation?.data || null, prod_model: p.translation?.model || null, prod_prompt: p.translation?.prompt_version || null,
    }));
  }
  fs.writeFileSync(path.join(out, `v${vol}.jsonl`), lines.join('\n') + '\n');
  console.log(`v${vol} ${b.id} ${lines.length} pages`);
}
fs.writeFileSync(path.join(out, 'books.json'), JSON.stringify(booksOut));
await c.close();
