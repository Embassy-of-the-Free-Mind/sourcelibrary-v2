#!/usr/bin/env node
// PRIOR ART: scripts/eval/reocr-lift-5700/ sizing (counts by page script_type over live translated
// pages; no page list, no hold / human-edit exclusion). scripts/batch/bulk-reocr-local.mjs takes a
// page list but does not build one by served model + book_class.
//
// Stage 1 of #5813 — select, $0, read-only. Pages whose served OCR was written by flash-lite, in
// books whose book_class.script_family is greek (#5768). Excludes held books, human-edited pages,
// hidden spread originals (page_number <= 0) and pages with no image. Writes one JSONL row per page
// and prints the split by book_class.class and visible / hidden.
//
//   node --env-file=.env.production.local scripts/batch/greek-reocr-5813/select.mjs --out=DIR
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { isHeld } from '../../lib/pipeline-hold.mjs';
import { translationText, isPlaceholderTranslation } from '../../lib/stale-translation.mjs';

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '.';
export const LITE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];

const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find(
  { 'book_class.script_family': 'greek', deleted: { $ne: true } },
  { projection: { _id: 0, id: 1, title: 1, language: 1, year: 1, published: 1, visible: 1, pages_count: 1, 'book_class.class': 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'image_source.provider': 1 } },
).toArray();
console.error(`${books.length} books with book_class.script_family = greek`);

const out = fs.createWriteStream(`${OUT}/pages.jsonl`);
const bookRows = [];
const skip = { held_book_pages: 0, held_books: 0, human_edited: 0, no_image: 0, hidden_page_number: 0, in_live_job: 0 };
const cell = {};
let n = 0;
for (const b of books) {
  const pages = await db.collection('pages').find(
    { book_id: b.id, 'ocr.model': { $in: LITE_MODELS }, 'ocr.data': { $exists: true, $nin: [null, ''] } },
    { projection: { _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, script_type: 1, page_type: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1, 'ocr.output_tokens': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.model': 1, ocr_len: { $strLenCP: { $ifNull: ['$ocr.data', ''] } } } },
  ).toArray();
  if (++n % 200 === 0) console.error(`  ${n}/${books.length}`);
  if (!pages.length) continue;
  if (isHeld(b) || b.pipeline_auto?.status === 'held') { skip.held_books++; skip.held_book_pages += pages.length; bookRows.push({ id: b.id, held: true, reason: b.pipeline_auto?.hold?.reason ?? null, lite_pages: pages.length }); continue; }
  let kept = 0, translated = 0;
  for (const p of pages) {
    if (!(p.page_number > 0)) { skip.hidden_page_number++; continue; }
    if (p.ocr.source === 'manual' || p.ocr.edited_by) { skip.human_edited++; continue; }
    if (!p.photo && !p.photo_original) { skip.no_image++; continue; }
    const tr = !!translationText(p.translation) && !isPlaceholderTranslation(p.translation);
    const trHuman = p.translation?.source === 'manual' || !!p.translation?.edited_by;
    kept++; if (tr) translated++;
    const k = `${b.book_class?.class ?? 'unknown'}|${b.visible === true ? 'visible' : 'hidden'}`;
    cell[k] ??= { books: new Set(), pages: 0, translated: 0 };
    cell[k].books.add(b.id); cell[k].pages++; if (tr) cell[k].translated++;
    out.write(JSON.stringify({ page_id: p.id, book_id: b.id, n: p.page_number, cls: b.book_class?.class ?? null, visible: b.visible === true, model: p.ocr.model, ocr_len: p.ocr_len, script_type: p.script_type ?? null, unreadable: p.ocr.unreadable === true, tr, tr_human: trHuman, tr_model: p.translation?.model ?? null }) + '\n');
  }
  bookRows.push({ id: b.id, title: (b.title || '').slice(0, 80), language: b.language, year: b.year ?? b.published ?? null, visible: b.visible === true, cls: b.book_class?.class ?? null, status: b.pipeline_auto?.status ?? null, provider: b.image_source?.provider ?? null, lite_pages: kept, translated });
}
out.end();
const summary = { at: new Date().toISOString(), greek_books: books.length, skip, cells: Object.fromEntries(Object.entries(cell).map(([k, v]) => [k, { books: v.books.size, pages: v.pages, translated: v.translated }])) };
fs.writeFileSync(`${OUT}/books.json`, JSON.stringify(bookRows));
fs.writeFileSync(`${OUT}/select-summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
await c.close();
