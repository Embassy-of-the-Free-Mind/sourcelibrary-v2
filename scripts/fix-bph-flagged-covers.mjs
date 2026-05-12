#!/usr/bin/env node
/**
 * Step 2 of issue #1679 — fix the 85 BPH books flagged by the cover-quality
 * audit (`.claude/docs/bph-cover-audit-2026-05-11.json`).
 *
 * For each flagged book, walks the pages collection and picks a better cover
 * via this priority chain:
 *   1. page_type === 'title-page' (page_number ≤ 30)
 *   2. page_type === 'frontispiece' that isn't a digitizer insert (≤ 50)
 *   3. page_type === 'illustration' (≤ 15)
 *   4. first page with a useful page_type (not blank / digitizer / bookplate /
 *      exlibris / text / toc / index / errata / appendix), with a usable image
 *      and OCR that doesn't match digitizer-insert/library-stamp patterns (≤ 30)
 *   5. for books with no page_type metadata: first early page (≤ 10) that has
 *      an image, isn't blank, and doesn't match bad-cover OCR patterns.
 *
 * Updates ALL cover fields on the book in one pass:
 *   image_display, image_thumb, thumbnail, thumbnail_blob, cover_page,
 *   thumbnail_source='auto-fix-1679'
 *
 * Skip rules:
 *   - books with thumbnail_source === 'manual' (curator override)
 *   - books where no better page can be found (logged as SKIP)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/fix-bph-flagged-covers.mjs --dry-run     # preview
 *   node scripts/fix-bph-flagged-covers.mjs               # apply
 *   node scripts/fix-bph-flagged-covers.mjs --only 10     # limit to first N
 *   node scripts/fix-bph-flagged-covers.mjs --id <book_id>  # single book
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_N = (() => {
  const idx = args.indexOf('--only');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : null;
})();
const ONLY_ID = (() => {
  const idx = args.indexOf('--id');
  return idx !== -1 ? args[idx + 1] : null;
})();

const AUDIT_PATH = resolve(REPO_ROOT, '.claude/docs/bph-cover-audit-2026-05-11.json');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

// Patterns that indicate a page is a digitizer insert / library stamp / bookplate.
// Keep in sync with scripts/audit/bph-cover-quality.mjs and scripts/fix-bad-covers.mjs.
const BAD_COVER_PATTERNS = [
  /internet\s+archive/i,
  /digitized\s+by\s+google/i,
  /google\s+logo/i,
  /digitization\s+credit/i,
  /inserted\s+by\s+the\s+internet/i,
  /library\s+of\s+the\s+university/i,
  /digital\s+library/i,
  /california\s+digital/i,
  /barcode/i,
  /ex[\s\-.]?libris/i,
  /bookplate/i,
  /philosophia\s+hermetica/i,
  /bibliotheca\s+philosophica/i,
];

function isBadCoverOcr(ocrText) {
  if (!ocrText) return false;
  return BAD_COVER_PATTERNS.some(p => p.test(ocrText.substring(0, 1500)));
}

function isBlankOcr(ocrText) {
  if (!ocrText) return false;
  return /<page-type>\s*blank\s*<\/page-type>/i.test(ocrText) ||
         /<meta>\s*blank\b/i.test(ocrText);
}

const BAD_PAGE_TYPES = new Set(['blank', 'digitizer-insert', 'bookplate', 'exlibris', 'archived-spread']);
// `archived-spread` pages have negative page_numbers — they are the
// pre-split 2-page spread images kept around for provenance, and live
// outside the user-visible page sequence. They must never be used as covers.

// Page types that aren't visually appealing covers even if they're not "bad":
const POOR_COVER_TYPES = new Set(['text', 'toc', 'index', 'errata', 'appendix', 'notes', 'colophon']);

const PAGE_PROJECTION = {
  page_number: 1, page_type: 1,
  cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1,
  image_display: 1, image_thumb: 1, thumbnail_blob: 1,
  image_width: 1, image_height: 1,
  'ocr.data': 1,
};

function pageDisplayUrl(p) {
  return p.image_display || p.archived_photo || p.cropped_photo || p.photo || p.photo_original || null;
}
function pageThumbUrl(p) {
  return p.image_thumb || p.thumbnail_blob || pageDisplayUrl(p);
}

function pageHasImage(p) {
  return !!(p.archived_photo || p.cropped_photo || p.photo || p.photo_original || p.image_display);
}

function pageIsBlankOrBad(p) {
  if (BAD_PAGE_TYPES.has(p.page_type)) return true;
  const ocr = p.ocr?.data || '';
  return isBlankOcr(ocr) || isBadCoverOcr(ocr);
}

async function pickReplacement(db, bookId) {
  // 1) explicit title-page within first 30 visible pages (page_number > 0
  //    excludes archived-spread pages, which carry negative page numbers).
  const titlePages = await db.collection('pages').find(
    { book_id: bookId, page_type: 'title-page', page_number: { $gt: 0, $lte: 30 } },
    { projection: PAGE_PROJECTION, sort: { page_number: 1 }, limit: 5 }
  ).toArray();
  let candidate = titlePages.find(p => pageHasImage(p) && !pageIsBlankOrBad(p));
  if (candidate) return { page: candidate, strategy: 'title-page' };

  // 2) frontispiece that isn't a digitizer insert
  const fronts = await db.collection('pages').find(
    { book_id: bookId, page_type: 'frontispiece', page_number: { $gt: 0, $lte: 50 } },
    { projection: PAGE_PROJECTION, sort: { page_number: 1 }, limit: 5 }
  ).toArray();
  candidate = fronts.find(p => pageHasImage(p) && !pageIsBlankOrBad(p));
  if (candidate) return { page: candidate, strategy: 'frontispiece' };

  // 3) illustration within first 15 pages
  const illos = await db.collection('pages').find(
    { book_id: bookId, page_type: 'illustration', page_number: { $gt: 0, $lte: 15 } },
    { projection: PAGE_PROJECTION, sort: { page_number: 1 }, limit: 5 }
  ).toArray();
  candidate = illos.find(p => pageHasImage(p) && !pageIsBlankOrBad(p));
  if (candidate) return { page: candidate, strategy: 'illustration' };

  // 4) any usefully-typed page in first 30 (not blank/digitizer/text/toc/...)
  const useful = await db.collection('pages').find(
    {
      book_id: bookId,
      page_number: { $gt: 0, $lte: 30 },
      page_type: { $nin: [...BAD_PAGE_TYPES, ...POOR_COVER_TYPES, null] },
    },
    { projection: PAGE_PROJECTION, sort: { page_number: 1 }, limit: 10 }
  ).toArray();
  candidate = useful.find(p => pageHasImage(p) && !pageIsBlankOrBad(p));
  if (candidate) return { page: candidate, strategy: `useful:${candidate.page_type}` };

  // 5) first non-blank/non-bad early page (no page_type filter)
  const early = await db.collection('pages').find(
    { book_id: bookId, page_number: { $gt: 0, $lte: 10 } },
    { projection: PAGE_PROJECTION, sort: { page_number: 1 }, limit: 10 }
  ).toArray();
  candidate = early.find(p => pageHasImage(p) && !pageIsBlankOrBad(p));
  if (candidate) return { page: candidate, strategy: `early:pg${candidate.page_number}` };

  return null;
}

async function main() {
  const audit = JSON.parse(readFileSync(AUDIT_PATH, 'utf8'));
  let flagged = audit.results.filter(r => r.state === 'BLANK' || r.state === 'PLACEHOLDER');
  if (ONLY_ID) flagged = flagged.filter(r => r.id === ONLY_ID);
  if (ONLY_N) flagged = flagged.slice(0, ONLY_N);

  console.log(`Loaded ${audit.results.length} flagged books from audit; processing ${flagged.length}.`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}`);

  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 30_000,
    socketTimeoutMS: 180_000,
  });
  await client.connect();
  const db = client.db('bookstore');

  const report = { fixed: [], skipped: [], manual: [] };

  for (const r of flagged) {
    const book = await db.collection('books').findOne(
      { id: r.id },
      { projection: {
          id: 1, slug: 1, title: 1,
          image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1,
          cover_page: 1, thumbnail_source: 1,
        }, maxTimeMS: 10_000 }
    );
    if (!book) {
      report.skipped.push({ ...r, why: 'book not found' });
      console.log(`  MISS ${r.id} — book not found`);
      continue;
    }

    if (book.thumbnail_source === 'manual') {
      report.manual.push({ id: r.id, title: r.title });
      console.log(`  MANUAL ${r.title} — thumbnail_source=manual, skipping`);
      continue;
    }

    const pick = await pickReplacement(db, r.id);
    if (!pick) {
      report.skipped.push({ ...r, why: 'no acceptable replacement page' });
      console.log(`  SKIP "${r.title}" (page ${r.cover_page_number}, ${r.state}) — no replacement`);
      continue;
    }

    const { page, strategy } = pick;
    const newDisplay = pageDisplayUrl(page);
    const newThumb = pageThumbUrl(page);

    if (!newDisplay) {
      report.skipped.push({ ...r, why: 'replacement page has no image URL' });
      console.log(`  SKIP "${r.title}" — replacement page ${page.page_number} has no image URL`);
      continue;
    }

    // Only skip as "SAME" if the picked URL matches the existing cover URL.
    // (Some books have multiple page docs at the same page_number — e.g. a
    //  blank/digitizer doc plus the real title-page doc — so equal page numbers
    //  don't imply equal pictures.)
    const currentDisplay = book.image_display || book.thumbnail || null;
    if (newDisplay === currentDisplay) {
      report.skipped.push({ ...r, why: `selector returned same image URL (pg ${page.page_number})` });
      console.log(`  SAME "${r.title}" — selector returned same URL (pg ${page.page_number}, ${strategy})`);
      continue;
    }

    const update = {
      image_display: newDisplay,
      image_thumb: newThumb,
      thumbnail: newDisplay,
      thumbnail_blob: newThumb,
      cover_page: page.page_number,
      thumbnail_source: 'auto-fix-1679',
    };

    const entry = {
      id: r.id,
      slug: r.slug,
      title: r.title,
      read_count: r.read_count,
      from: { page: r.cover_page_number, state: r.state, url: r.cover_url },
      to: { page: page.page_number, page_type: page.page_type, strategy, url: newDisplay },
    };
    report.fixed.push(entry);

    console.log(`  FIX [${r.state} pg${r.cover_page_number}→${page.page_number} ${page.page_type}|${strategy}] "${r.title.slice(0, 60)}"`);

    if (!DRY_RUN) {
      await db.collection('books').updateOne({ id: r.id }, { $set: update });
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Flagged processed: ${flagged.length}`);
  console.log(`  Fixed:    ${report.fixed.length}`);
  console.log(`  Skipped:  ${report.skipped.length}`);
  console.log(`  Manual:   ${report.manual.length}`);

  // Persist the report for diff-against / verification.
  const outDir = resolve(REPO_ROOT, '.claude/docs');
  mkdirSync(outDir, { recursive: true });
  const stamp = DRY_RUN ? 'dryrun' : 'applied';
  const reportPath = resolve(outDir, `bph-cover-fix-2026-05-12-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({
    run_date: '2026-05-12',
    mode: DRY_RUN ? 'dry-run' : 'apply',
    counts: { fixed: report.fixed.length, skipped: report.skipped.length, manual: report.manual.length },
    fixed: report.fixed,
    skipped: report.skipped,
    manual: report.manual,
  }, null, 2));
  console.log(`  Report: ${reportPath}`);

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
