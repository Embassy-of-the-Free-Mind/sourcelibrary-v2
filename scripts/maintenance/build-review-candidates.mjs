#!/usr/bin/env node
/**
 * Build the `review_candidates` pool that feeds the volunteer review queues.
 *
 * WHY THIS EXISTS
 * ---------------
 * The hallucination and scan-quality routes used to select an item by running
 * `$sample` over `pages` — 19.1M documents — with a predicate no index can
 * serve (`{'ocr.data': {$regex: '<image-desc'}}` and `{archived_photo: {$exists}}`).
 * That is a full collection scan on every single item fetch, behind a 15s
 * `maxDuration`. Both routes returned 504 in production (17-23s), so the two
 * best queues were unusable while the third — which reads the much smaller
 * `gallery_images` — kept working. Measured 2026-08-02.
 *
 * The fix is architectural, not a tuning knob: precompute a bounded pool the
 * same way `gallery_images` is a materialized view of `pages.detected_images`,
 * and let the request path read a small indexed collection.
 *
 * WHY PER-BOOK, NOT A GLOBAL SCAN
 * -------------------------------
 * We iterate books and query their pages via the {book_id, page_number} index,
 * so no step ever scans the whole `pages` collection. It also bounds how many
 * pages any single book contributes (`--per-book`), which matters for the
 * statistics: an unbounded draw would let one 900-page book dominate the pool
 * and quietly turn "quality of the corpus" into "quality of that book".
 *
 * STRATA
 * ------
 * Every candidate carries a `stratum` (language / century / provider). Nothing
 * reads it yet — the live queues sample at random. It is written now because a
 * stratified draw cannot be reconstructed after the fact, and the sampled assay
 * (issue #3560) needs it.
 *
 * Usage:
 *   node scripts/maintenance/build-review-candidates.mjs                 # both queues
 *   node scripts/maintenance/build-review-candidates.mjs --queue=hallucination
 *   node scripts/maintenance/build-review-candidates.mjs --target=4000 --per-book=2
 *   node scripts/maintenance/build-review-candidates.mjs --dry-run
 */

import { MongoClient } from 'mongodb';
import {
  IMAGE_CANDIDATE_PAGE_TYPES,
  extractImageDescTags,
  shouldSkipPageByMarkup,
} from '../lib/image-extraction-filter.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const has = name => args.includes(`--${name}`);

const DRY_RUN = has('dry-run');
const TARGET = parseInt(flag('target', '4000'), 10);
const PER_BOOK = parseInt(flag('per-book', '2'), 10);
const ONLY_QUEUE = flag('queue', null);
const QUEUES = ONLY_QUEUE ? [ONLY_QUEUE] : ['hallucination', 'scan-quality', 'gallery-quality'];

const VALID_QUEUES = new Set(['hallucination', 'scan-quality', 'gallery-quality']);
for (const q of QUEUES) {
  if (!VALID_QUEUES.has(q)) {
    console.error(`Unknown queue "${q}". Valid: ${[...VALID_QUEUES].join(', ')}`);
    process.exit(1);
  }
}

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a; node ...');
  process.exit(1);
}

/** A build marker so we can retire the previous pool without a window-based
 *  deleteMany on a shared collection (see CLAUDE.md — delete by marker, never
 *  by time window). Not derived from Date.now() alone so concurrent builds of
 *  different queues can't collide. */
const BUILD_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;

function centuryOf(year) {
  if (typeof year !== 'number' || !Number.isFinite(year) || year < 800 || year > 2100) return 'unknown';
  return `${Math.floor(year / 100) + 1}C`;
}

function providerOf(book) {
  return (
    book?.image_source?.provider ||
    book?.held_by ||
    (book?.ia_identifier ? 'internet-archive' : null) ||
    'unknown'
  );
}

function stratumOf(book) {
  return {
    language: book?.language || 'unknown',
    century: centuryOf(book?.year),
    provider: providerOf(book),
  };
}

