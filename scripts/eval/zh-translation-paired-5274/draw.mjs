#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-corpus-audit/draw.mjs (one interior page per book, the excluded page types, the
// ≥ 200 / ≥ 100 character floors, no edited_by; zh-strata.mjs zhEngineOf / zhKindOf), and
// scripts/eval/route-judge-6740/judge.mjs RT zh-dice (the Paddle lane's OCR-only holds are lane state, not
// containment). Neither draws a PAIRED translation test: they judge the stored English only. This draws the pages;
// run.mjs makes the arms, the judge packet, the verdicts and the score.
/**
 * Draw for the #5274 paired translation test (PREREGISTRATION.md). Read-only: no writes but --out.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-translation-paired-5274/draw.mjs --out=DIR
 *
 * FRAME: live Chinese / Classical Chinese books; title not 佩文韻府, 駢字類編 or 韻府拾遺; not held, except the
 * Paddle lane's own OCR-only holds; not a book of the #7968, #5600 or strata samples; no page of the book carries a
 * human edit (translation.edited_by or ocr.edited_by). A page is in the frame when its English is
 * gemini-3-flash-preview (source ai or batch_api), its OCR is PaddleOCR (zhEngineOf), it is not withheld, its type is
 * not one of draw.mjs's excluded types, OCR ≥ 200 characters and English ≥ 100.
 * DRAW (the test's unit): one interior page (15%–95%) per book whose OCR body has ≥ 100 Han characters once tags and
 * the <detected-images> block are removed (no near-empty leaf), seeded; 30 reference-work books and 30 prose books
 * (zhKindOf), books visited in a seeded order, plus 6 spare books a kind for the swap controls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { zhEngineOf, zhKindOf } from '../translation-corpus-audit/zh-strata.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out'));
const SEED = Number(arg('seed', 20261104));
const PER_KIND = 30, SPARE = 6;
const FAMILY = /佩文韻府|駢字類編|韻府拾遺/;
const LANE_HOLDS = /^(paddle-zh-(5600|6388)-ocr-only|gpu-backlog-5660|paddle-print-6101)$/;
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
const MODEL = 'gemini-3-flash-preview';
const MIN_HAN = 100;
// Books of earlier Chinese samples (#7968's draw, the strata sample, #5600's two draws): every 24-hex id in them.
const PRIOR = ['scripts/eval/results/zh-translation-strata-5274/manifest.jsonl', 'scripts/eval/results/translation-on-7866-draw/manifest.jsonl', 'scripts/eval/siku-error-types-5600/draw.json', 'scripts/eval/siku-percall-5600/draw.json'];
export const bodyHan = (ocr) => (String(ocr || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/g, ' ').replace(/<[^>]*>/g, ' ').match(/\p{Script=Han}/gu) || []).length;

fs.mkdirSync(OUT, { recursive: true });
const prior = new Set(PRIOR.flatMap((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').match(/[0-9a-f]{24}/g) || []));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const log = { seed: SEED, at: new Date().toISOString(), excluded_books: {}, frame: {}, visits: {}, page_exclusions: {} };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

const all = await db.collection('books').find({ visible: { $ne: false }, hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, language: { $in: ['Chinese', 'Classical Chinese'] } },
  { projection: { id: 1, title: 1, language: 1, pages_count: 1, pages_translated: 1, 'catalog_metadata.subjects': 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
const books = all.filter((b) => {
  const hold = b.pipeline_auto?.hold?.reason;
  const why = FAMILY.test(b.title || '') ? 'ditto-family' : hold && !LANE_HOLDS.test(hold) ? 'held' : prior.has(b.id) ? 'prior-sample' : null;
  if (why) bump(log.excluded_books, why);
  return !why;
});
console.log(`${all.length} live Chinese books; ${books.length} after the book exclusions`, log.excluded_books);

// Frame census, one $group over the candidate books' 3 Flash pages (whole book, not only the interior).
const census = await db.collection('pages').aggregate([
  { $match: { book_id: { $in: books.map((b) => b.id) }, 'translation.model': MODEL } },
  { $project: { book_id: 1, om: '$ocr.model', os: '$ocr.source', pt: '$page_type', ts: '$translation.source', ed: { $or: [{ $gt: ['$translation.edited_by', null] }, { $gt: ['$ocr.edited_by', null] }] }, wh: { $gt: ['$translation_withheld', null] }, ol: { $strLenCP: { $ifNull: ['$ocr.data', ''] } }, tl: { $strLenCP: { $ifNull: ['$translation.data', ''] } } } },
  { $group: { _id: { b: '$book_id', om: '$om', os: '$os', ok: { $and: [{ $in: ['$ts', ['ai', 'batch_api']] }, { $not: [{ $in: ['$pt', EXCLUDED_TYPES] }] }, { $gte: ['$ol', 200] }, { $gte: ['$tl', 100] }, { $not: ['$wh'] }] } }, n: { $sum: 1 }, ed: { $sum: { $cond: ['$ed', 1, 0] } } } },
], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
// A book with a human edit on ANY page is out (the brief); check every page, not only 3 Flash ones.
const edited = new Set((await db.collection('pages').distinct('book_id', { book_id: { $in: books.map((b) => b.id) }, $or: [{ 'translation.edited_by': { $exists: true, $ne: null } }, { 'ocr.edited_by': { $exists: true, $ne: null } }] })));
const perBook = new Map();
for (const r of census) {
  if (zhEngineOf({ model: r._id.om, source: r._id.os }) !== 'paddle' || !r._id.ok || edited.has(r._id.b)) continue;
  perBook.set(r._id.b, (perBook.get(r._id.b) || 0) + r.n);
}
const frameBooks = books.filter((b) => perBook.has(b.id));
const kindOf = new Map(frameBooks.map((b) => [b.id, zhKindOf(b)]));
for (const b of frameBooks) { const k = kindOf.get(b.id).kind; bump(log.frame, `${k}_books`); bump(log.frame, `${k}_pages`, perBook.get(b.id)); }
log.frame.books_with_human_edits_excluded = [...edited].filter((id) => census.some((r) => r._id.b === id && zhEngineOf({ model: r._id.om, source: r._id.os }) === 'paddle')).length;
console.log('frame (before the per-page Han floor, which the draw measures on the pages it visits):', log.frame);

const rng = makeRng(SEED);
const order = frameBooks.map((b) => [rng(), b]).sort((a, b) => a[0] - b[0]).map(([, b]) => b);
const sample = [], spare = [], filled = { reference: 0, prose: 0 }, spareN = { reference: 0, prose: 0 };
const hanVisited = { pages: 0, pass: 0 };
for (const book of order) {
  const kind = kindOf.get(book.id).kind;
  if (filled[kind] >= PER_KIND && spareN[kind] >= SPARE) continue;
  bump(log.visits, kind);
  const lo = Math.floor(book.pages_count * 0.15), hi = Math.ceil(book.pages_count * 0.95);
  const cands = await db.collection('pages').find({ book_id: book.id, page_number: { $gt: lo, $lt: hi }, 'translation.model': MODEL, translation_withheld: { $exists: false } },
    { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.source': 1, 'translation.data': 1 } }).toArray();
  const ok = cands.filter((p) => {
    const why = EXCLUDED_TYPES.includes(p.page_type) ? 'page_type' : zhEngineOf(p.ocr || {}) !== 'paddle' ? 'not_paddle' : !['ai', 'batch_api'].includes(p.translation?.source) ? 'tr_source'
      : String(p.ocr?.data || '').length < 200 ? 'short_ocr' : String(p.translation?.data || '').length < 100 ? 'short_tr' : null;
    if (why) { bump(log.page_exclusions, why); return false; }
    hanVisited.pages++;
    if (bodyHan(p.ocr.data) < MIN_HAN) { bump(log.page_exclusions, 'near_empty_leaf'); return false; }
    hanVisited.pass++;
    return true;
  }).sort((a, b) => a.page_number - b.page_number);
  if (!ok.length) { bump(log.visits, `${kind}_no_page`); continue; }
  const pick = ok[Math.floor(rng() * ok.length)];
  const page = await db.collection('pages').findOne({ id: pick.id });
  const row = { page_id: page.id, book_id: book.id, page_number: page.page_number, title: book.title, language: book.language, kind, kind_by: kindOf.get(book.id).by, hold: book.pipeline_auto?.hold?.reason ?? null,
    pages_count: book.pages_count, n_candidates: ok.length, body_han: bodyHan(page.ocr.data), ocr_model: page.ocr.model ?? null, ocr_hash: contentHash(page.ocr.data),
    translation_hash: contentHash(page.translation.data), translation_updated_at: page.translation.updated_at ?? null, image_url: getPageSource(page) };
  if (filled[kind] < PER_KIND) { sample.push(row); filled[kind]++; } else { spare.push(row); spareN[kind]++; }
  if (filled.reference >= PER_KIND && filled.prose >= PER_KIND && spareN.reference >= SPARE && spareN.prose >= SPARE) break;
}
log.han_floor = { ...hanVisited, pass_share: +(hanVisited.pass / Math.max(1, hanVisited.pages)).toFixed(4) };
log.filled = filled; log.spare = spareN;
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify({ seed: SEED, drawn_at: log.at, pages: sample, spare }, null, 1));
fs.writeFileSync(path.join(OUT, 'draw-log.json'), JSON.stringify(log, null, 1));
fs.writeFileSync(path.join(OUT, 'page-ids.txt'), sample.map((r) => r.page_id).join('\n') + '\n');
console.log(`drawn: ${JSON.stringify(filled)}, spare ${JSON.stringify(spareN)}; Han floor passed ${log.han_floor.pass}/${log.han_floor.pages} visited pages`);
await c.close();
