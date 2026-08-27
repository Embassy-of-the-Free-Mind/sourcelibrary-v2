/**
 * Digitizer-boilerplate cover sweep — issue #4276.
 *
 * Google-digitized IA scans (`*goog` identifiers) open with Google's legal
 * "Usage guidelines" insert, and many IA scans open with a funding/digitizer
 * page or a scanner color card. Books whose cover resolves to such a page show
 * digitizer boilerplate on every card, collection grid, and the book hero.
 *
 * This sweep:
 *   1. Finds visible books whose CURRENT cover page is digitizer boilerplate —
 *      by the page's OCR head or its page_type (color-card / scanner metadata).
 *   2. Re-scores the first 20 pages with the shared OCR scorer
 *      (scripts/lib/cover-scoring.mjs) and picks the best real page.
 *   3. Writes through buildCoverUpdate() — the canonical four-field cover
 *      contract — bumps updated_at (so sync-books-catalog picks the book up),
 *      and records a sweep_log row per action (field-sprawl invariant).
 *
 * Manual picks (thumbnail_source: 'manual') are never touched.
 * Cost: FREE (no model calls — OCR text only).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-digitizer-covers-4276.mjs --dry-run
 *   --dry-run       Census + preview only, no writes
 *   --limit N       Apply at most N cover changes
 *   --book-id ID    Single book (diagnostics)
 *
 * After a live run: run scripts/workers/sync-books-catalog.mjs (incremental)
 * and POST the changed slugs to /api/admin/revalidate.
 */

import { MongoClient } from 'mongodb';
import { scorePageForCover } from '../lib/cover-scoring.mjs';
import { buildCoverUpdate, isRenderableCoverUrl } from '../lib/cover-write.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : 0;
})();
const BOOK_ID = (() => {
  const i = process.argv.indexOf('--book-id');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const SWEEP = 'digitizer-cover-sweep-4276';
const SCAN_PAGES = 20;
const BATCH = 50;

/** Digitizer/scanner boilerplate signatures, tested on the OCR head of the
 *  CURRENT cover page only. Google's insert + IA funding pages. Deliberately
 *  narrow: a bare "digitized by google" is the per-leaf watermark and must
 *  NOT match (same rule as DIGITIZER_RE in cover-write.mjs). */
const BOILERPLATE_RE =
  /this is a digital copy of a book|about google book search|usage guidelines|whose legal copyright term has expired|digitized by the internet archive|funding from|archive\.org\/details|digital insertion/i;

/** page_type values that are scanner apparatus, never a cover.
 *  Deliberately does NOT include 'blank': OCR types real manuscript bindings
 *  as blank ("Front cover of the manuscript…"), and replacing an authentic
 *  binding with an interior page is a judgment call, not junk removal —
 *  that cleanup is a separate sweep with its own rules. */
const JUNK_TYPES = new Set([
  'digitizer-insert', 'scanner_metadata',
  'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target',
]);

/** Resolve which page_number the book's current cover points at, or null. */
function currentCoverPage(book) {
  if (Number.isInteger(book.cover_page)) return book.cover_page;
  if (Number.isInteger(book.cover_page_number)) return book.cover_page_number;
  for (const url of [book.image_thumb, book.thumbnail, book.image_display, book.thumbnail_blob]) {
    if (!url) continue;
    let m = url.match(/\/pages\/[^/]+\/(\d{4,})(?:-thumb|-full)?\.jpg$/);
    if (m) return parseInt(m[1], 10);
    m = url.match(/\/archived\/[^/]+\/(\d+)\.jpg$/);
    if (m) return parseInt(m[1], 10);
    // IA leaf URLs: /page/n{N}/ is 0-based → page_number N+1
    m = url.match(/\/page\/n(\d+)[/.]/);
    if (m) return parseInt(m[1], 10) + 1;
  }
  return null;
}

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 60000,
});
await client.connect();
const db = client.db('bookstore');

console.log(`=== Digitizer-boilerplate cover sweep (#4276) — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} ===`);

const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : {
      visible: true,
      pages_count: { $gt: 0 },
      thumbnail_source: { $ne: 'manual' },
    };

const books = await db.collection('books').find(bookQuery, {
  projection: {
    _id: 0, id: 1, slug: 1, title: 1, ia_identifier: 1, cover_page: 1,
    cover_page_number: 1, image_thumb: 1, image_display: 1, thumbnail: 1,
    thumbnail_blob: 1, thumbnail_source: 1,
  },
}).toArray();
console.log(`Scanning ${books.length} books…`);

const stats = { scanned: 0, coverUnresolved: 0, coverClean: 0, flagged: 0, fixed: 0, noBetterPage: 0, notRenderable: 0 };
const changes = [];
const skips = [];

