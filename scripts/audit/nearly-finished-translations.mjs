#!/usr/bin/env node
/**
 * Nearly-finished translation audit (#4451) — find books with a small untranslated
 * tail, ranked by whether a reader has actually asked for a page in them.
 *
 * WHY THIS EXISTS. Every resolvable translation-request in the feedback queue turned
 * out to be a hole in a book that was already 85–99% translated — not a request for a
 * new book. Readers reach the end of a nearly-done book, hit the one blank page, and
 * press the button. That makes the request queue a COMPLETION signal, and completion
 * is the cheapest work in the pipeline: the book is already ingested, split, OCR'd and
 * paid for. Finding those tails should not depend on a human noticing them in a
 * feedback list.
 *
 * EVERY NUMBER REPORTED IS COUNTED FROM `pages`. `books.pages_translated` is
 * denormalised and drifts, so it is never the answer — but it IS used to narrow the
 * candidate set, because scanning all ~6.5M OCR'd pages takes over ten minutes and an
 * audit nobody waits for is an audit nobody runs.
 *
 * The direction of the drift is what makes that prefilter safe, and it is not the
 * direction you would guess. Measured 2026-08-31 on a random sample of 120 live books:
 * 114 counters exact, 6 drifted, and ALL SIX drifted HIGH (counter claimed more
 * translated than `pages` actually held), by 1–4 pages; zero drifted low. So a counter
 * makes a book look MORE finished than it is, which pulls books INTO a
 * "nearly finished" filter rather than hiding them from it.
 *
 * (Do not generalise from a freshly-translated batch: right after a translation run
 * and before `recount-page-stats.mjs`, counters read LOW instead — that is a transient
 * post-write state, not the steady one. Confusing the two is how a prefilter gets
 * built backwards.)
 *
 * The shortlist is counter-based and the exact verification is bounded, so the count
 * of shortlisted-but-unverified books is REPORTED — an unverified book is not a book
 * claimed to be finished.
 *
 * THE DENOMINATOR IS THE WHOLE POINT. "Untranslated" means untranslated AND
 * translatable. Soft-hidden pages (page_number <= 0), blanks, ex-libris, bookplates,
 * digitizer notices, pages with no OCR to translate, and recitation/safety-blocked
 * pages are all legitimately never going to have a translation. Counting them as a
 * "tail" invents work that cannot be done and drives the percentage down forever.
 * The rule lives in ONE place — `isTranslatablePage` / `translatablePageFilter` in
 * scripts/lib/translate-core.mjs — and this script calls it rather than restating it,
 * so the audit and the translator can never disagree about what is eligible.
 *
 * REPORT ONLY. This script never calls Gemini and never writes. Translation costs
 * money and the corpus pipeline is deliberately paused, so the output is a worklist
 * plus the exact command to run, not an action. Actuation stays in the existing
 * realtime-translate.mjs — this is a lead generator, not a second translator.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/nearly-finished-translations.mjs
 *   ... --threshold=0.9      only books at >= 90% translated (default 0.85)
 *   ... --max-tail=15        only books whose remaining tail is <= N pages (default 25)
 *   ... --requested-only     only books a reader has actually asked about
 *   ... --verify=80          how many shortlisted books to count exactly (default 60)
 *   ... --sample=150         calibration sample size for the corpus estimate (default 80)
 *   ... --limit=40           rows to print (default 30)
 *   ... --json=/tmp/out.json write the full result set
 *
 * LIMITS — read before trusting the output:
 *  - A page with OCR is assumed translatable. If the OCR is itself junk (a failed
 *    scan transcribed as noise), translating it produces junk. This audit cannot tell.
 *  - `translation.data` length > 30 is the "is translated" test, matching the read
 *    path's own notion of a non-empty translation. A very short legitimate
 *    translation (a page bearing one word) counts as untranslated here.
 *  - Reader demand is matched via the feedback row's `/book/<id>/page/<pageid>` URL.
 *    Requests submitted without a page URL, or on a book whose id was re-minted, do
 *    not match and the book simply loses its demand ranking — never its listing.
 */
import { MongoClient } from 'mongodb';
import { translatablePageFilter, isTranslatablePage } from '../lib/translate-core.mjs';
import { PAGE_RATE_USD, PAGE_RATES_MEASURED_ON } from '../lib/model-pricing.mjs';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : d;
};
const THRESHOLD = parseFloat(getArg('threshold', '0.85'));
const MAX_TAIL = parseInt(getArg('max-tail', '25'), 10);
const LIMIT = parseInt(getArg('limit', '30'), 10);
const REQUESTED_ONLY = args.includes('--requested-only');
const VERIFY = parseInt(getArg('verify', '60'), 10);
const SAMPLE = parseInt(getArg('sample', '80'), 10);
const JSON_OUT = getArg('json', null);

