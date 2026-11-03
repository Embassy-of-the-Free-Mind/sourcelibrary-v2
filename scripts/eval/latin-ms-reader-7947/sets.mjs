#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-strata-7947/build-second.mjs (reads the #7947 draw and its reviews; builds second-reader
// and miss packets, not arm sets). The draw is reused, not re-drawn (brief): this only picks its cells.
/**
 * #7947 reader test, step 0: the two page sets, from the #7947 draw (no new draw, no model).
 *   ms  — the lite-read manuscripts: form on the image = manuscript, all 3 drawn pages read by Flash-Lite, the three
 *         microfilm-strip books excluded (no reader can read them; they are a re-sourcing problem). 26 books, 78 pages.
 *   inc — the 1450-1500 print cell (incunabula): 8 books, 24 pages (7 books read by Flash-Lite, 1 by 3 Flash).
 * Each page carries the stored OCR the #7947 judge saw, its word count (the rate denominator for EVERY arm, so arms are
 * compared on one denominator) and the #7947 confirmed serious calls on it (the stored arm's original baseline).
 *
 *   node --env-file=… scripts/eval/latin-ms-reader-7947/sets.mjs --out <dir>      → <dir>/ms.json, <dir>/inc.json
 * Mongo is READ only: each page's `id` (the draw keyed 3 pages of one book by `_id`; the readers take `id`) and whether
 * the stored OCR still equals the text the #7947 judge saw (`stored_same`).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient, ObjectId } from 'mongodb';

const args = process.argv.slice(2);
const OUT = args[args.indexOf('--out') + 1];
const RUN = 'scripts/eval/results/latin-strata-7947';
const sample = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${RUN}/draw/sample.json.gz`)));
const analysis = JSON.parse(fs.readFileSync(`${RUN}/analysis/analysis.json`));
const rows = analysis.modes.confirmed.book_rows;
export const STRIPS = new Set(['69f3391e876dd827cbc547fb', '69f33ac2876dd827cbc58229', '69f33a41876dd827cbc57c62']);

const ms = [], inc = [];
for (const r of rows) {
  const b = sample.find((x) => x.book_id === r.book_id);
  if (r.form === 'manuscript' && !STRIPS.has(r.book_id) && b.pages.every((p) => /flash-lite/.test(p.ocr_model ?? ''))) ms.push([b, r]);
  if (r.cell === '1450-1500|print') inc.push([b, r]);
}
const flat = (set, list) => list.flatMap(([b, r]) => b.pages.map((p) => {
  const row = r.pages.find((x) => x.page === p.page_number);
  return { set, book_id: b.book_id, title: b.book.title, published: b.book.published, era: b.era, page_number: p.page_number,
    page_id: p.page_id, image_url: p.image_url, crop: p.crop ?? null, ocr: p.ocr, ocr_model: p.ocr_model, words: p.words,
    base_7947: { ocr_score: null, serious: row?.serious ?? null, wrong_text: row?.wrong_text ?? null, fidelity: row?.fidelity ?? null,
      kinds: row?.kinds ?? [] } };
}));
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
fs.mkdirSync(OUT, { recursive: true });
for (const [k, list] of [['ms', ms], ['inc', inc]]) {
  const pages = flat(k, list);
  for (const p of pages) {
    const q = await db.collection('pages').findOne({ $or: [{ id: p.page_id }, ...(/^[0-9a-f]{24}$/.test(p.page_id) ? [{ _id: new ObjectId(p.page_id) }] : [])] },
      { projection: { id: 1, 'ocr.data': 1 } });
    p.draw_page_id = p.page_id; p.page_id = q?.id ?? p.page_id; p.stored_same = q?.ocr?.data === p.ocr;
  }
  fs.writeFileSync(path.join(OUT, `${k}.json`), JSON.stringify(pages, null, 1));
  console.log(`${k}: ${list.length} books, ${pages.length} pages, ${pages.reduce((s, p) => s + p.words, 0)} words, stored OCR unchanged on ${pages.filter((p) => p.stored_same).length}`);
}
await client.close();
