#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr-lane.mjs correctablePages (the #7558 correction lane's page frame: stored Flash-Lite
// draft of 300+ characters, not handwritten, not human-edited, not withheld, interior 15–95%) — its filter is copied here
// and widened from German/French to the five #7567 languages; build-panel.py (E0, reference pages, not library pages).
/**
 * e5-draw.mjs — #7567 E5: 20 books × 25 pages per language (la, en, de, fr, it), from OUR library, stratified across
 * books. A page is in frame when the correction lane could take it (its stored OCR is a Flash-Lite draft — that draft is
 * arm a's input and the "lite read" fr/it lacked in E2). A book is in frame when it is visible, idle, not held, dated
 * 1470–1800 in `year`, and has 25+ such pages. Books are drawn in a seeded order (seed 7567); each drawn book's title
 * page is printed for a by-eye colophon check (PD print, no modern edition) — `--reject=<id,…>` drops the ones that fail
 * and the next spare takes their place. 25 pages per book, spread evenly over its in-frame pages.
 *
 *   node --env-file=… e5-draw.mjs --out=$J/e5/panel.json [--reject=id,id] [--per-lang=20] [--pages=25]
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { LITE_MODELS, IDLE_STATUSES, isInterior } from '../../batch/cli-ocr-lane.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out'); const PER = Number(arg('per-lang', '20')); const NP = Number(arg('pages', '25'));
const REJECT = new Set((arg('reject', '') || '').split(',').filter(Boolean));
const LANGS = { la: 'Latin', en: 'English', de: 'German', fr: 'French', it: 'Italian' };
const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
const e2Books = new Set(JSON.parse(fs.readFileSync(new URL('./panel.json', import.meta.url), 'utf8')).pages.map((p) => p.book_id).filter(Boolean));
const rank = (id) => crypto.createHash('sha256').update(`7567e5:${id}`).digest('hex');

const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const panel = { seed: 7567, drawn_at: new Date().toISOString(), rule: 'see header', books: [], pages: [] };
for (const [lang, L] of Object.entries(LANGS)) {
  const books = (await db.collection('books').find(
    { visible: true, pages_count: { $gte: 60 }, language: { $regex: `^${L}` }, year: { $gte: 1470, $lte: 1800 },
      'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true } },
    { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1 } }).toArray())
    .filter((b) => !e2Books.has(b.id)).sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
  let got = 0;
  for (const b of books) {
    if (got >= PER) break;
    if (REJECT.has(b.id)) continue;
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: b.id, page_number: { $gt: 0 }, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } } },
      { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*(handwrit|manuscript)', options: 'i' } } } },
      { $match: { n: { $gte: 300 }, hw: false } }, { $sort: { page_number: 1 } },
    ]).toArray();
    const ok = rows.filter((p) => isInterior(p.page_number, b.pages_count));
    if (ok.length < NP) continue;
    // the title page: the first page whose OCR names a year or an imprint, else page 1-3, for the by-eye colophon check
    const front = await db.collection('pages').find({ book_id: b.id, page_number: { $lte: 8 } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    const tp = front.find((p) => /\b1[4-8]\d\d\b|M\.?\s*D|M\.?\s*DC|\bAnno\b|typis|excudebat|gedruckt|imprim|stampa|printed/i.test(p.ocr?.data || '')) || front[0];
    const pick = Array.from({ length: NP }, (_, i) => ok[Math.floor((i + 0.5) * ok.length / NP)]);
    panel.books.push({ lang, book_id: b.id, title: b.title, author: b.author, year: b.year, language: b.language, pages_count: b.pages_count, in_frame_pages: ok.length,
      title_page: tp ? { page_number: tp.page_number, text: String(tp.ocr?.data || '').replace(/<[^>]+>[^<]*<\/(scan-quality|language|script|page-type|page-num)>/g, '').slice(0, 500) } : null });
    for (const p of pick) panel.pages.push({ slug: `${lang}-${b.id.slice(-8)}-p${p.page_number}`, lang, book_id: b.id, page_id: p.id, page_number: p.page_number, title: b.title, year: b.year });
    got++;
  }
  console.log(`${lang}: ${got} books (${books.length} in frame before the page filter)`);
}
// the served image of each page, for the reads
const docs = await db.collection('pages').find({ id: { $in: panel.pages.map((p) => p.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray();
const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
for (const p of panel.pages) p.served_image = getPageSource(byId[p.page_id]);
await c.close();
fs.writeFileSync(OUT, JSON.stringify(panel, null, 1));
console.log(`${panel.books.length} books, ${panel.pages.length} pages -> ${OUT}`);
