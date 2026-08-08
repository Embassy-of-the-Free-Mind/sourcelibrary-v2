#!/usr/bin/env node
/**
 * Sync Worker
 *
 * Replaces the Vercel `sync-page-counts` and `sync-gallery-images` crons.
 * Runs with no time limit.
 *
 * Designed to run every 2 hours on Hetzner via crontab.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/sync-worker.mjs
 *   node scripts/workers/sync-worker.mjs --dry-run
 *   node scripts/workers/sync-worker.mjs --counts-only
 *   node scripts/workers/sync-worker.mjs --gallery-only
 *   node scripts/workers/sync-worker.mjs --usage-only --usage-from 2026-06-09
 *
 * This worker does NOT honor the pipeline pause — see the note in run(). Its
 * phases are bookkeeping, and gating them on a spend switch froze six derived
 * outputs for seven weeks (#3408).
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Supabase is the source of truth for gemini_usage since 2026-04-10 (Issue #567).
// MongoDB now only catches ~half the writes, so the daily rollup must read from
// Supabase. We reuse the same env vars as scripts/workers/lib/supabase-usage-logger.mjs.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_PAGE_SIZE = 1000; // PostgREST hard cap per request — paginate beyond it.

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const COUNTS_ONLY = args.includes('--counts-only');
const GALLERY_ONLY = args.includes('--gallery-only');
// Repair flags for the usage rollup (#3408). --usage-only runs just that phase;
// --usage-from YYYY-MM-DD widens its window from the default 3 days so a gap can
// be refilled through the SAME Supabase-paginated path the live rollup uses.
// scripts/maintenance/backfill-usage-daily.mjs aggregates Mongo instead, which
// has undercounted spend ~10x on batch-heavy days since the source of truth
// moved to Supabase (#567) — don't reach for it to fix a hole.
const USAGE_ONLY = args.includes('--usage-only');
const USAGE_FROM = args.includes('--usage-from') ? args[args.indexOf('--usage-from') + 1] : null;

console.log(`[sync-worker] Dry run: ${DRY_RUN}${COUNTS_ONLY ? ' | Counts only' : ''}${GALLERY_ONLY ? ' | Gallery only' : ''}`);

// ── Sync Page Counts ──

async function syncPageCounts(db) {
  console.log('\n--- Sync Page Counts ---');
  const start = Date.now();

  // Single aggregation: count OCR and translation pages per book.
  // Excludes hidden pages (page_number <= 0) so dedup-hidden pages and
  // archived-spread layers don't inflate pages_count.
  const pageStats = await db.collection('pages').aggregate([
    { $match: { page_number: { $gt: 0 } } },
    {
      $group: {
        _id: '$book_id',
        pages_count: { $sum: 1 },
        pages_ocr: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: [{ $type: '$ocr.data' }, 'string'] },
                { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
              ] },
              1, 0,
            ],
          },
        },
        // A blank page is NOT a translated page. The translator writes the
        // literal placeholder "[Blank page — no translatable content]" onto
        // every blank leaf, so a naive non-empty check counted 87,777 flyleaves
        // and endpapers as translations (99.8% of them under 120 characters).
        //
        // That is also what made `translation_pct` exceed 100: blank pages are
        // subtracted from the denominator below via `pages_blank`, but were
        // still counted here in the numerator. The Blue Qur'an reported
        // **1000% translated** — 60 pages of which 54 were blank, over a
        // denominator of 6. Measured 2026-08-08: every one of 300 sampled
        // over-100% books had translated blank pages, and excluding them lands
        // each on exactly 100%.
        pages_translated: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: [{ $type: '$translation.data' }, 'string'] },
                { $gt: [{ $strLenCP: '$translation.data' }, 0] },
                { $ne: [{ $ifNull: ['$page_type', ''] }, 'blank'] },
              ] },
              1, 0,
            ],
          },
        },
        pages_blank: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: [{ $ifNull: ['$page_type', ''] }, 'blank'] },
                { $eq: [{ $type: '$ocr.data' }, 'string'] },
                { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
              ] },
              1, 0,
            ],
          },
        },
        pages_archived: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: [{ $type: '$archived_photo' }, 'string'] },
                // Count any non-empty archived_photo; "failed:*" entries are rare
                // and will be a small overcount vs the perf cost of $regexMatch
                { $gt: [{ $strLenCP: '$archived_photo' }, 0] },
              ] },
              1, 0,
            ],
          },
        },
      },
    },
  ]).toArray();

  const statsMap = new Map();
  for (const stat of pageStats) {
    statsMap.set(stat._id, {
      pages_count: stat.pages_count,
      pages_ocr: stat.pages_ocr,
      pages_translated: stat.pages_translated,
      pages_blank: stat.pages_blank,
      pages_archived: stat.pages_archived,
    });
  }

  // Fetch all books' cached values
  const books = await db.collection('books')
    .find({}, { projection: { _id: 1, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_archived: 1, is_fully_translated: 1, over_90_translated: 1 } })
    .toArray();

  // Build bulk updates for mismatches
  const bulkOps = [];
  let mismatchCount = 0;

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const actual = statsMap.get(bookId) || { pages_count: 0, pages_ocr: 0, pages_translated: 0, pages_blank: 0, pages_archived: 0 };
    const current = {
      pages_count: book.pages_count || 0,
      pages_ocr: book.pages_ocr || 0,
      pages_translated: book.pages_translated || 0,
      pages_blank: book.pages_blank || 0,
      pages_archived: book.pages_archived || 0,
    };

    // Pre-compute translation metrics (avoids $expr queries on Atlas)
    const denominator = actual.pages_ocr - actual.pages_blank;
    const translation_pct = denominator > 0
      ? Math.round((actual.pages_translated / denominator) * 10000) / 100  // 2 decimal places
      : 0;
    const is_fully_translated = actual.pages_translated > 0 && actual.pages_translated >= denominator;
    const over_90_translated = actual.pages_translated > 0 && actual.pages_translated >= denominator * 0.9;

    if (
      current.pages_count !== actual.pages_count ||
      current.pages_ocr !== actual.pages_ocr ||
      current.pages_translated !== actual.pages_translated ||
      current.pages_blank !== actual.pages_blank ||
      current.pages_archived !== actual.pages_archived ||
      book.is_fully_translated !== is_fully_translated ||
      book.over_90_translated !== over_90_translated
    ) {
      mismatchCount++;
      if (!DRY_RUN) {
        bulkOps.push({
          updateOne: {
            filter: { _id: book._id },
            update: {
              $set: {
                pages_count: actual.pages_count,
                pages_ocr: actual.pages_ocr,
                pages_translated: actual.pages_translated,
                pages_blank: actual.pages_blank,
                pages_archived: actual.pages_archived,
                translation_pct,
                is_fully_translated,
                over_90_translated,
                updated_at: new Date(),
              },
            },
          },
        });
      }
    }
  }

  let updated = 0;
  if (bulkOps.length > 0) {
    const result = await db.collection('books').bulkWrite(bulkOps);
    updated = result.modifiedCount;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Books checked: ${books.length} | Mismatches: ${mismatchCount} | Updated: ${updated} | ${elapsed}s`);

  return { books_checked: books.length, mismatches: mismatchCount, updated };
}

// ── Sync Collection Counts ──
//
// Restores the collections.book_count / artwork_count cache sync that lived in
// the archived Vercel cron (src/app/api/cron/_archived/sync-page-counts). When
// the cron routes were archived (45fb98fb) this block was never ported into
// sync-worker, so the cached counts drifted on 271/359 collections (found
// 2026-06-04 via the eastern-erotic-literature "0 books" header — the
// collection page header at src/app/collections/[id]/page.tsx reads this
// cached field while the book grid does a live query, so they disagreed).

async function syncCollectionCounts(db) {
  console.log('\n--- Sync Collection Counts ---');
  const start = Date.now();

  // Resource types the art surfaces treat as non-artwork (documentary/photographic
  // records). Kept in sync with ART_EXCLUDED_RESOURCE_TYPES in src/lib/collections-utils.ts
  // (source of truth for the /collections/[id] artwork query) — change both together.
  const ART_EXCLUDED_RESOURCE_TYPES = ['photograph', 'object', 'sculpture', 'architectural', 'decorative', 'ritual-object'];

  // One pass over books per counter, instead of 2 countDocuments per collection.
  // book_count uses the canonical "readable book" filter from the archived cron;
  // artwork_count must match what the public /collections/[id] page shows — VISIBLE
  // artworks only, excluding the documentary resource types (was counting hidden
  // artworks too, overstating card counts by ~14.6K — e.g. natural-philosophy 800 vs 1697).
  // total_book_count = ALL visible member books (any translation state), so
  // collection cards can show total holdings rather than the readable-only
  // book_count. Artworks (resource_type present) stay excluded — they have
  // their own artwork_count.
  const [bookCounts, artworkCounts, totalBookCounts] = await Promise.all([
    db.collection('books').aggregate([
      { $match: { status: { $ne: 'deleted' }, visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, resource_type: { $exists: false } } },
      { $unwind: '$collections' },
      { $group: { _id: '$collections', n: { $sum: 1 } } },
    ]).toArray(),
    db.collection('books').aggregate([
      { $match: { status: { $ne: 'deleted' }, visible: true, resource_type: { $exists: true, $nin: ART_EXCLUDED_RESOURCE_TYPES } } },
      { $unwind: '$collections' },
      { $group: { _id: '$collections', n: { $sum: 1 } } },
    ]).toArray(),
    db.collection('books').aggregate([
      { $match: { status: { $ne: 'deleted' }, visible: true, resource_type: { $exists: false } } },
      { $unwind: '$collections' },
      { $group: { _id: '$collections', n: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray(),
  ]);
  const bookMap = new Map(bookCounts.map(r => [r._id, r.n]));
  const artMap = new Map(artworkCounts.map(r => [r._id, r.n]));
  const totalMap = new Map(totalBookCounts.map(r => [r._id, r.n]));

  const collections = await db.collection('collections')
    .find({}, { projection: { _id: 1, slug: 1, book_count: 1, artwork_count: 1, total_book_count: 1 } })
    .toArray();

  const ops = [];
  let mismatchCount = 0;
  for (const col of collections) {
    const liveBookCount = bookMap.get(col.slug) || 0;
    const liveArtworkCount = artMap.get(col.slug) || 0;
    const liveTotalBookCount = totalMap.get(col.slug) || 0;
    if ((col.book_count || 0) !== liveBookCount || (col.artwork_count || 0) !== liveArtworkCount || (col.total_book_count || 0) !== liveTotalBookCount) {
      mismatchCount++;
      if (!DRY_RUN) {
        ops.push({
          updateOne: {
            filter: { _id: col._id },
            update: { $set: { book_count: liveBookCount, artwork_count: liveArtworkCount, total_book_count: liveTotalBookCount, updated_at: new Date() } },
          },
        });
      }
    }
  }

  let updated = 0;
  if (ops.length > 0) {
    const result = await db.collection('collections').bulkWrite(ops);
    updated = result.modifiedCount;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Collections checked: ${collections.length} | Mismatches: ${mismatchCount} | Updated: ${updated} | ${elapsed}s`);

  return { collections_checked: collections.length, mismatches: mismatchCount, updated };
}

// ── Sync Gallery Images ──

async function syncGalleryImages(db) {
  console.log('\n--- Sync Gallery Images ---');
  const start = Date.now();

  // Find latest sync timestamp
  const latestDoc = await db.collection('gallery_images')
    .findOne({}, { sort: { updated_at: -1 }, projection: { updated_at: 1 } });
  const since = latestDoc?.updated_at || new Date(0);

  // Find pages updated since last sync
  const stalePages = await db.collection('pages')
    .find(
      {
        image_extraction_updated_at: { $gt: since },
        'detected_images.0': { $exists: true },
      },
      { projection: { id: 1, book_id: 1 } }
    )
    .limit(10000) // Higher limit than Vercel cron
    .toArray();

  if (stalePages.length === 0) {
    console.log('  No stale pages found');
    return { synced: 0, books_updated: 0, orphans_removed: 0 };
  }

  const pageIds = stalePages.map(p => p.id);
  const affectedBookIds = [...new Set(stalePages.map(p => p.book_id))];

  console.log(`  Stale pages: ${stalePages.length} across ${affectedBookIds.length} books`);

  if (DRY_RUN) {
    return { synced: stalePages.length, books_updated: affectedBookIds.length, orphans_removed: 0 };
  }

  // Delete old gallery_images for these pages (handles removed images)
  await db.collection('gallery_images').deleteMany({ page_id: { $in: pageIds } });

  // Materialization pipeline
  const pipeline = [
    { $match: { id: { $in: pageIds } } },
    { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        id: 1, book_id: 1, page_number: 1,
        cropped_photo: 1, archived_photo: 1, photo_original: 1, photo: 1,
        detected_images: 1, book: 1,
      },
    },
    { $unwind: { path: '$detected_images', includeArrayIndex: 'detection_index' } },
    {
      $match: {
        'detected_images.bbox': { $exists: true },
        'detected_images.detection_source': { $in: ['vision_model', 'manual', 'ocr_tag'] },
        'detected_images.gallery_quality': { $gte: 0.5 },
        // Ownership bookplates / ex-libris are provenance, not content — never materialize them
        'detected_images.type': { $nin: ['exlibris', 'bookplate'] },
      },
    },
    {
      $project: {
        _id: 0,
        id: { $concat: ['$id', '-', { $toString: '$detection_index' }] },
        page_id: '$id',
        book_id: '$book_id',
        page_number: '$page_number',
        detection_index: '$detection_index',
        // Prefer the CDN-served crop. Pages without cropped_photo/archived_photo
        // would otherwise fall through to upstream IIIF URLs (gallica, BSB, …),
        // leaking those into collection-page HTML and adding 1–3s per image.
        image_url: { $ifNull: ['$detected_images.extracted_url', { $ifNull: ['$cropped_photo', { $ifNull: ['$archived_photo', { $ifNull: ['$photo_original', '$photo'] }] }] }] },
        thumbnail_url: '$detected_images.thumbnail_url',
        extracted_url: '$detected_images.extracted_url',
        description: { $ifNull: ['$detected_images.description', ''] },
        type: '$detected_images.type',
        bbox: '$detected_images.bbox',
        rotation: '$detected_images.rotation',
        gallery_quality: '$detected_images.gallery_quality',
        confidence: '$detected_images.confidence',
        gallery_rationale: '$detected_images.gallery_rationale',
        museum_description: '$detected_images.museum_description',
        detection_source: '$detected_images.detection_source',
        // AI provenance — must be carried so re-sync doesn't strip model/date
        // (the #2406 / lesson_gallery_images_provenance_sync gap).
        model: '$detected_images.model',
        detected_at: '$detected_images.detected_at',
        metadata: '$detected_images.metadata',
        dhash: '$detected_images.dhash',
        book_title: { $ifNull: ['$book.display_title', { $ifNull: ['$book.title', 'Unknown'] }] },
        book_author: '$book.author',
        book_year: '$book.year',
        book_language: '$book.language',
        // book_visible is what the gallery read path filters on — omitting it
        // here is what left freshly-synced images invisible (#2531).
        book_visible: { $ifNull: ['$book.visible', false] },
        book_hidden: '$book.hidden',
        book_provider: '$book.image_source.provider',
        book_rank: { $literal: 0 },
        updated_at: new Date(),
      },
    },
    {
      $merge: {
        into: 'gallery_images',
        on: 'id',
        whenMatched: 'replace',
        whenNotMatched: 'insert',
      },
    },
  ];

  await db.collection('pages').aggregate(pipeline, { allowDiskUse: true }).toArray();

  // Recompute book_rank for affected books
  for (const bookId of affectedBookIds) {
    const bookImages = await db.collection('gallery_images')
      .find({ book_id: bookId })
      .sort({ gallery_quality: -1 })
      .toArray();

    const ops = bookImages.map((img, idx) => ({
      updateOne: {
        filter: { id: img.id },
        update: { $set: { book_rank: idx + 1 } },
      },
    }));

    if (ops.length > 0) {
      await db.collection('gallery_images').bulkWrite(ops);
    }
  }

  // Cleanup orphans from deleted books
  const galleryBookIds = await db.collection('gallery_images').distinct('book_id');
  const existingBooks = await db.collection('books')
    .find({ id: { $in: galleryBookIds } }, { projection: { id: 1 } })
    .toArray();
  const existingBookIds = new Set(existingBooks.map(b => b.id));
  const orphanedBookIds = galleryBookIds.filter(bid => !existingBookIds.has(bid));

  let orphansRemoved = 0;
  if (orphanedBookIds.length > 0) {
    const deleteResult = await db.collection('gallery_images').deleteMany({ book_id: { $in: orphanedBookIds } });
    orphansRemoved = deleteResult.deletedCount;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Synced: ${stalePages.length} | Books updated: ${affectedBookIds.length} | Orphans removed: ${orphansRemoved} | ${elapsed}s`);

  return { synced: stalePages.length, books_updated: affectedBookIds.length, orphans_removed: orphansRemoved };
}

// ── Sync Author Slugs ──

function authorSlugFn(author) {
  return author.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

async function syncAuthorSlugs(db) {
  console.log('\n--- Sync Author Slugs ---');
  const start = Date.now();
  const authors = await db.collection('books').distinct('author', {
    visible: true,
    author: { $exists: true, $ne: null, $nin: ['Unknown', 'Anonymous', 'Various'] },
  });
  const slugs = {};
  for (const a of authors) { const s = authorSlugFn(a); if (s) slugs[s] = a; }

  // Canonical-name aliases: an author's books may all be stored under a
  // name-order variant ("Bruno, Giordano") while links point at the entity's
  // canonical form ("Giordano Bruno"). Register slug(canonical) → a stored
  // variant so /author/<canonical-slug> resolves (the page loads by entity and
  // displays the canonical name). Don't overwrite a base entry. Unblocks the
  // collection-description author linker (#2176/#2179).
  let aliases = 0;
  const ents = await db.collection('books').aggregate([
    { $match: { visible: true, author: { $type: 'string', $ne: '' }, author_entity_id: { $nin: [null, ''] } } },
    { $group: { _id: '$author_entity_id', sample: { $first: '$author' } } },
  ], { allowDiskUse: true }).toArray();
  const sampleOf = new Map(ents.map(e => [String(e._id), e.sample]));
  const objIds = [...sampleOf.keys()].filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s));
  for (let i = 0; i < objIds.length; i += 2000) {
    const docs = await db.collection('entities').find(
      { _id: { $in: objIds.slice(i, i + 2000) } },
      { projection: { canonical_name: 1, name: 1 } }).toArray();
    for (const e of docs) {
      const canon = e.canonical_name || e.name;
      if (!canon) continue;
      const s = authorSlugFn(canon);
      const rep = sampleOf.get(String(e._id));
      if (s && rep && !slugs[s]) { slugs[s] = rep; aliases++; }
    }
  }

  if (!DRY_RUN) {
    await db.collection('system_config').updateOne(
      { _id: 'author_slugs' },
      { $set: { slugs, updated_at: new Date(), count: Object.keys(slugs).length } },
      { upsert: true }
    );
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ${Object.keys(slugs).length} author slugs synced (${aliases} canonical aliases) | ${elapsed}s`);
  return { author_slugs: Object.keys(slugs).length };
}

// ── Refresh Analytics Snapshot ──

async function refreshAnalyticsSnapshot(db) {
  console.log('\n--- Refresh Analytics Snapshot ---');
  const start = Date.now();

  const cursor = db.collection('books').find(
    { pages_count: { $gt: 0 } },
    {
      projection: {
        pages_count: 1, pages_ocr: 1, pages_translated: 1,
        'pipeline_auto.status': 1, language: 1, 'image_source.provider': 1,
      },
      batchSize: 5000,
    }
  );

  let totalBooks = 0, totalPages = 0, pagesWithOcr = 0, pagesWithTranslation = 0;
  let fullyTranslated = 0, oldOcrPages = 0;
  const funnelMap = new Map();
  const langMap = new Map();
  const providerMap = new Map();

  for await (const book of cursor) {
    totalBooks++;
    const pc = book.pages_count || 0;
    const po = book.pages_ocr || 0;
    const pt = book.pages_translated || 0;
    totalPages += pc;
    pagesWithOcr += po;
    pagesWithTranslation += pt;

    const status = book.pipeline_auto?.status || null;
    funnelMap.set(status, (funnelMap.get(status) || 0) + 1);

    const lang = book.language || 'Unknown';
    langMap.set(lang, (langMap.get(lang) || 0) + 1);

    const prov = book.image_source?.provider || 'unknown';
    providerMap.set(prov, (providerMap.get(prov) || 0) + 1);

    if (po > 0 && pt / po >= 0.95) fullyTranslated++;
    if (!status && po > 0) oldOcrPages += po;
  }

  const pipelineFunnel = Array.from(funnelMap.entries())
    .map(([status, count]) => ({ status: status || 'not_enrolled', count }))
    .sort((a, b) => b.count - a.count);

  const byLanguage = Array.from(langMap.entries())
    .map(([_id, count]) => ({ _id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const byProvider = Array.from(providerMap.entries())
    .map(([_id, count]) => ({ _id, count }))
    .sort((a, b) => b.count - a.count);

  const snapshot = {
    canon: {
      total_books: totalBooks,
      total_pages: totalPages,
      readable_books: fullyTranslated,
      first_translations: 0,
      first_translations_complete: fullyTranslated,
    },
    coverage: {
      ocr_pages: pagesWithOcr,
      ocr_percent: totalPages > 0 ? Math.round((pagesWithOcr / totalPages) * 1000) / 10 : 0,
      translated_pages: pagesWithTranslation,
      translated_percent: totalPages > 0 ? Math.round((pagesWithTranslation / totalPages) * 1000) / 10 : 0,
    },
    enrichment: { with_summary: 0, with_index: 0, with_chapters: 0, with_editions: 0 },
    splitting: { needsSplitting: 0, alreadySplit: 0, noSplitNeeded: 0, unchecked: 0, booksWithSplitPages: 0 },
    ocrBlocked: 0,
    oldOcrPages,
    pipelineFunnel,
    byLanguage,
    byCategory: [],
    byProvider,
  };

  if (!DRY_RUN) {
    await db.collection('system_config').updateOne(
      { _id: 'analytics_usage' },
      { $set: { data: snapshot, updated_at: new Date().toISOString() } },
      { upsert: true }
    );
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ${totalBooks} books scanned in ${elapsed}s`);
  console.log(`  Pages: ${totalPages} | OCR: ${pagesWithOcr} (${snapshot.coverage.ocr_percent}%) | Translated: ${pagesWithTranslation} (${snapshot.coverage.translated_percent}%)`);
  console.log(`  Funnel: ${pipelineFunnel.slice(0, 5).map(s => `${s.status}: ${s.count}`).join(', ')}`);

  return { books_scanned: totalBooks, elapsed_s: parseFloat(elapsed) };
}

// ── Sync Gemini Usage Daily ──

/**
 * Fetch every gemini_usage row whose timestamp falls in [dayStart, dayEnd)
 * from Supabase, paginating past PostgREST's 1000-row cap. Returns an array
 * of rows (each with the columns from supabase-usage-logger.mjs).
 */
