#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-translation-paired-5274/draw.mjs (PR #8134) — THE frame of the paired test this job acts on:
// its book exclusions, census rule and constants are restated here, unchanged, because draw.mjs runs at import and only
// draws 60 pages. scripts/batch/zh-print-correct-7263/frame.mjs (PR #8067) — the reader-traffic ranking (distinct ip-day
// readers per book over 60 days of analytics_pageviews). zh-strata.mjs zhEngineOf / zhKindOf, imported.
/**
 * #8169: the pages to re-translate, from Mongo, live. Read-only on Mongo; writes only --out.
 *
 *   node --env-file=.env.production.local scripts/batch/zh-retranslate-8169/frame.mjs --out=DIR [--exclude-ledgers=F,F,...]
 *
 * THE #8134 FRAME. Live Chinese / Classical Chinese books (visible, not hidden, pages, some English); not 佩文韻府 /
 * 駢字類編 / 韻府拾遺; not held except the Paddle lane's own OCR-only holds; not a book of an earlier Chinese sample; no
 * page of the book with a human edit. A page is in when its English is gemini-3-flash-preview (source ai or batch_api),
 * its OCR is PaddleOCR (zhEngineOf), it is not withheld, its type is not excluded, OCR >= 200 characters, English >= 100.
 *
 * THIS JOB'S PAGE EXCLUSIONS (#8169 brief), each counted in frame-log.json:
 *   near_empty_leaf  under 100 Han in the OCR body (draw.mjs bodyHan): a caption leaf; #5274 found invented English there
 *   ditto_mark       丨 in the OCR body: the ditto-correction route (zh-ditto-correct-5274) is undecided; listed in ditto.json
 *   other_lane       a page in another lane's queue or ledger (--exclude-ledgers), or in the tca repair list
 *   edited           translation.edited_by / ocr.edited_by on the page (book-level rule already drops these books)
 *   opus_correction  ocr.pipeline is the Opus print correction lane (#8077): its source is changing
 * The 36 pages #8134 wrote are no longer 3 Flash English, so the census leaves them out by construction (counted).
 *
 * ORDER. Reference works (zhKindOf) first, then prose; within each, books by readers (distinct ip-day over 60 days),
 * then human_read_count, then pages. Whole books, pages in leaf order.
 *
 * OUT: DIR/frame.jsonl.gz (one row a page: page_id, book_id, page_number, kind, ocr_hash, tr_hash, order),
 *      DIR/books.json, DIR/frame-log.json, DIR/ditto.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { zhEngineOf, zhKindOf } from '../../eval/translation-corpus-audit/zh-strata.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;

export const MODEL = 'gemini-3-flash-preview';
export const FAMILY = /佩文韻府|駢字類編|韻府拾遺/;
export const LANE_HOLDS = /^(paddle-zh-(5600|6388)-ocr-only|gpu-backlog-5660|paddle-print-6101)$/;
export const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
export const MIN_HAN = 100;
export const OPUS_LANE = 'opus-correct-zh-print-7263';
const PRIOR = ['scripts/eval/results/zh-translation-strata-5274/manifest.jsonl', 'scripts/eval/results/translation-on-7866-draw/manifest.jsonl', 'scripts/eval/siku-error-types-5600/draw.json', 'scripts/eval/siku-percall-5600/draw.json'];
/** The tca-contained-repair-5274 pages (its brief): book_id:page_number, by-eye repair owed there. */
const TCA = ['69f3276f52a77bb28fdb7316:3', '69e75ccc3f15c712bdb8f04e:40', '69e726a9a409200ea79efa80:17', '69e4207471f02ebac6264a46:7', '69e014d927a1381d255992b7:32',
  '6991eadd2f801130a473ea3c:31', '69c7fdea6c6f3cc53c84359c:143', '695201a9ab34727b1f041826:82', '69dfede68d34461cbe7f4df4:71', '6a08e2ce50bd891addfb51e6:23',
  '69e8b14e2ff2a8dc09e75a36:340', '6a1aa51fc8638d1ea5c80d0f:142', '69b3f796a107e55a0ee1e1d6:110', '6a357f1ac6e2d5bb56a64539:204'];

const body = (ocr) => String(ocr || '').replace(/<detected-images>[\s\S]*?<\/detected-images>/g, ' ').replace(/<[^>]*>/g, ' ');
export const bodyHan = (ocr) => (body(ocr).match(/\p{Script=Han}/gu) || []).length;
export const hasDitto = (ocr) => body(ocr).includes('丨');
const laneOf = (ocr) => (typeof ocr?.pipeline === 'string' ? ocr.pipeline : ocr?.pipeline?.lane ?? null);

