#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/reset-book-ocr.mjs — the existing book-grain
// "clear OCR + requeue" playbook (cancel outstanding jobs, bump
// pipeline_auto.ocr_generation, unset ocr, reset status to archive_complete).
// Wrong grain for this script: it clears ALL of a book's OCR, and these three
// populations are specific PAGES inside otherwise-fine books.
// scripts/maintenance/retry-model-blocked-pages.mjs (#4675 PR, unmerged at
// writing) is the right grain — reopen individual pages a give-up stranded,
// dry-run by default, --apply scoped and audit-logged — and this script
// follows the same shape for a different set of populations.
// scripts/audit/nearly-finished-translations.mjs — same "report-only,
// corpus-wide scan is slow, print the exact follow-up command" posture, and
// the translatable-page conventions (translate-core.mjs) this script also
// leans on for the 90-99% band definition.
// scripts/batch/bulk-reocr-*.mjs — actually CALL Gemini. Deliberately NOT
// reused: this script never spends money itself, it only clears misleading
// fields and points books back at the orchestrator's own queue.
// None of the above covers populations A/B/D from #4685 specifically, so
// this is a new file rather than an extension of one.
/**
 * requeue-silent-ocr-failures-4685 — audit (and, behind --apply, limited
 * repair) for three of #4685's silent-failure populations:
 *
 *   A. Pages with an image but NO `ocr` object at all — never attempted, no
 *      failure marker. (#4685 census, 40-book sample: 25/40 real running
 *      text; 36/40 carried no trace of an OCR attempt.)
 *   B. Pages with `ocr.data === ''` AND `ocr.model == null` — an
 *      initialized-but-never-run placeholder some importers stamped at page
 *      creation (fixed going forward in src/lib/import-utils.ts and
 *      scripts/import/import-thirukkural.ts, same PR as this script).
 *      40/40 sampled were real text, 0 blanks.
 *   D. Pages quarantined by the translation loop
 *      (`translation.loop_quarantine_reason` / `translation.health_blocked`)
 *      whose OCR is ITSELF degenerate — 8-25K chars on a page that holds a
 *      few thousand at most (legacy flash-lite-preview repetition/
 *      fabrication loop, #4523 territory, ~70% Tibetan in the sample). These
 *      are an OCR backlog wearing translation flags: retrying translation on
 *      fabricated input is pointless, the fix is re-OCR.
 *
 * (Population C — translation returned '' and was stored as a "done"
 * translation.data — is a WRITER bug, fixed in scripts/lib/translate-core.mjs
 * / src/lib/translate-write.ts / scripts/workers/translate-worker.mjs /
 * scripts/workers/batch-collector.mjs in this same PR. There is nothing to
 * requeue for C beyond what those writers already do on the next natural
 * pass, so it has no population here.)
 *
 * DEFAULT: DRY RUN. Prints counts per population, per book language,
 * restated for the 90-99.99%-translated band specifically (#4685's original
 * cohort), plus an estimated re-OCR cost. Writes NOTHING.
 *
 * --apply (requires --confirm too — see below) would:
 *   (a) $unset the whole `ocr` subdocument on population-B pages — there is
 *       no real text to lose (data is already ''), so it just removes the
 *       misleading placeholder and the page reads like population A instead.
 *   (b) $unset `ocr` on population-D pages, WITH a page_revisions snapshot of
 *       the degenerate text FIRST (it cost real Gemini spend and is
 *       evidence — never destroyed silently) — so the page reads as
 *       un-OCR'd rather than OCR'd-but-quarantined.
 *   (c) For every book touched by (a)/(b), or carrying a population-A gap,
 *       whose pipeline_auto.status has already advanced PAST archive_complete
 *       (ocr_complete, translate_*, enriched, complete, ...): reset that
 *       status to archive_complete and recompute pages_count/pages_ocr/
 *       pages_translated from the pages collection (mirrors reset-book-ocr.mjs
 *       steps 5+7). This does NOT touch any other page in the book.
 *
 * ACTUATION, not recording (CLAUDE.md): resetting pipeline_auto.status to
 * archive_complete is what makes the orchestrator's OCR-submit "full pass"
 * (submitOcrDirectly / pipeline-orchestrator.mjs, whose candidate query
 * requires pipeline_auto.status === 'archive_complete') consider the book
 * again. That worker runs on Hetzner every 2 minutes via the scheduler (see
 * memory/pipeline-ops.md) and is gated by the spend dial
 * (system_config.processing_control.daily_budget_usd — a live $5/day dial
 * per MEMORY.md at the time of writing). Running --apply therefore WILL be
 * picked up and WILL spend, on the orchestrator's very next cycle, if the
 * dial allows it. This script never calls Gemini directly.
 *
 * --apply also requires --confirm (a second flag, deliberate double gate),
 * and is capped by --limit-books (default 25) so a first run is small and
 * reviewable. This script has NOT been run with --apply in the PR that
 * introduces it — see the PR description.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/requeue-silent-ocr-failures-4685.mjs
 *   ... --json=/tmp/4685-audit.json          write the full per-language/per-population breakdown
 *   ... --apply --confirm --limit-books=25   (NOT run in this PR — see PR body)
 *
 * LIMITS, read before trusting the output:
 *  - Scoped to the canonical "live" filter (visible:true, pages_count>0,
 *    CLAUDE.md Stack section) — hidden/draft books are not counted or acted on.
 *  - Population D's "book is a manuscript" half of the selector has no direct
 *    field to query — checked directly, `books` carries no is_manuscript /
 *    format / dublin_core.dc_type / genre / physical_description / binding
 *    field in this schema for any of the four non-listed-language sample
 *    books tried. This script approximates "manuscript" with (title matches
 *    /MS\.|manuscript|papyrus|codex/i) OR (majority of the book's OTHER,
 *    non-degenerate OCR'd pages carry `<script>handwritten</script>`).
 *    Measured against the 40-record sample this PR was handed
 *    (sample-D_textQuarantined.json, in the session scratchpad): 37/40
 *    (92.5%), not the 40/40 a perfect selector would hit. The 3 misses: a
 *    Latin book with handwritten MARGINALIA noted on an otherwise printed
 *    body (Sancti Ioannis Chrysostomi), and two ordinary early-20th-century
 *    printed books (French, Swahili) with zero manuscript signal anywhere in
 *    their catalog metadata. None are distinguishable from this script's
 *    inputs without looking at the page image, which costs money this script
 *    does not spend. Reported honestly rather than tuned to hit 40/40.
 *  - Cost estimate uses the MEASURED per-page batch-OCR rate for flash-lite
 *    (scripts/lib/model-pricing.mjs PAGE_RATE_USD.ocrBatch, $0.00222/page,
 *    measured 2026-09-04) and exactly 2x that for flash-preview-routed books
 *    (BPH, or any non-Latin-script language per getOcrModelForBook) — flash-
 *    preview is priced at exactly 2x flash-lite on both input and output in
 *    MODEL_PRICING (0.50/3.00 vs 0.25/1.50), so any input/output token mix
 *    scales by the same factor. This is an ESTIMATE, not a quote — real cost
 *    depends on page density.
 *  - The pages-collection scans (A, B, D) are full-collection filters over
 *    ~20M pages; expect several minutes. Run with nohup/background if your
 *    shell needs to stay responsive.
 */