async function fetchSupabaseUsageRows(dayStart, dayEnd) {
  const gte = dayStart.toISOString();
  const lt = dayEnd.toISOString();
  const rows = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const url = `${SUPABASE_URL}/rest/v1/gemini_usage`
      + `?select=type,mode,model,endpoint,status,error_category,error_message,`
      + `cost_usd,input_tokens,output_tokens,page_count`
      + `&timestamp=gte.${encodeURIComponent(gte)}`
      + `&timestamp=lt.${encodeURIComponent(lt)}`
      + `&order=timestamp.asc`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Supabase gemini_usage fetch failed (${resp.status}): ${text}`);
    }
    const page = await resp.json();
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break; // short page → done
    from += SUPABASE_PAGE_SIZE;
  }
  return rows;
}

/**
 * Compute the same rollup shape as aggregateDay() (Mongo path) from an array
 * of Supabase rows. Keeps every field downstream consumers may read.
 */
function aggregateRows(rows) {
  if (!rows || rows.length === 0) return null;

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const byType = {};
  const byModel = {};
  const byEndpoint = {};
  const byErrorCategory = {};

  for (const r of rows) {
    const cost = r.cost_usd ?? 0;
    const inTok = r.input_tokens ?? 0;
    const outTok = r.output_tokens ?? 0;
    const pages = r.page_count ?? 0;
    totalCost += cost;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;

    const typeKey = r.type || 'unknown';
    const t = byType[typeKey] || (byType[typeKey] = {
      count: 0, cost: 0, inputTokens: 0, outputTokens: 0,
      successCount: 0, failedCount: 0, pageCount: 0,
    });
    t.count += 1;
    t.cost += cost;
    t.inputTokens += inTok;
    t.outputTokens += outTok;
    t.pageCount += pages;
    if (r.status === 'success') t.successCount += 1;
    if (r.status === 'failed') t.failedCount += 1;

    const modelKey = r.model || 'unknown';
    const m = byModel[modelKey] || (byModel[modelKey] = { count: 0, cost: 0 });
    m.count += 1;
    m.cost += cost;

    if (r.endpoint) byEndpoint[r.endpoint] = (byEndpoint[r.endpoint] || 0) + 1;

    if (r.status === 'failed' && r.error_category) {
      const e = byErrorCategory[r.error_category] || (byErrorCategory[r.error_category] = {
        count: 0, lastMessage: '',
      });
      e.count += 1;
      if (r.error_message) e.lastMessage = String(r.error_message).substring(0, 200);
    }
  }

  return {
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalRecords: rows.length,
    byType, byModel, byEndpoint, byErrorCategory,
  };
}

/**
 * Supabase-backed day aggregation. Returns the rollup summary, or null if the
 * day has no rows.
 */
async function aggregateDayFromSupabase(dayStart, dayEnd) {
  const rows = await fetchSupabaseUsageRows(dayStart, dayEnd);
  return aggregateRows(rows);
}

async function aggregateDay(db, dayStart, dayEnd) {
  const [result] = await db.collection('gemini_usage').aggregate([
    { $match: { timestamp: { $gte: dayStart, $lt: dayEnd } } },
    { $facet: {
      totals: [{ $group: {
        _id: null,
        totalCost: { $sum: { $ifNull: ['$cost_usd', 0] } },
        totalInputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
        totalOutputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
        totalRecords: { $sum: 1 },
      }}],
      byType: [{ $group: {
        _id: '$type',
        count: { $sum: 1 },
        cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
        inputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
        successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        pageCount: { $sum: { $ifNull: ['$page_count', 0] } },
      }}],
      byModel: [{ $group: {
        _id: '$model',
        count: { $sum: 1 },
        cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
      }}],
      byEndpoint: [
        { $match: { endpoint: { $exists: true, $ne: null } } },
        { $group: { _id: '$endpoint', count: { $sum: 1 } } },
      ],
      byErrorCategory: [
        { $match: { status: 'failed', error_category: { $exists: true } } },
        { $group: {
          _id: '$error_category',
          count: { $sum: 1 },
          lastMessage: { $last: '$error_message' },
        }},
      ],
    }},
  ]).toArray();

  const totals = result?.totals?.[0];
  if (!totals || totals.totalRecords === 0) return null;

  const byType = {};
  for (const t of (result.byType || [])) {
    byType[t._id || 'unknown'] = {
      count: t.count, cost: t.cost, inputTokens: t.inputTokens,
      outputTokens: t.outputTokens, successCount: t.successCount,
      failedCount: t.failedCount, pageCount: t.pageCount,
    };
  }
  const byModel = {};
  for (const m of (result.byModel || [])) {
    byModel[m._id || 'unknown'] = { count: m.count, cost: m.cost };
  }
  const byEndpoint = {};
  for (const e of (result.byEndpoint || [])) {
    byEndpoint[e._id] = e.count;
  }
  const byErrorCategory = {};
  for (const e of (result.byErrorCategory || [])) {
    byErrorCategory[e._id || 'unknown'] = {
      count: e.count,
      lastMessage: (e.lastMessage || '').substring(0, 200),
    };
  }

  return {
    totalCost: totals.totalCost,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalRecords: totals.totalRecords,
    byType, byModel, byEndpoint, byErrorCategory,
  };
}

async function syncUsageDaily(db) {
  console.log('\n--- Sync Gemini Usage Daily ---');
  const start = Date.now();

  // Source of truth is Supabase since 2026-04-10 (Issue #567). Mongo only
  // catches ~half the writes, so reading it undercounts spend ~2x. Fall back
  // to the legacy Mongo aggregation only if the Supabase key is missing.
  const useSupabase = Boolean(SUPABASE_SERVICE_KEY);
  if (!useSupabase) {
    console.warn('  [warn] SUPABASE_SERVICE_ROLE_KEY not set — falling back to MongoDB gemini_usage (undercounts ~2x)');
  } else {
    console.log('  Source: Supabase gemini_usage (paginated)');
  }

  // Aggregate today and the past 2 days (covers late-arriving records), or back
  // to --usage-from when refilling a gap.
  const now = new Date();
  let daysUpdated = 0;

  let startOffset = 2;
  if (USAGE_FROM) {
    const from = new Date(USAGE_FROM + 'T00:00:00Z');
    if (Number.isNaN(from.getTime())) throw new Error(`--usage-from: bad date "${USAGE_FROM}"`);
    startOffset = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - from.getTime()) / 86400000);
    if (startOffset < 0) throw new Error(`--usage-from ${USAGE_FROM} is in the future`);
    console.log(`  Backfilling ${startOffset + 1} days from ${USAGE_FROM}`);
  }

  for (let offset = startOffset; offset >= 0; offset--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - offset);
    const dateStr = d.toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + 'T00:00:00Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    let summary;
    if (useSupabase) {
      try {
        summary = await aggregateDayFromSupabase(dayStart, dayEnd);
      } catch (err) {
        console.warn(`  [warn] Supabase aggregation failed for ${dateStr} (${err.message}) — falling back to MongoDB for this day`);
        summary = await aggregateDay(db, dayStart, dayEnd);
      }
    } else {
      summary = await aggregateDay(db, dayStart, dayEnd);
    }

    if (summary) {
      if (!DRY_RUN) {
        await db.collection('gemini_usage_daily').updateOne(
          { date: dateStr },
          { $set: { date: dateStr, ...summary, updatedAt: new Date() } },
          { upsert: true },
        );
      }
      daysUpdated++;
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ${daysUpdated} days updated | ${elapsed}s`);
  return { days_updated: daysUpdated };
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // NOTE: this worker deliberately does NOT honor processing_control.paused.
  //
  // Every phase below is derived-data bookkeeping — page counts, collection
  // counts, gallery materialization, author slugs, the analytics snapshot, and
  // the gemini_usage_daily rollup. None of them call Gemini, archive a page, or
  // otherwise spend money or advance a book through the pipeline, so the pause
  // switch (a *spend* control, honored by archive-*/enrich/translate/orchestrator)
  // has no reason to gate them.
  //
  // It used to. The pause set on 2026-06-08T22:55Z therefore froze all six
  // outputs for seven weeks: gemini_usage_daily's last row was 2026-06-08 and
  // system_config.analytics_usage / author_slugs were last written 2026-06-08
  // 22:16 — the run immediately before the pause. Worse, the cost rollup reads
  // $0.00 whether spend is genuinely zero or the aggregator is dead, so pausing
  // the pipeline also silently blinded the instrument that would show anything
  // bypassing the pause (bulk-reocr-local.mjs does). See #3408.
  //
  // If a phase here ever starts spending, gate that phase — not the worker.
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log('[sync-worker] Pipeline is paused; bookkeeping phases run anyway (no paid work here).');
  }

  let countsResult = {};
  let galleryResult = {};
  const phaseErrors = [];
  const phasesCompleted = [];

  if (!GALLERY_ONLY && !USAGE_ONLY) {
    try {
      countsResult = await syncPageCounts(db);
      phasesCompleted.push('counts');
    } catch (err) {
      console.error(`[sync-worker] Page counts phase FAILED: ${err.message}`);
      phaseErrors.push({ phase: 'counts', error: err.message });
    }

    try {
      await syncCollectionCounts(db);
      phasesCompleted.push('collection_counts');
    } catch (err) {
      console.error(`[sync-worker] Collection counts phase FAILED: ${err.message}`);
      phaseErrors.push({ phase: 'collection_counts', error: err.message });
    }
  }

  if (!COUNTS_ONLY && !USAGE_ONLY) {
    try {
      galleryResult = await syncGalleryImages(db);
      phasesCompleted.push('gallery');
    } catch (err) {
      console.error(`[sync-worker] Gallery sync phase FAILED: ${err.message}`);
      phaseErrors.push({ phase: 'gallery', error: err.message });
    }
  }

  // Always sync author slugs (fast, no flag needed)
  if (!USAGE_ONLY) try {
    await syncAuthorSlugs(db);
    phasesCompleted.push('author_slugs');
  } catch (err) {
    console.error(`[sync-worker] Author slugs phase FAILED: ${err.message}`);
    phaseErrors.push({ phase: 'author_slugs', error: err.message });
  }

  // Refresh analytics snapshot (cursor-based, ~3 min)
  if (!GALLERY_ONLY && !USAGE_ONLY) {
    try {
      await refreshAnalyticsSnapshot(db);
      phasesCompleted.push('analytics_snapshot');
    } catch (err) {
      console.error(`[sync-worker] Analytics snapshot phase FAILED: ${err.message}`);
      phaseErrors.push({ phase: 'analytics_snapshot', error: err.message });
    }
  }

  // Aggregate gemini_usage into daily rollups (today + 2 trailing days)
  if (!GALLERY_ONLY) {
    try {
      await syncUsageDaily(db);
      phasesCompleted.push('usage_daily');
    } catch (err) {
      console.error(`[sync-worker] Usage daily phase FAILED: ${err.message}`);
      phaseErrors.push({ phase: 'usage_daily', error: err.message });
    }
  }

  const duration = Date.now() - startTime;
  const hasErrors = phaseErrors.length > 0;

  console.log(`\n=== SYNC ${hasErrors ? 'PARTIAL' : 'COMPLETE'} (${(duration / 1000).toFixed(1)}s) ===`);
  if (hasErrors) {
    console.log(`  Completed phases: ${phasesCompleted.join(', ')}`);
    console.log(`  Failed phases: ${phaseErrors.map(e => e.phase).join(', ')}`);
  }

  // Write cron_runs record (always, even on partial failure)
  if (!DRY_RUN) {
    await db.collection('cron_runs').insertOne({
      cron: 'sync-worker',
      timestamp: new Date(),
      duration_ms: duration,
      status: hasErrors ? 'partial_failure' : 'success',
      failed: hasErrors,
      phases_completed: phasesCompleted,
      phases_failed: phaseErrors.map(e => e.phase),
      actions: {
        ...countsResult,
        gallery_synced: galleryResult.synced || 0,
        gallery_books_updated: galleryResult.books_updated || 0,
        gallery_orphans_removed: galleryResult.orphans_removed || 0,
      },
      errors: phaseErrors,
      error_count: phaseErrors.length,
      summary: `Counts: ${countsResult.mismatches || 0} mismatches, ${countsResult.updated || 0} updated. Gallery: ${galleryResult.synced || 0} pages synced.${hasErrors ? ` FAILED: ${phaseErrors.map(e => e.phase).join(', ')}` : ' Analytics snapshot refreshed.'}`,
    }).catch(() => {});
  }

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
