#!/usr/bin/env node
/**
 * Repair book COVER thumbnails that serve a full-size image — issue #2325.
 *
 * Symptom: collection/browse grids load a 130–310 KB cover instead of a ~3 KB
 * thumbnail ("serving non-thumbnails because we don't have them" — seen on
 * Sacred Texts). Measured ~23% of visible books, ~48% of Sacred Texts.
 *
 * Root cause: `buildCoverUpdate()` sets a book's thumb to
 * `page.image_thumb || page.thumbnail_blob || <full display url>` — so any cover
 * chosen when its page lacked a `-thumb.jpg` got the FULL image baked into
 * `image_thumb`/`thumbnail_blob`. The reader (`getBookThumbnailUrl`,'thumb')
 * prefers `image_thumb`; the Supabase grid (`books_catalog`) uses
 * `thumbnail_blob`. Both then serve the full image.
 *
 * What this does, per affected book:
 *   1. Pick the cover page (`cover_page`, else first page with a usable source).
 *   2. Resolve its source via the split-aware `getPageSource()` — the CROPPED
 *      HALF for split scans, never the spread (the #1730 hazard at cover level).
 *   3. Regenerate display (1200) + thumb (150) FRESH from that correct source
 *      and upload to `pages/{book}/{NNNN}{.jpg,-thumb.jpg}`. We regenerate rather
 *      than trust a pre-existing `-thumb.jpg` because an old one may have been
 *      rendered from the spread — it's one page per book, so correctness > a PUT.
 *   4. Rewrite the book's four cover fields (image_display/image_thumb/
 *      thumbnail/thumbnail_blob) so reader + grid agree, set the page's
 *      display_photo/image_thumb too, and bump `updated_at` so the incremental
 *      `sync-books-catalog` cron propagates it to the Supabase grid.
 *
 * v2 — book-level fallback (issue #2325 follow-up). ~70% of broken covers are
 * single-image / non-paginated books (artwork, external-thumb) with NO page
 * source but a perfectly good book-level cover image (`image_display`). For
 * those, derive a 150px thumb from that image, store at
 * `book-thumbnails/{id}-thumb.jpg`, and repoint the THUMB fields only
 * (image_thumb + thumbnail_blob) — leaving the full image for the detail view.
 * Only books with no usable image anywhere stay unrepairable (need archiving).
 *
 * Selection: a book is "broken" when its thumb field (image_thumb, else
 * thumbnail_blob) is NOT a canonical `-thumb.jpg` R2 variant (it's a full URL,
 * an /archived/ or /cropped/ URL, or absent). Drive off a collection (seen
 * surfaces first) or all visible books.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-cover-thumbs.mjs --collection=sacred-texts --dry-run
 *   node scripts/maintenance/repair-cover-thumbs.mjs --collection=sacred-texts --apply
 *   node scripts/maintenance/repair-cover-thumbs.mjs --visible --limit=2000 --apply
 *   node scripts/maintenance/repair-cover-thumbs.mjs --book=<id> --apply
 *
 * ⚠️ --dry-run (default) reports counts only. --apply writes R2 + Mongo. After a
 *    run, the grid updates on the next `sync-books-catalog` tick (or run it).
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';
import { getPageSource, isUsableImageUrl } from '../lib/page-image-url.mjs';

const args = process.argv.slice(2);
const getArg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const hasFlag = (n) => args.includes(`--${n}`);

const APPLY = hasFlag('apply');
const DRY_RUN = !APPLY;
const COLLECTION = getArg('collection');     // e.g. 'sacred-texts'
const VISIBLE_ALL = hasFlag('visible');       // all visible books
const BOOK_ID = getArg('book');               // single book
const LIMIT = parseInt(getArg('limit') || '100000', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '8', 10);

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

/**
 * Canonical pre-sized R2 thumb variants:
 *   - pages/{book}/{NNNN}-thumb.jpg          (page-sourced, v1)
 *   - book-thumbnails/{bookId}-thumb.jpg     (book-level image, v2 — artwork/external)
 */