for (let i = 0; i < books.length; i += BATCH) {
  const batch = books.slice(i, i + BATCH);
  const ids = batch.map(b => b.id);

  // One fetch per batch: first SCAN_PAGES pages of every book, OCR head only.
  const pages = await db.collection('pages').find(
    { book_id: { $in: ids }, page_number: { $gte: 0, $lte: SCAN_PAGES }, hidden: { $ne: true } },
    {
      projection: {
        _id: 0, book_id: 1, page_number: 1, page_type: 1, hidden: 1,
        photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1,
        enhanced_photo: 1, split_from_spread: 1, image_thumb: 1, thumbnail_blob: 1,
        ocr_head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 1200] },
      },
    },
  ).toArray();
  const byBook = new Map();
  for (const p of pages) {
    if (!byBook.has(p.book_id)) byBook.set(p.book_id, []);
    byBook.get(p.book_id).push(p);
  }

  for (const book of batch) {
    if (LIMIT && stats.fixed >= LIMIT) break;
    stats.scanned++;
    const bookPages = (byBook.get(book.id) || []).sort((a, b) => a.page_number - b.page_number);
    if (!bookPages.length) { stats.coverUnresolved++; continue; }

    const coverNum = currentCoverPage(book);
    if (coverNum === null) { stats.coverUnresolved++; continue; }
    const coverPage = bookPages.find(p => p.page_number === coverNum);
    // Cover beyond the scanned window: a deliberate deep pick — leave it.
    if (!coverPage && coverNum > SCAN_PAGES) { stats.coverClean++; continue; }

    const head = coverPage?.ocr_head || '';
    const isBoilerplate =
      (coverPage && JUNK_TYPES.has(coverPage.page_type)) || BOILERPLATE_RE.test(head);
    if (!isBoilerplate) { stats.coverClean++; continue; }
    stats.flagged++;

    // Re-score every scanned page; scorer reads ocr_head via its fallback chain.
    const scored = bookPages
      .map(p => ({ page: p, ...scorePageForCover(p, { bookTitle: book.title }) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < 30 || best.page.page_number === coverNum) {
      stats.noBetterPage++;
      skips.push({ id: book.id, slug: book.slug, why: `no better page (best p${best?.page.page_number} score ${best?.score})` });
      continue;
    }

    const update = buildCoverUpdate(best.page, {
      source: 'smart_ocr',
      method: SWEEP,
      actor: 'script',
      confidence: 0.8,
      detail: `was p${coverNum} (digitizer boilerplate) → p${best.page.page_number}: ${best.reason} (score ${best.score})`,
    });
    if (!update || !isRenderableCoverUrl(update.image_thumb)) {
      stats.notRenderable++;
      skips.push({ id: book.id, slug: book.slug, why: 'best page has no renderable cover URL' });
      continue;
    }

    stats.fixed++;
    changes.push({ id: book.id, slug: book.slug, title: (book.title || '').slice(0, 55), from: coverNum, to: best.page.page_number, reason: best.reason, score: best.score, thumb: update.image_thumb });

    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { ...update, updated_at: new Date() } },
      );
      await recordSweepAction(db, {
        sweep: SWEEP,
        book_id: book.id,
        action: 'cover-replaced',
        detail: { from_page: coverNum, to_page: best.page.page_number, reason: best.reason, score: best.score },
      });
    }
  }
  process.stdout.write(`  ${Math.min(i + BATCH, books.length)}/${books.length} — flagged ${stats.flagged}, ${DRY_RUN ? 'would fix' : 'fixed'} ${stats.fixed}\r`);
  if (LIMIT && stats.fixed >= LIMIT) break;
}

console.log(`\n\n=== Results (${DRY_RUN ? 'dry run' : 'applied'}) ===`);
console.log(stats);
console.log(`\n--- Changes (${changes.length}) ---`);
for (const c of changes.slice(0, 40)) {
  console.log(`  ${c.slug || c.id}  p${c.from} → p${c.to}  [${c.reason}, ${c.score}]  ${c.title}`);
}
if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);
if (skips.length) {
  console.log(`\n--- Flagged but skipped (${skips.length}) ---`);
  for (const s of skips.slice(0, 20)) console.log(`  ${s.slug || s.id}: ${s.why}`);
  if (skips.length > 20) console.log(`  … and ${skips.length - 20} more`);
}

// Machine-readable output for the revalidation step + visual sampling.
if (process.env.SWEEP_JSON_OUT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SWEEP_JSON_OUT, JSON.stringify({ dryRun: DRY_RUN, stats, changes, skips }, null, 1));
  console.log(`\nWrote ${process.env.SWEEP_JSON_OUT}`);
}

await client.close();