/** Measured 2026-08-31 over 55 pages of realtime translation. */
// Translation runs on the realtime lane, not batch — price it as such.
const COST_PER_PAGE = PAGE_RATE_USD.translationRealtime;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// ── 1. Reader demand, first, so it can rank everything else ────────────────
// Open translation-requests carry the page URL the reader was on.
const requests = await db.collection('feedback')
  .find({ addressed: { $ne: true }, message: /Translation requested for/ })
  .project({ message: 1, page: 1, email: 1, created_at: 1 })
  .toArray();

const demand = new Map(); // book_id -> [{page_id, email, at}]
for (const r of requests) {
  const m = (r.page || '').match(/\/book\/([^/?#]+)\/page\/([a-f0-9]{24})/);
  if (!m) continue;
  const list = demand.get(m[1]) || [];
  list.push({ pageId: m[2], email: r.email || null, at: r.created_at });
  demand.set(m[1], list);
}
console.log(`Open translation-requests with a page URL: ${[...demand.values()].flat().length} across ${demand.size} book(s)\n`);

// ── 2. Corpus-level shape, straight from the counters ─────────────────────
// Cheap (one aggregation over ~31K book records) and it is the number that decides
// whether this is worth doing at all. Counter-based, so read it as an estimate: the
// drift is small and biased HIGH, and this "tail" still includes pages that will
// never be translatable (blanks, plates), so the true payable tail is a little
// SMALLER than shown. The per-book section below is the exact one.
const tailExpr = { $subtract: ['$pages_count', { $ifNull: ['$pages_translated', 0] }] };
const bands = [];
for (const max of [5, 10, 25, 50]) {
  const r = await db.collection('books').aggregate([
    { $match: { visible: true, pages_count: { $gt: 0 }, $expr: { $and: [{ $lte: [tailExpr, max] }, { $gt: [tailExpr, 0] }] } } },
    { $group: { _id: null, books: { $sum: 1 }, pages: { $sum: tailExpr } } },
  ]).toArray();
  bands.push({ max, books: r[0]?.books ?? 0, pages: r[0]?.pages ?? 0 });
}
const liveTotal = await db.collection('books').countDocuments({ visible: true, pages_count: { $gt: 0 } });
const fullyDone = await db.collection('books').countDocuments({ visible: true, pages_count: { $gt: 0 }, $expr: { $lte: [tailExpr, 0] } });

console.log('=== Corpus shape (counter-based, BEFORE calibration) ===');
for (const b of bands) {
  console.log(`  within ${String(b.max).padStart(2)} pages of done: ${String(b.books).padStart(6)} books, ${String(b.pages).padStart(7)} pages  ≈ $${(b.pages * COST_PER_PAGE).toFixed(2)}`);
}
console.log(`  counter says fully translated: ${fullyDone} of ${liveTotal} live books (${(100 * fullyDone / liveTotal).toFixed(1)}%)\n`);

// ── 2b. Calibrate the counter tail against reality ─────────────────────────
// `pages_count` counts every visible page; `pages_translated` counts only translated
// ones. Their difference therefore includes every page that will NEVER be translated —
// blanks, plates, ex-libris, digitizer notices, pages with no OCR. So the counter tail
// is not a work estimate, and a book sitting at "98%" is usually at 100% of what can
// ever be done. Sampling turns the estimate into something usable.
const sample = await db.collection('books').aggregate([
  { $match: { visible: true, pages_count: { $gt: 0 }, $expr: { $and: [{ $lte: [tailExpr, MAX_TAIL] }, { $gt: [tailExpr, 0] }] } } },
  { $sample: { size: SAMPLE } },
  { $project: { id: 1, pages_count: 1, pages_translated: 1 } },
]).toArray();

let sCounterTail = 0, sRealTail = 0, sAlreadyDone = 0;
for (const b of sample) {
  const key = b.id || String(b._id);
  const pages = await db.collection('pages').find({ book_id: key, ...translatablePageFilter() })
    .project({ page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1 })
    .toArray();
  const eligible = pages.filter(p => isTranslatablePage(p).ok);
  const tail = eligible.filter(p => (p.translation?.data || '').length <= 30).length;
  sCounterTail += b.pages_count - (b.pages_translated || 0);
  sRealTail += tail;
  if (tail === 0) sAlreadyDone++;
}
const realFraction = sCounterTail > 0 ? sRealTail / sCounterTail : 0;
const doneFraction = sample.length > 0 ? sAlreadyDone / sample.length : 0;

console.log(`=== Calibration (random sample of ${sample.length} books with a 1..${MAX_TAIL} counter tail) ===`);
console.log(`  counter tail: ${sCounterTail} pages → actually translatable: ${sRealTail} (${(realFraction * 100).toFixed(1)}%)`);
console.log(`  books whose REAL tail is zero — already complete, just counted wrong: ${sAlreadyDone}/${sample.length} (${(doneFraction * 100).toFixed(0)}%)`);
const bandMain = bands.find(b => b.max === MAX_TAIL) || bands[bands.length - 1];
console.log(`\n  → real work in the 1..${MAX_TAIL} band ≈ ${Math.round(bandMain.pages * realFraction)} pages ≈ $${(bandMain.pages * realFraction * COST_PER_PAGE).toFixed(2)}`);
console.log(`  → books actually complete ≈ ${fullyDone + Math.round(bandMain.books * doneFraction)} of ${liveTotal} (${(100 * (fullyDone + bandMain.books * doneFraction) / liveTotal).toFixed(1)}%), not ${(100 * fullyDone / liveTotal).toFixed(1)}%`);
console.log(`  (sample-based — raise --sample=N to tighten)\n`);

// ── 3. Exact, page-level verification — BOUNDED ───────────────────────────
// Counting from `pages` costs a query per book, so it runs on a bounded slice:
// everything a reader asked for, then the smallest counter-implied tails. The number
// listed-but-not-verified is printed, never silently dropped.
// Sorted by the TAIL, not by book size — sorting on pages_count puts every one-page
// book first, and a one-page book with a one-page tail is 0% translated, so the whole
// verification budget gets spent on books that can never pass the threshold.
const shortlist = await db.collection('books').aggregate([
  {
    $match: {
      visible: true,
      pages_count: { $gt: 0 },
      $expr: { $and: [{ $lte: [tailExpr, MAX_TAIL] }, { $gt: [tailExpr, 0] }] },
    },
  },
  { $addFields: { _tail: tailExpr, _pct: { $divide: [{ $ifNull: ['$pages_translated', 0] }, '$pages_count'] } } },
  { $match: { _pct: { $gte: THRESHOLD } } }, // cheap pre-screen; the exact one is below
  { $sort: { _tail: 1, pages_count: -1 } },  // cheapest tails first, bigger books to break ties
  { $project: { id: 1, title: 1, author: 1, language: 1, slug: 1, pages_translated: 1, pages_count: 1, _tail: 1 } },
]).toArray();

const shortlistIds = new Set(shortlist.map(b => b.id || String(b._id)));
const extra = [];
for (const bookRef of demand.keys()) {
  if (shortlistIds.has(bookRef)) continue;
  const b = await db.collection('books').findOne(
    { $or: [{ id: bookRef }, { slug: bookRef }] },
    { projection: { id: 1, title: 1, author: 1, language: 1, slug: 1, pages_translated: 1, pages_count: 1, visible: 1 } },
  );
  if (b && b.visible === true) extra.push(b);
}

// Reader-requested books first — demand outranks the heuristic — then smallest tails.
const requestedFirst = [...extra, ...shortlist.filter(b => demand.has(b.id || String(b._id)))];
const rest = shortlist.filter(b => !demand.has(b.id || String(b._id)));
const toVerify = [...requestedFirst, ...rest].slice(0, VERIFY);

console.log(`Shortlist: ${shortlist.length} books with a counter-implied tail <= ${MAX_TAIL}, + ${extra.length} pulled in by reader demand`);
console.log(`Verifying ${toVerify.length} of them exactly against \`pages\` (--verify=N to change)`);
if (shortlist.length + extra.length > toVerify.length) {
  console.log(`  ${shortlist.length + extra.length - toVerify.length} shortlisted books NOT verified in this run — not a claim that they are done`);
}
console.log('');

const candidates = [];
for (const book of toVerify) {
  const key = book.id || String(book._id);
  if (REQUESTED_ONLY && !demand.has(key)) continue;

  const pages = await db.collection('pages')
    .find({ book_id: key, ...translatablePageFilter() })
    .project({ page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1 })
    .toArray();

  // The canonical predicate, applied to fetched docs — this is where the
  // blank-from-OCR case (not expressible in Mongo) finally gets excluded.
  const eligible = pages.filter(p => isTranslatablePage(p).ok);
  const translated = eligible.filter(p => (p.translation?.data || '').length > 30);
  const tail = eligible.filter(p => (p.translation?.data || '').length <= 30);

  if (eligible.length === 0 || tail.length === 0) continue;
  if (tail.length > MAX_TAIL) continue;
  const pct = translated.length / eligible.length;
  if (pct < THRESHOLD) continue;

  candidates.push({
    book_id: key,
    title: book.title,
    author: book.author,
    language: book.language,
    slug: book.slug,
    translatable: eligible.length,
    translated: translated.length,
    remaining: tail.length,
    pct,
    pages: tail.map(p => p.page_number).sort((a, b) => a - b),
    counterSays: `${book.pages_translated ?? '?'}/${book.pages_count ?? '?'}`,
    counterDrift: (book.pages_translated ?? 0) - translated.length,
    requests: demand.get(key) || [],
  });
}

// ── 4. Rank: reader demand first, then cheapest tail ───────────────────────
candidates.sort((a, b) => {
  if (!!b.requests.length !== !!a.requests.length) return b.requests.length ? 1 : -1;
  if (b.requests.length !== a.requests.length) return b.requests.length - a.requests.length;
  return a.remaining - b.remaining;
});

const totalPages = candidates.reduce((n, c) => n + c.remaining, 0);
const requested = candidates.filter(c => c.requests.length);
const drifted = candidates.filter(c => c.counterDrift !== 0);
const maxDrift = candidates.reduce((m, c) => Math.max(m, Math.abs(c.counterDrift)), 0);

console.log(`=== Nearly finished: >= ${(THRESHOLD * 100).toFixed(0)}% translated, tail <= ${MAX_TAIL} pages ===\n`);
for (const c of candidates.slice(0, LIMIT)) {
  const flag = c.requests.length ? `★ ${c.requests.length} reader request(s)` : '';
  console.log(`${(c.pct * 100).toFixed(1)}%  ${String(c.remaining).padStart(3)}p  ${(c.title || '').slice(0, 52).padEnd(54)} [${c.language || '?'}] ${flag}`);
  console.log(`      ${c.book_id}  pages: ${c.pages.slice(0, 14).join(', ')}${c.pages.length > 14 ? ` … +${c.pages.length - 14}` : ''}`);
  if (c.counterDrift !== 0) console.log(`      counter drift ${c.counterDrift > 0 ? '+' : ''}${c.counterDrift}: books says ${c.counterSays}, pages say ${c.translated}/${c.translatable}`);
}

console.log(`\n--- Summary ---`);
console.log(`Books: ${candidates.length}  (${requested.length} with an open reader request)`);
console.log(`Pages to finish: ${totalPages}  ≈ $${(totalPages * COST_PER_PAGE).toFixed(2)} at $${COST_PER_PAGE}/page (measured ${PAGE_RATES_MEASURED_ON})`);
console.log(`Counter drift among verified books: ${drifted.length} of ${candidates.length}, worst ${maxDrift} page(s)`);
if (candidates.length > LIMIT) console.log(`(showing ${LIMIT} of ${candidates.length} — raise --limit or use --json)`);

if (candidates.length) {
  console.log(`\nThe pipeline is PAUSED and translation costs money, so this script does not act.`);
  console.log(`To finish the top ${Math.min(5, candidates.length)}:\n`);
  for (const c of candidates.slice(0, 5)) {
    console.log(`  node --env-file=.env.production.local scripts/batch/realtime-translate.mjs --book-id=${c.book_id} --book-limit=1 --limit=${c.remaining}`);
  }
  console.log(`\nThen recount and re-sync, or the change stays invisible to the read path:`);
  console.log(`  node scripts/maintenance/recount-page-stats.mjs ${candidates.slice(0, 5).map(c => `--slug ${c.slug}`).join(' ')} --apply`);
  console.log(`  node scripts/workers/sync-books-catalog.mjs`);
}

if (JSON_OUT) {
  const fs = await import('node:fs');
  fs.writeFileSync(JSON_OUT, JSON.stringify({ generated_at: new Date().toISOString(), threshold: THRESHOLD, max_tail: MAX_TAIL, candidates }, null, 2));
  console.log(`\nWrote ${JSON_OUT}`);
}

await client.close();