const THUMB_RE = /\/(?:pages\/[a-zA-Z0-9-]+\/[a-z0-9-]*\d{3,}|book-thumbnails\/[a-zA-Z0-9-]+)-thumb\.jpg(\?|$)/;
const isRealThumb = (u) => isUsableImageUrl(u) && THUMB_RE.test(u);
const isUnsafeFormat = (u) => /\.(jp2|jpx|jpf|j2k|tiff?)(\?|$)/i.test(u || '');

/** A book whose grid thumb is NOT a real -thumb.jpg is broken (serves full/none). */
function isBrokenCoverThumb(book) {
  const thumb = book.image_thumb || book.thumbnail_blob;
  return !isRealThumb(thumb);
}

function variantKeys(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  return { display: `pages/${bookId}/${num}.jpg`, thumb: `pages/${bookId}/${num}-thumb.jpg` };
}

/** Book-level thumb key — for single-image / non-paginated books (artwork, external). */
const bookThumbKey = (bookId) => `book-thumbnails/${bookId}-thumb.jpg`;

/**
 * The book's existing cover image, for books with no page source (artwork,
 * external-thumb). This is the full/display image already shown — we only need
 * to derive a small thumb from it. Skip values that are already a -thumb.jpg or
 * an unsafe format.
 */
function bookLevelCoverImage(book) {
  const candidate = book.image_display || book.thumbnail || book.image_thumb || book.thumbnail_blob;
  if (!isUsableImageUrl(candidate) || isRealThumb(candidate) || isUnsafeFormat(candidate)) return null;
  return candidate;
}