/** Why a fetched page is out (this job's page rules), or null. */
export function pageOut(p, otherLane) {
  if (otherLane.has(p.id) || otherLane.has(`${p.book_id}:${p.page_number}`)) return 'other_lane';
  if (p.translation?.edited_by || p.ocr?.edited_by) return 'edited';
  if (laneOf(p.ocr) === OPUS_LANE) return 'opus_correction';
  if (bodyHan(p.ocr?.data) < MIN_HAN) return 'near_empty_leaf';
  if (hasDitto(p.ocr?.data)) return 'ditto_mark';
  return null;
}

function ledgerIds(files) {
  const ids = new Set(TCA);
  const per = {};
  for (const f of files) {
    if (!fs.existsSync(f)) { per[f] = 'missing'; continue; }
    let n = 0;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); const id = r.page_id ?? r.id; if (id) { ids.add(id); n++; } } catch { /* a torn line */ }
    }
    per[f] = n;
  }
  return { ids, per };
}

async function main() {
  const OUT = path.resolve(arg('out'));
  fs.mkdirSync(OUT, { recursive: true });
  const ledgers = (arg('exclude-ledgers', '') || '').split(',').filter(Boolean);
  const other = ledgerIds(ledgers);
  const prior = new Set(PRIOR.flatMap((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').match(/[0-9a-f]{24}/g) || []));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const log = { at: new Date().toISOString(), excluded_books: {}, excluded_books_pages: {}, frame_8134: {}, page_exclusions: {}, frame: {}, ledgers: other.per, tca_pages: TCA.length };
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

  const all = await db.collection('books').find({ visible: { $ne: false }, hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, language: { $in: ['Chinese', 'Classical Chinese'] } },
    { projection: { id: 1, slug: 1, title: 1, language: 1, pages_count: 1, pages_translated: 1, human_read_count: 1, 'catalog_metadata.subjects': 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
  const why = new Map();
  for (const b of all) {
    const hold = b.pipeline_auto?.hold?.reason;
    const w = FAMILY.test(b.title || '') ? 'ditto-family' : hold && !LANE_HOLDS.test(hold) ? 'held' : prior.has(b.id) ? 'prior-sample' : null;
    if (w) { why.set(b.id, w); bump(log.excluded_books, w); }
  }
  const books = all.filter((b) => !why.has(b.id));
  console.log(`${all.length} live Chinese books; ${books.length} after the book exclusions`, log.excluded_books);

  // 3 Flash pages per book across ALL live Chinese books, so the excluded books' share is counted too (the census).
  const census = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: all.map((b) => b.id) }, 'translation.model': MODEL } },
    { $project: { book_id: 1, om: '$ocr.model', os: '$ocr.source', pt: '$page_type', ts: '$translation.source', wh: { $gt: ['$translation_withheld', null] }, ol: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, tl: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $strLenCP: '$translation.data' }, 0] } } },
    { $group: { _id: { b: '$book_id', om: '$om', os: '$os', ok: { $and: [{ $in: ['$ts', ['ai', 'batch_api']] }, { $not: [{ $in: ['$pt', EXCLUDED_TYPES] }] }, { $gte: ['$ol', 200] }, { $gte: ['$tl', 100] }, { $not: ['$wh'] }] } }, n: { $sum: 1 } } },
  ], { allowDiskUse: true, maxTimeMS: 900000 }).toArray();
  const edited = new Set(await db.collection('pages').distinct('book_id', { book_id: { $in: books.map((b) => b.id) }, $or: [{ 'translation.edited_by': { $exists: true, $ne: null } }, { 'ocr.edited_by': { $exists: true, $ne: null } }] }));
  const remaining = { paddle_in_frame_books: 0, paddle_excluded_books: {}, paddle_not_ok: 0, gemini_read: 0, other_read: 0 };
  const perBook = new Map();
  for (const r of census) {
    const eng = zhEngineOf({ model: r._id.om, source: r._id.os });
    if (eng !== 'paddle') { if (/gemini/i.test(String(r._id.om || ''))) remaining.gemini_read += r.n; else remaining.other_read += r.n; continue; }
    if (why.has(r._id.b)) { bump(remaining.paddle_excluded_books, why.get(r._id.b), r.n); continue; }
    if (!r._id.ok) { remaining.paddle_not_ok += r.n; continue; }
    if (edited.has(r._id.b)) { bump(remaining.paddle_excluded_books, 'human-edit-in-book', r.n); continue; }
    perBook.set(r._id.b, (perBook.get(r._id.b) || 0) + r.n);
  }
  log.census_3flash = remaining;
  const frameBooks = books.filter((b) => perBook.has(b.id));
  const kindOf = new Map(frameBooks.map((b) => [b.id, zhKindOf(b)]));
  for (const b of frameBooks) { const k = kindOf.get(b.id).kind; bump(log.frame_8134, `${k}_books`); bump(log.frame_8134, `${k}_pages`, perBook.get(b.id)); }
  console.log('the #8134 frame, rebuilt (before this job\'s page exclusions):', log.frame_8134);

  // Readers per book (frame.mjs of #8067): distinct ip-day over 60 days on /book/<slug-or-id>.
  const since = new Date(Date.now() - 60 * 86400e3);
  const views = await db.collection('analytics_pageviews').aggregate([
    { $match: { timestamp: { $gte: since }, path: /^\/book\// } },
    { $project: { slug: { $arrayElemAt: [{ $split: ['$path', '/'] }, 2] }, ip: 1, d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } },
    { $group: { _id: { s: '$slug', ip: '$ip', d: '$d' } } },
    { $group: { _id: '$_id.s', v: { $sum: 1 } } },
  ], { allowDiskUse: true, maxTimeMS: 600000 }).toArray().catch((e) => { log.views_error = e.message; return []; });
  const bySlug = new Map(views.map((r) => [String(r._id).split('?')[0], r.v]));
  const readers = (b) => (bySlug.get(b.slug) || 0) + (bySlug.get(b.id) || 0);
  const ordered = frameBooks.map((b) => ({ b, kind: kindOf.get(b.id).kind, v: readers(b) }))
    .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'reference' ? -1 : 1) || y.v - x.v || (y.b.human_read_count || 0) - (x.b.human_read_count || 0) || perBook.get(y.b.id) - perBook.get(x.b.id));

  const gz = zlib.createGzip(); const ws = fs.createWriteStream(path.join(OUT, 'frame.jsonl.gz')); gz.pipe(ws);
  const ditto = []; const bookRows = []; let order = 0;
  for (const { b, kind, v } of ordered) {
    const ps = await db.collection('pages').find({ book_id: b.id, 'translation.model': MODEL },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.pipeline': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, translation_withheld: 1 } }).sort({ page_number: 1 }).toArray();
    let kept = 0;
    const bd = [];
    for (const p of ps) {
      const ok = ['ai', 'batch_api'].includes(p.translation?.source) && !EXCLUDED_TYPES.includes(p.page_type) && zhEngineOf(p.ocr || {}) === 'paddle'
        && String(p.ocr?.data || '').length >= 200 && String(p.translation?.data || '').length >= 100 && p.translation_withheld == null;
      if (!ok) continue;
      const w = pageOut(p, other.ids);
      if (w) { bump(log.page_exclusions, w); bump(log.page_exclusions, `${w}_${kind}`); if (w === 'ditto_mark') bd.push(p.page_number); continue; }
      gz.write(JSON.stringify({ page_id: p.id, book_id: b.id, page_number: p.page_number, kind, ocr_hash: contentHash(p.ocr.data), tr_hash: contentHash(p.translation.data), order: order++ }) + '\n');
      kept++;
    }
    if (bd.length) ditto.push({ book_id: b.id, title: b.title, pages: bd });
    if (kept) { bookRows.push({ book_id: b.id, title: b.title, kind, readers_60d: v, human_read_count: b.human_read_count || 0, pages: kept, hold: b.pipeline_auto?.hold?.reason ?? null }); bump(log.frame, `${kind}_books`); bump(log.frame, `${kind}_pages`, kept); }
  }
  gz.end(); await new Promise((r) => ws.on('close', r));
  log.books_with_readers = bookRows.filter((b) => b.readers_60d > 0).length;
  log.ditto_books = ditto.length; log.ditto_pages = ditto.reduce((s, d) => s + d.pages.length, 0);
  fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify(bookRows, null, 1));
  fs.writeFileSync(path.join(OUT, 'ditto.json'), JSON.stringify(ditto, null, 1));
  fs.writeFileSync(path.join(OUT, 'frame-log.json'), JSON.stringify(log, null, 1));
  console.log('frame:', log.frame, 'page exclusions:', log.page_exclusions, 'ditto books', ditto.length);
  await c.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