import { getScriptClient } from '../lib/mongo.mjs';
import { getOcrModelForBook, OCR_MODEL_FLASH } from '../lib/ocr-routing.mjs';
import { PAGE_RATE_USD, PAGE_RATES_MEASURED_ON } from '../lib/model-pricing.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CONFIRM = args.includes('--confirm');
const jsonArg = args.find((a) => a.startsWith('--json='));
const JSON_OUT = jsonArg ? jsonArg.split('=')[1] : null;
const limitArg = args.find((a) => a.startsWith('--limit-books='));
const LIMIT_BOOKS = limitArg ? parseInt(limitArg.split('=')[1], 10) : 25;

// flash-preview is exactly 2x flash-lite on input AND output in MODEL_PRICING
// (0.50/3.00 vs 0.25/1.50) — see scripts/lib/model-pricing.mjs. Any token mix
// scales by this one factor, so it is safe to apply to a per-page rate.
const FLASH_VS_LITE_RATIO = 2;

// Local copy of scripts/audit/scope-progress.mjs's STATUS_ORDER — that file
// does not export it (it is a script, not a lib module). Kept identical on
// purpose; a divergence here would make "past archive_complete" mean two
// different things in two places.
const STATUS_ORDER = [
  'queued', 'archiving', 'archive_complete', 'ocr_submitted', 'ocr_complete',
  'translate_submitted', 'translate_complete', 'summary_indexed', 'enriched',
  'chapters_complete', 'images_submitted', 'images_complete', 'cover_selected', 'complete',
];
const statusRank = (s) => STATUS_ORDER.indexOf(s);
const isPastArchiveComplete = (s) => statusRank(s) > statusRank('archive_complete');