async function uploadR2(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 100)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty body: ${url.slice(0, 100)}`);
  return buf;
}

const PAGE_PROJECTION = {
  _id: 1, id: 1, book_id: 1, page_number: 1,
  photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1,
  cropped_photo: 1, display_photo: 1, image_thumb: 1, split_from_spread: 1, crop: 1,
};

/** Find the cover page doc: cover_page if set + usable, else first usable page. */
async function findCoverPage(db, book) {
  if (book.cover_page != null) {
    const p = await db.collection('pages').findOne(
      { book_id: book.id, page_number: book.cover_page }, { projection: PAGE_PROJECTION });
    if (p && getPageSource(p)) return p;
  }
  // Fallback: lowest page_number with a usable source.
  const pages = await db.collection('pages')
    .find({ book_id: book.id }, { projection: PAGE_PROJECTION })
    .sort({ page_number: 1 }).limit(8).toArray();
  return pages.find(p => getPageSource(p)) || null;
}

const stats = {
  scanned: 0, broken: 0, repaired: 0, repaired_booklevel: 0, alreadyOk: 0,
  noCoverSource: 0, errors: 0, wouldRepair: 0,
};

/**
 * v2 — book-level fallback: no page source, but the book has a usable cover
 * image (artwork, external-thumb). Derive just a 150px thumb from it and store
 * at book-thumbnails/{id}-thumb.jpg; repoint the THUMB fields only (image_thumb
 * + thumbnail_blob) — leave image_display/thumbnail (the full cover) for the
 * detail view. Returns true if repaired.
 */
async function repairFromBookImage(db, book) {
  const source = bookLevelCoverImage(book);
  if (!source) return false;
  const buf = await download(source);
  // Only the thumb is used here (book-level cover), but pass the identity anyway
  // so the discarded display buffer doesn't trip the "unmarked variant" warning.
  const { thumb } = await generateDisplayVariants(buf, { bookId: book.id, pageNumber: 0 });
  const thumbUrl = await uploadR2(bookThumbKey(book.id), thumb);
  await db.collection('books').updateOne(
    { id: book.id },
    { $set: {
        image_thumb: thumbUrl,
        thumbnail_blob: thumbUrl,
        thumbnail_source: 'cover-thumb-repair-booklevel',
        updated_at: new Date(),
      } },
  );
  stats.repaired_booklevel++;
  return true;
}

async function repairBook(db, book) {
  stats.scanned++;
  if (!isBrokenCoverThumb(book)) { stats.alreadyOk++; return; }
  stats.broken++;

  if (DRY_RUN) { stats.wouldRepair++; return; }

  try {
    const page = await findCoverPage(db, book);
    const source = page ? getPageSource(page) : null;
    if (!page || !source || isUnsafeFormat(source)) {
      // No usable PAGE source. Fall back to the book's own cover image
      // (artwork / external-thumb): derive a thumb from it (v2). If that also
      // has nothing usable, it's genuinely unrepairable (needs archiving).
      if (await repairFromBookImage(db, book)) return;
      stats.noCoverSource++;
      return;
    }

    const keys = variantKeys(book.id, page.page_number);
    // Regenerate fresh from the CORRECT source (cropped half for split) — bulletproof.
    const buf = await download(source);
    const { display, thumb } = await generateDisplayVariants(buf, {
      bookId: book.id, pageNumber: page.page_number,
    });
    const displayUrl = await uploadR2(keys.display, display);
    const thumbUrl = await uploadR2(keys.thumb, thumb);

    // Keep the page doc consistent (so page-level reads + future cover picks agree).
    await db.collection('pages').updateOne(
      { $or: [{ id: page.id || page._id }, { _id: page.id || page._id }] },
      { $set: { display_photo: displayUrl, image_thumb: thumbUrl, updated_at: new Date() } },
    );

    // Move all four cover fields together (cf. 2026-05-05 cover-pipeline
    // postmortem: partial cover writes are the classic trap) + bump updated_at
    // so the incremental sync-books-catalog cron repopulates the Supabase grid.
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
          image_display: displayUrl,
          image_thumb: thumbUrl,
          thumbnail: displayUrl,
          thumbnail_blob: thumbUrl,
          thumbnail_source: 'cover-thumb-repair',
          cover_page: page.page_number,
          cover_selected_at: new Date(),
          updated_at: new Date(),
        } },
    );
    stats.repaired++;
  } catch (err) {
    stats.errors++;
    if (stats.errors <= 20) console.error(`  FAIL ${book.id}: ${err.message?.slice(0, 100)}`);
  }
}

async function parallelMap(items, fn, concurrency) {
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function main() {
  console.log(`[repair-cover-thumbs] #2325 — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  const scope = BOOK_ID ? `book ${BOOK_ID}` : COLLECTION ? `collection ${COLLECTION}` : VISIBLE_ALL ? 'all visible books' : '(no scope)';
  console.log(`  scope: ${scope}, limit: ${LIMIT}, concurrency: ${CONCURRENCY}`);
  if (!BOOK_ID && !COLLECTION && !VISIBLE_ALL) {
    console.error('  Specify --book=ID, --collection=SLUG, or --visible'); process.exit(1);
  }

  const client = await MongoClient.connect(process.env.MONGODB_URI, { maxPoolSize: 12 });
  const db = client.db('bookstore');

  const PROJ = { _id: 0, id: 1, cover_page: 1, image_thumb: 1, thumbnail_blob: 1, image_display: 1, thumbnail: 1, visible: 1 };
  let query;
  if (BOOK_ID) query = { id: BOOK_ID };
  else if (COLLECTION) query = { collections: COLLECTION };
  else query = { visible: true };

  const books = await db.collection('books').find(query, { projection: PROJ }).limit(LIMIT).toArray();
  console.log(`  ${books.length} books in scope`);

  await parallelMap(books, (b) => repairBook(db, b), CONCURRENCY);

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(stats, null, 2));
  if (DRY_RUN) {
    console.log(`\nDRY RUN — ${stats.broken} broken cover thumbs found of ${stats.scanned} scanned (${(100 * stats.broken / Math.max(1, stats.scanned)).toFixed(1)}%).`);
    console.log('Re-run with --apply to repair. Grid updates on the next sync-books-catalog tick.');
  } else {
    console.log(`\nRepaired ${stats.repaired} (page-sourced) + ${stats.repaired_booklevel} (book-level image) = ${stats.repaired + stats.repaired_booklevel}; ${stats.noCoverSource} had no usable image at all; ${stats.errors} errors.`);
    console.log('Run scripts/workers/sync-books-catalog.mjs (or wait for the cron) to propagate to the Supabase grid.');
  }

  await client.close();
}

main().catch(err => { console.error('[repair-cover-thumbs] Fatal:', err); process.exit(1); });