/** Shuffle in place (Fisher-Yates) so a truncated draw isn't just "first N by
 *  insertion order", which correlates with page number and therefore with
 *  front-matter. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pages a volunteer must never be shown.
 *
 * A NEGATIVE `page_number` is a soft-hide (see the page-image field notes): the
 * page is deliberately not reachable in the reader, usually an un-split spread
 * superseded by its two halves. Its `page_link` resolves to `/page/-111`, a
 * dead URL — so the "click to open the actual page" affordance is broken, and
 * any judgment collected is about a page no reader will ever see. Measured
 * before this filter: 7.5% of the scan-quality pool, 3.7% of hallucination.
 *
 * `archived-spread` is the same story from the other side: the spread is kept
 * for provenance but the halves are what readers get.
 */
function isUnshowable(p) {
  if (typeof p.page_number !== 'number' || p.page_number < 0) return true;
  if (p.page_type === 'archived-spread') return true;
  return false;
}

function imageUrlFor(p, bookId) {
  return (
    p.archived_photo ||
    p.photo_original ||
    p.photo ||
    `https://images.sourcelibrary.org/archived/${bookId}/${p.page_number}.jpg`
  );
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');
  const candidates = db.collection('review_candidates');

  if (!DRY_RUN) {
    await candidates.createIndex({ queue: 1, build_id: 1 });
    await candidates.createIndex({ queue: 1, item_id: 1 }, { unique: true });
    await candidates.createIndex({ queue: 1, 'stratum.language': 1, 'stratum.century': 1 });
  }

  // Visible books with OCR, shuffled so a partial run still spans the corpus
  // rather than marching alphabetically through it.
  const bookList = await books
    .find(
      { visible: true, pages_count: { $gt: 0 } },
      {
        projection: {
          _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1,
          held_by: 1, ia_identifier: 1, 'image_source.provider': 1, pages_ocr: 1,
        },
      },
    )
    .toArray();
  shuffle(bookList);
  console.log(`[build] ${bookList.length} visible books with pages; target ${TARGET}/queue, max ${PER_BOOK}/book`);

  for (const queue of QUEUES) {
    const collected = [];
    let booksScanned = 0;

    // gallery-quality draws from `gallery_images` (207K docs, well indexed)
    // rather than `pages`. It never 504'd, but `$sample` over that collection
    // still cost ~8.2s per item, which is its own kind of unusable. Pooling it
    // here puts all three queues on the same fast read path.
    if (queue === 'gallery-quality') {
      const bookById = new Map(bookList.map(b => [b.id, b]));
      const perBookCount = new Map();
      const rows = await db
        .collection('gallery_images')
        .find(
          { extracted_url: { $ne: null }, book_visible: true, gallery_quality: { $gte: 0.4 } },
          {
            projection: {
              _id: 0, id: 1, book_id: 1, page_number: 1, extracted_url: 1,
              thumbnail_url: 1, image_url: 1, description: 1, type: 1,
              gallery_quality: 1, book_title: 1, book_author: 1, book_year: 1, book_language: 1,
            },
          },
        )
        .toArray();
      shuffle(rows);

      /* Bias toward the CONTESTED band, which is the whole point of asking a
         human. The 0.7 display cutoff means images scored 0.5-0.85 are where a
         human judgment can actually change what the gallery shows; an image at
         0.95 is one everybody agrees on, and rating it teaches us nothing.
         The old per-request route drew 70% from that band. When this builder
         replaced it the bias was lost — the route comment claimed it "now
         lives in the builder" while the builder just took everything >= 0.4,
         and the resulting pool came out 34% at >= 0.85.

         Fill the contested band to quota FIRST, then top up from the rest.
         Ordering the array and iterating once is not enough: the per-book cap
         skips a large share of the prefix, so the tail silently backfills with
         uncontested images (measured 42.5% contested when we tried that). */
      const CONTESTED_SHARE = 0.7;
      const contestedTarget = Math.round(TARGET * CONTESTED_SHARE);
      const inContested = g => g.gallery_quality >= 0.5 && g.gallery_quality < 0.85;
      const passes = [
        { rows: rows.filter(inContested), limit: contestedTarget },
        { rows: rows.filter(g => !inContested(g)), limit: TARGET },
        { rows: rows.filter(inContested), limit: TARGET }, // top up if the band ran dry
      ];

      for (const pass of passes) {
      for (const g of pass.rows) {
        if (collected.length >= Math.min(pass.limit, TARGET)) break;
        // Soft-hidden pages (negative page_number) link to a dead /page/-111
        // URL, same as in the pages lane — see isUnshowable().
        if (typeof g.page_number !== 'number' || g.page_number < 0) continue;
        const taken = perBookCount.get(g.book_id) ?? 0;
        if (taken >= PER_BOOK) continue;
        perBookCount.set(g.book_id, taken + 1);

        const book = bookById.get(g.book_id);
        collected.push({
          queue,
          build_id: BUILD_ID,
          item_id: String(g.id),
          book_id: g.book_id,
          page_id: null,
          page_number: g.page_number,
          page_type: null,
          image_url: g.extracted_url || g.thumbnail_url || g.image_url,
          page_link: `https://sourcelibrary.org/book/${book?.slug || g.book_id}/page/${g.page_number}`,
          book: {
            id: g.book_id, title: g.book_title, author: g.book_author,
            year: g.book_year, language: g.book_language, slug: book?.slug ?? null,
          },
          stratum: stratumOf(book ?? { language: g.book_language, year: g.book_year }),
          payload: {
            gallery_image_id: g.id,
            full_page_url: g.image_url ?? null,
            description: g.description ?? null,
            type: g.type ?? null,
            gallery_quality: g.gallery_quality ?? null,
          },
          is_gold: false,
          gold_answer: null,
          created_at: new Date(),
        });
      }
      }
      booksScanned = perBookCount.size;
    }

    for (const book of queue === 'gallery-quality' ? [] : bookList) {
      if (collected.length >= TARGET) break;
      booksScanned++;

      let pageDocs;
      if (queue === 'hallucination') {
        if (!book.pages_ocr) continue;
        // Indexed by book_id — never a collection scan. The regex is applied
        // within one book's pages, which is a handful of documents.
        pageDocs = await pages
          .find(
            { book_id: book.id, 'ocr.data': { $regex: '<image-desc' } },
            {
              projection: {
                _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1,
                archived_photo: 1, photo_original: 1, photo: 1, 'ocr.data': 1,
              },
              limit: 25,
            },
          )
          .toArray();
      } else {
        pageDocs = await pages
          .find(
            { book_id: book.id, archived_photo: { $exists: true, $ne: null } },
            {
              projection: {
                _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1,
                archived_photo: 1, photo_original: 1, photo: 1, scan_quality: 1,
              },
              limit: 25,
            },
          )
          .toArray();
      }

      if (!pageDocs.length) continue;
      shuffle(pageDocs);

      let takenFromBook = 0;
      for (const p of pageDocs) {
        if (takenFromBook >= PER_BOOK || collected.length >= TARGET) break;
        if (isUnshowable(p)) continue;

        const pageLink = `https://sourcelibrary.org/book/${book.slug || book.id}/page/${p.page_number}`;
        const bookMeta = {
          id: book.id, title: book.title, author: book.author,
          year: book.year, language: book.language, slug: book.slug,
        };

        if (queue === 'hallucination') {
          const ocrData = p.ocr?.data ?? '';
          // Preserve the original route's semantics: only show pages the
          // extraction worker would KEEP, so a volunteer's judgment maps onto
          // a vision call we would otherwise have paid for.
          const inCandidateType = IMAGE_CANDIDATE_PAGE_TYPES.includes(p.page_type);
          if (!inCandidateType && shouldSkipPageByMarkup(ocrData)) continue;

          const tags = extractImageDescTags(ocrData);
          if (tags.length === 0) continue;

          collected.push({
            queue,
            build_id: BUILD_ID,
            item_id: `${p.book_id}:${p.page_number}`,
            book_id: p.book_id,
            page_id: p.id ?? null,
            page_number: p.page_number,
            page_type: p.page_type ?? null,
            image_url: imageUrlFor(p, p.book_id),
            page_link: pageLink,
            book: bookMeta,
            stratum: stratumOf(book),
            payload: {
              descriptions: tags.map(t => ({
                type: t.type, significance: t.significance,
                size: t.size, description: t.description,
              })),
            },
            // Attention-check scaffolding. Items seeded with a known answer are
            // marked here; nothing sets these yet (see #3560), but the queue
            // route already refuses to leak the answer to the client.
            is_gold: false,
            gold_answer: null,
            created_at: new Date(),
          });
        } else {
          collected.push({
            queue,
            build_id: BUILD_ID,
            item_id: String(p.id ?? `${p.book_id}:${p.page_number}`),
            book_id: p.book_id,
            page_id: p.id ?? null,
            page_number: p.page_number,
            page_type: p.page_type ?? null,
            image_url: imageUrlFor(p, p.book_id),
            page_link: pageLink,
            book: bookMeta,
            stratum: stratumOf(book),
            payload: { existing_scan_quality: p.scan_quality ?? null },
            is_gold: false,
            gold_answer: null,
            created_at: new Date(),
          });
        }
        takenFromBook++;
      }

      if (booksScanned % 500 === 0) {
        console.log(`[${queue}] ${booksScanned} books scanned, ${collected.length}/${TARGET} collected`);
      }
    }

    console.log(`[${queue}] collected ${collected.length} candidates from ${booksScanned} books`);

    const strata = {};
    for (const c of collected) {
      const k = `${c.stratum.language}/${c.stratum.century}`;
      strata[k] = (strata[k] || 0) + 1;
    }
    const top = Object.entries(strata).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`[${queue}] top strata: ${top.map(([k, n]) => `${k}:${n}`).join('  ')}`);

    if (DRY_RUN) {
      console.log(`[${queue}] --dry-run, nothing written`);
      continue;
    }
    if (collected.length === 0) {
      console.log(`[${queue}] nothing collected — leaving the existing pool in place`);
      continue;
    }

    // Insert the new pool, THEN retire the old one by marker. In this order a
    // crash mid-run leaves both pools live (harmless duplicates) rather than
    // an empty queue.
    let inserted = 0;
    for (let i = 0; i < collected.length; i += 500) {
      const batch = collected.slice(i, i + 500);
      try {
        const res = await candidates.insertMany(batch, { ordered: false });
        inserted += res.insertedCount;
      } catch (err) {
        // Duplicate item_id against a still-live previous pool is expected and fine.
        inserted += err?.result?.nInserted ?? err?.insertedCount ?? 0;
        const dupes = (err?.writeErrors ?? []).filter(e => e.code === 11000).length;
        const other = (err?.writeErrors ?? []).filter(e => e.code !== 11000);
        if (other.length) console.warn(`[${queue}] ${other.length} non-duplicate write errors, first:`, other[0]?.errmsg);
        if (dupes) console.log(`[${queue}] ${dupes} already in pool, kept`);
      }
    }

    const retired = await candidates.deleteMany({ queue, build_id: { $ne: BUILD_ID } });
    const total = await candidates.countDocuments({ queue });
    console.log(`[${queue}] inserted ${inserted}, retired ${retired.deletedCount} from prior builds, pool now ${total}`);
  }

  await client.close();
  console.log('[build] done');
}

main().catch(err => {
  console.error('[build] failed:', err);
  process.exit(1);
});