const TITLE_MANUSCRIPT_RE = /\bMS\.?\s|\bmanuscript\b|\bpapyrus\b|\bcodex\b|\bcod\.\s/i;
const AUTO_MANUSCRIPT_LANGUAGES = new Set(["Tibetan", "Japanese", "Ge'ez", "Syriac", "Hebrew"]);

const HAS_IMAGE = {
  $or: [
    { photo: { $exists: true, $nin: [null, ''] } },
    { photo_original: { $exists: true, $nin: [null, ''] } },
    { archived_photo: { $exists: true, $regex: /^https?:\/\// } },
    { cropped_photo: { $exists: true, $nin: [null, ''] } },
  ],
};

const num = (n) => (n ?? 0).toLocaleString('en-US');
const usd = (n) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const describePageRateLocal = (rate) => `$${rate}/page (measured ${PAGE_RATES_MEASURED_ON})`;

function newPopulationStat() {
  return {
    pages: 0,
    bandPages: 0,
    byLanguage: new Map(),
    books: new Set(),
    bandBooks: new Set(),
    // book_id -> page count IN THIS POPULATION, for the cost estimate below.
    pagesPerBook: new Map(),
  };
}

async function main() {
  const { client, db } = await getScriptClient({ timeoutMs: 25 * 60 * 1000 });
  const startedAt = Date.now();

  if (APPLY && !CONFIRM) {
    console.error('--apply requires --confirm too (deliberate double gate). Nothing written.');
    await client.close();
    process.exit(1);
  }

  console.log('=== #4685 silent-OCR-failure audit (A, B, D) ===');
  console.log(APPLY ? `MODE: APPLY (limit ${LIMIT_BOOKS} books)` : 'MODE: DRY RUN — nothing will be written');
  console.log('');

  // ── 1. Live book map (visible:true, pages_count>0 — CLAUDE.md canonical
  //    "live" filter). Small enough (~30-35K books) to hold in memory, which
  //    turns every page-level lookup below into a local Map read instead of
  //    a per-page round trip to Mongo.
  const liveBooks = await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 } },
    { projection: { id: 1, language: 1, title: 1, 'image_source.provider': 1, pages_translated: 1, pages_translatable: 1, 'pipeline_auto.status': 1 } }
  ).toArray();
  const bookById = new Map(liveBooks.map((b) => [b.id, b]));
  console.log(`Live books (visible, pages_count>0): ${num(liveBooks.length)}`);

  const bandBookIds = new Set(
    liveBooks
      .filter((b) => (b.pages_translatable || 0) > 0)
      .filter((b) => {
        const pct = (b.pages_translated || 0) / b.pages_translatable;
        return pct >= 0.90 && pct < 0.9999;
      })
      .map((b) => b.id)
  );
  console.log(`Of those, in the 90-99.99% translated band (#4685's cohort): ${num(bandBookIds.size)}`);
  console.log('');

  // Cache of book-level "is this a manuscript?" for population D — needs an
  // extra read (majority <script> vote) only for books that miss both cheap
  // checks (language list, title keyword).
  const manuscriptCache = new Map();
  async function isManuscriptBook(book) {
    if (!book) return false;
    if (AUTO_MANUSCRIPT_LANGUAGES.has(book.language)) return true;
    if (TITLE_MANUSCRIPT_RE.test(book.title || '')) return true;
    if (manuscriptCache.has(book.id)) return manuscriptCache.get(book.id);
    const pages = await db.collection('pages').find(
      { book_id: book.id, 'ocr.data': { $exists: true, $nin: [null, ''] } },
      { projection: { 'ocr.data': 1 } }
    ).limit(30).toArray();
    let handwritten = 0, printed = 0;
    for (const p of pages) {
      const m = /<script>\s*(handwritten|printed|mixed)\s*<\/script>/i.exec(p.ocr?.data || '');
      if (!m) continue;
      if (m[1].toLowerCase() === 'handwritten') handwritten++;
      else if (m[1].toLowerCase() === 'printed') printed++;
    }
    const result = handwritten > printed;
    manuscriptCache.set(book.id, result);
    return result;
  }

  const stats = { A: newPopulationStat(), B: newPopulationStat(), D: newPopulationStat() };
  const booksToRequeue = new Set();
  const unsetBPageIds = [];
  const unsetDPageIds = [];

  function record(pop, page, book) {
    const s = stats[pop];
    s.pages++;
    s.books.add(book.id);
    s.pagesPerBook.set(book.id, (s.pagesPerBook.get(book.id) || 0) + 1);
    if (bandBookIds.has(book.id)) { s.bandPages++; s.bandBooks.add(book.id); }
    const lang = book.language || '(unknown)';
    s.byLanguage.set(lang, (s.byLanguage.get(lang) || 0) + 1);
  }

  // ── Population A: image present, no ocr object at all ──
  console.log('Scanning population A (no ocr object, image present)...');
  const aCursor = db.collection('pages').find(
    { page_number: { $gt: 0 }, ocr: { $exists: false }, ...HAS_IMAGE },
    { projection: { id: 1, book_id: 1 } }
  );
  for await (const page of aCursor) {
    const book = bookById.get(page.book_id);
    if (!book) continue; // not a live book — out of scope
    record('A', page, book);
    if (isPastArchiveComplete(book.pipeline_auto?.status)) booksToRequeue.add(book.id);
  }
  console.log(`  A: ${num(stats.A.pages)} pages across ${num(stats.A.books.size)} live books`);

  // ── Population B: ocr.data === '' AND ocr.model == null (placeholder) ──
  console.log('Scanning population B (ocr.data empty, ocr.model null placeholder)...');
  const bCursor = db.collection('pages').find(
    { page_number: { $gt: 0 }, 'ocr.data': '', 'ocr.model': null },
    { projection: { id: 1, book_id: 1 } }
  );
  for await (const page of bCursor) {
    const book = bookById.get(page.book_id);
    if (!book) continue;
    record('B', page, book);
    unsetBPageIds.push(page.id);
    if (isPastArchiveComplete(book.pipeline_auto?.status)) booksToRequeue.add(book.id);
  }
  console.log(`  B: ${num(stats.B.pages)} pages across ${num(stats.B.books.size)} live books`);

  // ── Population D: translation-quarantined, degenerate OCR (>8000 chars) ──
  console.log('Scanning population D (translation-quarantined, ocr.data > 8000 chars)...');
  const dCursor = db.collection('pages').find(
    {
      page_number: { $gt: 0 },
      $or: [
        { 'translation.loop_quarantine_reason': { $exists: true, $ne: null } },
        { 'translation.health_blocked': { $exists: true, $ne: null } },
      ],
      $expr: { $and: [
        { $eq: [{ $type: '$ocr.data' }, 'string'] },
        { $gt: [{ $strLenCP: '$ocr.data' }, 8000] },
      ] },
    },
    { projection: { id: 1, book_id: 1 } }
  );
  let dCandidates = 0;
  for await (const page of dCursor) {
    dCandidates++;
    const book = bookById.get(page.book_id);
    if (!book) continue;
    if (!(await isManuscriptBook(book))) continue; // the selector's second clause
    record('D', page, book);
    unsetDPageIds.push(page.id);
    if (isPastArchiveComplete(book.pipeline_auto?.status)) booksToRequeue.add(book.id);
  }
  console.log(`  D: ${num(dCandidates)} candidates (quarantined + >8000 chars) in live books, ${num(stats.D.pages)} pass the manuscript-or-listed-script selector across ${num(stats.D.books.size)} live books`);

  console.log('');
  console.log(`Scan took ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  console.log('');

  // ── Report ──
  function printPop(name, label) {
    const s = stats[name];
    console.log(`--- Population ${name}: ${label} ---`);
    console.log(`  Corpus-wide: ${num(s.pages)} pages, ${num(s.books.size)} live books`);
    console.log(`  In the 90-99% band: ${num(s.bandPages)} pages, ${num(s.bandBooks.size)} books`);
    const byLang = [...s.byLanguage.entries()].sort((a, b) => b[1] - a[1]);
    for (const [lang, n] of byLang.slice(0, 15)) {
      console.log(`    ${String(n).padStart(7)}  ${lang}`);
    }
    if (byLang.length > 15) console.log(`    ... and ${byLang.length - 15} more languages`);
    console.log('');
  }
  printPop('A', 'no ocr object at all, image present — never attempted');
  printPop('B', "ocr.data === '' && ocr.model == null — initialized placeholder, never run");
  printPop('D', 'translation-quarantined, degenerate OCR (>8000 chars) on a manuscript/listed-script book');

  // ── Cost estimate ──
  console.log('--- Estimated re-OCR cost (corpus-wide, A + B + D) ---');
  console.log(`Rate basis: ${describePageRateLocal(PAGE_RATE_USD.ocrBatch)} (flash-lite, batch); flash-preview-routed pages at ${FLASH_VS_LITE_RATIO}x that.`);

  // Merge per-book page counts across the three populations (a book can
  // appear in more than one; sum its pages, don't double the book itself).
  const mergedPagesPerBook = new Map();
  for (const pop of ['A', 'B', 'D']) {
    for (const [bookId, n] of stats[pop].pagesPerBook) {
      mergedPagesPerBook.set(bookId, (mergedPagesPerBook.get(bookId) || 0) + n);
    }
  }
  let litePages = 0, flashPages = 0, liteBooks = 0, flashBooks = 0;
  for (const [bookId, n] of mergedPagesPerBook) {
    const book = bookById.get(bookId);
    const model = getOcrModelForBook(book);
    if (model === OCR_MODEL_FLASH) { flashPages += n; flashBooks++; }
    else { litePages += n; liteBooks++; }
  }
  const liteCost = litePages * PAGE_RATE_USD.ocrBatch;
  const flashCost = flashPages * PAGE_RATE_USD.ocrBatch * FLASH_VS_LITE_RATIO;
  console.log(`  flash-lite-routed:    ${num(litePages)} pages across ${num(liteBooks)} books  ~${usd(liteCost)}`);
  console.log(`  flash-preview-routed: ${num(flashPages)} pages across ${num(flashBooks)} books  ~${usd(flashCost)}`);
  console.log(`  TOTAL ESTIMATE:       ${num(litePages + flashPages)} pages across ${num(mergedPagesPerBook.size)} books  ~${usd(liteCost + flashCost)}`);
  console.log('');

  if (JSON_OUT) {
    const out = {
      generated_at: new Date().toISOString(),
      live_books: liveBooks.length,
      band_books: bandBookIds.size,
      populations: Object.fromEntries(
        ['A', 'B', 'D'].map((p) => [p, {
          pages: stats[p].pages,
          books: stats[p].books.size,
          band_pages: stats[p].bandPages,
          band_books: stats[p].bandBooks.size,
          by_language: Object.fromEntries(stats[p].byLanguage),
        }])
      ),
      cost_estimate_usd: { lite: liteCost, flash: flashCost, total: liteCost + flashCost },
    };
    writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
    console.log(`Wrote ${JSON_OUT}`);
  }

  // ── --apply ──
  if (!APPLY) {
    console.log('DRY RUN complete. Re-run with --apply --confirm to write (see script header for what that does).');
    await client.close();
    return;
  }

  const touchedBooks = [...booksToRequeue].slice(0, LIMIT_BOOKS);
  const touchSet = new Set(touchedBooks);
  console.log(`--apply: touching ${touchedBooks.length} of ${booksToRequeue.size} eligible books (--limit-books=${LIMIT_BOOKS}).`);

  // Page ids need to be re-derived scoped to the touched books — rebuild the
  // page_id -> book_id map only for the B/D candidates (small sets).
  const bPagesInScope = [];
  const dPagesInScope = [];
  {
    const bDocs = await db.collection('pages')
      .find({ id: { $in: unsetBPageIds } }, { projection: { id: 1, book_id: 1 } }).toArray();
    for (const p of bDocs) if (touchSet.has(p.book_id)) bPagesInScope.push(p.id);
    const dDocs = await db.collection('pages')
      .find({ id: { $in: unsetDPageIds } }, { projection: { id: 1, book_id: 1 } }).toArray();
    for (const p of dDocs) if (touchSet.has(p.book_id)) dPagesInScope.push(p.id);
  }

  if (dPagesInScope.length > 0) {
    await saveRevisionsBeforeOverwrite(db, dPagesInScope, 'ocr', { reason: 'requeue-silent-ocr-failures-4685-D' });
    await db.collection('pages').updateMany({ id: { $in: dPagesInScope } }, { $unset: { ocr: '' } });
    console.log(`  D: unset ocr on ${dPagesInScope.length} pages (revision saved first)`);
  }
  if (bPagesInScope.length > 0) {
    await db.collection('pages').updateMany({ id: { $in: bPagesInScope } }, { $unset: { ocr: '' } });
    console.log(`  B: unset ocr placeholder on ${bPagesInScope.length} pages`);
  }

  for (const bookId of touchedBooks) {
    const [counts] = await db.collection('pages').aggregate([
      { $match: { book_id: bookId, page_number: { $gt: 0 } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        with_ocr: { $sum: { $cond: [{ $and: [{ $ne: ['$ocr.data', null] }, { $ne: ['$ocr.data', ''] }] }, 1, 0] } },
        with_translation: { $sum: { $cond: [{ $and: [{ $ne: ['$translation.data', null] }, { $ne: ['$translation.data', ''] }] }, 1, 0] } },
      } },
    ]).toArray();
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: {
        'pipeline_auto.status': 'archive_complete',
        'pipeline_auto.last_updated': new Date(),
        ...(counts ? { pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation } : {}),
        updated_at: new Date(),
      } }
    );
  }
  console.log(`  Reset pipeline_auto.status -> archive_complete and recounted OCR/translation for ${touchedBooks.length} book(s).`);
  console.log('  These will be picked up by the Hetzner orchestrator (scheduler runs every 2 min) on its next OCR-submit pass, subject to the daily spend dial.');

  await db.collection('audit_log').insertOne({
    action: 'requeue_silent_ocr_failures_4685',
    metadata: {
      issue: 4685,
      books_touched: touchedBooks.length,
      pages_unset_b: bPagesInScope.length,
      pages_unset_d: dPagesInScope.length,
    },
    timestamp: new Date(),
  });

  await client.close();
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
