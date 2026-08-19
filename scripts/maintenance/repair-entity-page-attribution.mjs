#!/usr/bin/env node
/**
 * Repair fabricated entity page citations (#3361).
 *
 * The index extractor credited every page in a ~50k-char batch range with every
 * entity found anywhere in that batch, and `/encyclopedia/[name]` rendered those
 * inferred numbers as exact `p. N` citations. Measured on live data, only
 * ~14-22% of claimed pages actually contained the entity name.
 *
 * This sweep re-derives `entities.books[].pages` from the page text that is
 * already stored — no Gemini calls, no cost. For each book it loads the page
 * text once, then for every entity referencing that book keeps only the pages
 * that actually name the entity. Where nothing matches, the entry drops to
 * section precision (`pages: []` + `page_range`) instead of guessing.
 *
 * It also fixes two things that travelled with the same writer:
 *   - duplicate `books[]` entries for one book (the writer `$addToSet`-ed whole
 *     subdocuments, so re-runs appended instead of replacing)
 *   - `book_count` / `total_mentions` computed from those duplicates and smeared
 *     page arrays (one entity advertised "10,700 total mentions")
 *
 * RE-RUNNABLE BY DESIGN. Page numbering changes under us: a book re-split after
 * indexing doubles its `page_number`s, so an entry correct today can be stale
 * tomorrow. Nothing here depends on a previous run's state — it always recomputes
 * from current page text — so re-running after a split sweep is the fix.
 *
 * SCOPE LIMIT — this removes fabrications, it does not build a complete
 * concordance. Verification happens only within the pages the old entry already
 * claimed (the batch range Gemini actually read), so a real mention elsewhere in
 * the book stays unlisted: Matthiolus is named on pp. 44 and 100 of "Raphael
 * Explaining the Art of Medicine" and this sweep restores p. 44 alone. Two
 * reasons to keep it narrow. It stays inside the section a model actually
 * assessed, so the model's judgment about WHICH "Paul" or "Faber" is meant still
 * counts for something — a whole-book string sweep would replace that with bare
 * lexical matching and cheerfully merge homonyms. And missing a page is a
 * recall gap, whereas asserting one is a false citation; only the latter is a
 * correctness bug. Building the fuller index is separate work.
 *
 * Usage:
 *   node scripts/maintenance/repair-entity-page-attribution.mjs --dry-run
 *   node scripts/maintenance/repair-entity-page-attribution.mjs --apply
 *   node scripts/maintenance/repair-entity-page-attribution.mjs --apply --book-id <id>
 *   node scripts/maintenance/repair-entity-page-attribution.mjs --apply --limit 500
 *   node scripts/maintenance/repair-entity-page-attribution.mjs --apply --resume-from <bookId>
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { beat, endSweep } from '../lib/sweep-heartbeat.mjs';
import {
  buildPageTexts,
  attributeEntityPages,
} from '../lib/entity-page-match.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const ONLY_BOOK = getArg('--book-id');
const LIMIT = Number(getArg('--limit') || 0);
const RESUME_FROM = getArg('--resume-from');
const PROGRESS_FILE = getArg('--progress-file')
  || 'scripts/output/repair-entity-page-attribution-progress.jsonl';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a; node ...');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

/**
 * Retry a Mongo op through transient network faults. A multi-hour sweep against
 * Atlas will hit `read ECONNRESET` sooner or later — the first full run died on
 * one after 250 books, losing nothing but needing a manual resume. Only retries
 * transient transport errors; a genuine write error still throws.
 */
async function withRetry(label, fn, attempts = 10) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      // Includes DNS failures: a laptop that sleeps mid-run wakes to
      // `getaddrinfo ENOTFOUND <shard>.mongodb.net`, which killed the overnight
      // pass at 08:50 even though the connection recovered moments later.
      const transient = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|connection .* closed|MongoNetworkError|ServerSelection|topology|not primary|PoolClearedError/i.test(msg);
      if (!transient || i === attempts - 1) throw err;
      // Cap the backoff so ten attempts span ~8 minutes of outage tolerance —
      // enough to ride out a sleep/wake or a WiFi handover, not so long that a
      // genuinely dead connection stalls the run for an hour.
      const backoffMs = Math.min(60_000, 1000 * 2 ** i);
      console.warn(`  transient error on ${label} (attempt ${i + 1}/${attempts}): ${msg.slice(0, 120)} — retrying in ${backoffMs}ms`);
      stats.transientRetries++;
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

const stats = {
  transientRetries: 0,
  booksScanned: 0,
  booksWithNoPages: 0,
  entityEntriesExamined: 0,
  entriesNowPagePrecision: 0,
  entriesNowSection: 0,
  entriesUnchanged: 0,
  entriesNoWindow: 0,
  duplicateEntriesCollapsed: 0,
  pagesClaimedBefore: 0,
  pagesClaimedAfter: 0,
  entitiesTouched: new Set(),
};

// Append-only progress log, so a killed run can resume without redoing work and
// a stray `git reset` in a worktree can't silently erase what was done.
fs.mkdirSync(PROGRESS_FILE.replace(/\/[^/]+$/, ''), { recursive: true });
const logProgress = (row) => {
  if (DRY_RUN) return;
  fs.appendFileSync(PROGRESS_FILE, JSON.stringify(row) + '\n');
};

/**
 * Book iteration is KEYSET PAGINATION, not a cursor.
 *
 * A single `find().sort({id:1})` cursor over 19.6K books dies mid-sweep with
 * `CursorNotFound` (code 43): each fetched batch takes far longer than Mongo's
 * 10-minute cursor idle timeout to process (~3s per book × a batch of hundreds),
 * so the server reaps it while we're still working through the batch. Killing the
 * run after ~1,900 books. `noCursorTimeout` would paper over it by leaking a
 * server-side cursor for hours; fetching one page of ids at a time removes the
 * long-lived cursor entirely and reuses the same `id > last` ordering that
 * `--resume-from` already relies on.
 */
const BOOK_PAGE_SIZE = Number(getArg('--page-size') || 200);

async function* iterateBooks() {
  if (ONLY_BOOK) {
    const one = await db.collection('books').findOne(
      { id: ONLY_BOOK },
      { projection: { id: 1, title: 1, display_title: 1 } }
    );
    if (one) yield one;
    return;
  }

  let after = RESUME_FROM || null;
  for (;;) {
    const page = await withRetry(`page of books after ${after ?? 'start'}`, () =>
      db.collection('books')
        .find(
          { index: { $exists: true }, ...(after ? { id: { $gt: after } } : {}) },
          { projection: { id: 1, title: 1, display_title: 1 } }
        )
        .sort({ id: 1 })
        .limit(BOOK_PAGE_SIZE)
        .toArray()
    );
    if (page.length === 0) return;
    for (const b of page) yield b;
    after = page[page.length - 1].id;
  }
}

// Announce ourselves so the pre-merge interlock can see this run from any
// machine without ssh. See scripts/lib/sweep-heartbeat.mjs for why.
const SWEEP_NAME = 'repair-entity-page-attribution';
if (!DRY_RUN) await beat(db, SWEEP_NAME, { books_done: 0 }, { force: true });

let processed = 0;
for await (const book of iterateBooks()) {
  if (LIMIT && processed >= LIMIT) break;
  processed++;
  stats.booksScanned++;
  if (!DRY_RUN) await beat(db, SWEEP_NAME, { books_done: stats.booksScanned });

  // Every entity that claims this book. If none, there is nothing to repair.
  //
  // Project ONLY this book's entries via $filter, never the whole `books` array.
  // A popular book is referenced by ~900 entities, and a common concept carries
  // hundreds of book entries, so `projection: { books: 1 }` ships megabytes per
  // book and pins the sweep at 0.3% CPU waiting on the wire — measured at under
  // one book per minute before this change.
  const entities = await withRetry(`read entities for ${book.id}`, () => db.collection('entities').aggregate([
    { $match: { 'books.book_id': book.id } },
    {
      $project: {
        name: 1,
        type: 1,
        books: {
          $filter: {
            input: { $ifNull: ['$books', []] },
            cond: { $eq: ['$$this.book_id', book.id] },
          },
        },
      },
    },
  ]).toArray());
  if (entities.length === 0) continue;

  const pages = await withRetry(`read pages for ${book.id}`, () => db.collection('pages')
    .find({ book_id: book.id }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .toArray());

  if (pages.length === 0) {
    stats.booksWithNoPages++;
    // No text to verify against. Leave the entries alone rather than deleting
    // evidence — a book can be mid-reprocess. Read path already demotes
    // unmarked entries to section precision.
    continue;
  }

  const pageTexts = buildPageTexts(pages);
  const pageTextsByNumber = new Map(pageTexts.map(p => [p.page_number, p]));
  const ops = [];

  for (const entity of entities) {
    const ownEntries = (entity.books || []).filter(b => b.book_id === book.id);
    if (ownEntries.length === 0) continue;
    if (ownEntries.length > 1) stats.duplicateEntriesCollapsed += ownEntries.length - 1;
    stats.entityEntriesExamined++;

    // Candidate window = the pages this entry already points at, which is the
    // batch range Gemini actually read. Staying inside it means we never invent
    // a location in a section the model never saw.
    //
    // A section-precision entry has an EMPTY `pages` array, so its window has to
    // come from `page_range`. Falling back to the whole book here is what made
    // the first version non-idempotent: on a second pass, every section entry
    // got re-scanned across all pages and converted back to page precision with
    // matches the model never saw — a re-run that ADDED 8% more citations. If
    // there is no window at all, leave the entry alone.
    const claimed = [...new Set(ownEntries.flatMap(e => e.pages || []))].sort((a, b) => a - b);
    stats.pagesClaimedBefore += claimed.length;

    let window = claimed;
    if (window.length === 0) {
      const ranges = ownEntries.map(e => e.page_range).filter(Boolean);
      if (ranges.length > 0) {
        const start = Math.min(...ranges.map(r => r.start));
        const end = Math.max(...ranges.map(r => r.end));
        window = [];
        for (let n = start; n <= end; n++) window.push(n);
      }
    }

    if (window.length === 0) {
      // Nothing claimed and no range — no evidence to re-verify against.
      stats.entriesNoWindow++;
      stats.entriesUnchanged++;
      continue;
    }

    const candidates = window.map(n => pageTextsByNumber.get(n)).filter(Boolean);

    // If the claimed pages no longer exist (book re-split/renumbered), we cannot
    // verify anything — mark section over the claimed span and move on.
    if (candidates.length === 0) {
      stats.entriesNowSection++;
      const base = ownEntries[0];
      const repaired = {
        book_id: book.id,
        book_title: base.book_title,
        book_author: base.book_author,
        ...(base.book_year ? { book_year: base.book_year } : {}),
        pages: [],
        page_precision: 'section',
        // Keep the span from the window (claimed pages, or an existing
        // page_range) so a re-run still has something to narrow from.
        page_range: { start: window[0], end: window[window.length - 1] },
      };
      queueEntry(ops, entity, book.id, repaired);
      continue;
    }

    const attribution = attributeEntityPages(entity.name, candidates);
    const base = ownEntries[0];
    const repaired = {
      book_id: book.id,
      book_title: base.book_title,
      book_author: base.book_author,
      ...(base.book_year ? { book_year: base.book_year } : {}),
      pages: attribution.pages,
      page_precision: attribution.page_precision,
      ...(attribution.page_range ? { page_range: attribution.page_range } : {}),
    };

    stats.pagesClaimedAfter += repaired.pages.length;
    if (repaired.page_precision === 'page') stats.entriesNowPagePrecision++;
    else stats.entriesNowSection++;

    const sameShape =
      ownEntries.length === 1 &&
      base.page_precision === repaired.page_precision &&
      JSON.stringify(base.pages || []) === JSON.stringify(repaired.pages);
    if (sameShape) {
      stats.entriesUnchanged++;
      continue;
    }

    queueEntry(ops, entity, book.id, repaired);
  }

  if (ops.length > 0) {
    // One self-contained op per entity, so order doesn't matter and the server
    // is free to parallelize. Each op is idempotent, so a retry after a partial
    // failure re-applies safely.
    await withRetry(`bulkWrite for ${book.id}`, () =>
      db.collection('entities').bulkWrite(ops, { ordered: false })
    );
  }

  logProgress({ book_id: book.id, entities: entities.length, ops: ops.length, at: new Date().toISOString() });

  if (stats.booksScanned % 250 === 0) {
    console.log(
      `[${stats.booksScanned} books] entries: ${stats.entityEntriesExamined} ` +
      `| page-precision ${stats.entriesNowPagePrecision} | section ${stats.entriesNowSection} ` +
      `| page claims ${stats.pagesClaimedBefore} → ${stats.pagesClaimedAfter}`
    );
  }
}

/**
 * Queue the replacement of one entity's entry for one book. Ops are collected
 * per book and flushed as a single bulkWrite.
 *
 * Expressed as an aggregation-pipeline update so the whole operation runs
 * server-side and the `books` array never crosses the wire in either direction:
 * drop every entry for this book (collapsing duplicates), append the repaired
 * one, then recount from the result. Shipping the array back to recompute
 * counters in JS is what made the first attempt I/O-bound.
 *
 * Rebuilding `books` in one pipeline also means a concurrent writer touching a
 * DIFFERENT book on the same entity is preserved — $filter keeps every entry
 * whose book_id isn't ours, whatever it looks like.
 */
function queueEntry(ops, entity, bookId, repaired) {
  stats.entitiesTouched.add(entity._id.toString());
  if (DRY_RUN) return;

  ops.push({
    updateOne: {
      filter: { _id: entity._id },
      update: [
        {
          $set: {
            books: {
              $concatArrays: [
                {
                  $filter: {
                    input: { $ifNull: ['$books', []] },
                    cond: { $ne: ['$$this.book_id', bookId] },
                  },
                },
                [repaired],
              ],
            },
          },
        },
        {
          $set: {
            // Mirrors entityCounters() in scripts/lib/entity-page-match.mjs:
            // distinct books (one entry each after the rebuild above) and
            // VERIFIED page references only.
            book_count: { $size: '$books' },
            total_mentions: {
              $sum: {
                $map: {
                  input: '$books',
                  in: { $size: { $ifNull: ['$$this.pages', []] } },
                },
              },
            },
            updated_at: new Date(),
          },
        },
      ],
    },
  });
}

console.log('\n=== repair-entity-page-attribution ===');
console.log(DRY_RUN ? 'MODE: dry run (no writes)' : 'MODE: APPLIED');
console.log(`books scanned:               ${stats.booksScanned}`);
console.log(`books with no page text:     ${stats.booksWithNoPages}`);
console.log(`entity-book entries:         ${stats.entityEntriesExamined}`);
console.log(`  → page precision:          ${stats.entriesNowPagePrecision}`);
console.log(`  → section precision:       ${stats.entriesNowSection}`);
console.log(`  → unchanged:               ${stats.entriesUnchanged}`);
console.log(`duplicate entries collapsed: ${stats.duplicateEntriesCollapsed}`);
console.log(`page citations claimed:      ${stats.pagesClaimedBefore} → ${stats.pagesClaimedAfter}`);
const removed = stats.pagesClaimedBefore - stats.pagesClaimedAfter;
if (stats.pagesClaimedBefore > 0) {
  console.log(`unverifiable citations dropped: ${removed} (${(100 * removed / stats.pagesClaimedBefore).toFixed(1)}%)`);
}
console.log(`distinct entities touched:   ${stats.entitiesTouched.size}`);
console.log(`transient errors retried:    ${stats.transientRetries}`);
if (!DRY_RUN) console.log(`progress log: ${PROGRESS_FILE}`);

// Clear the heartbeat so the interlock unblocks immediately rather than waiting
// out STALE_AFTER_MS. If the run dies before here, the heartbeat simply ages
// out — which reads as "active" for a few minutes, i.e. it fails toward holding
// a merge rather than toward a bad one.
if (!DRY_RUN) await endSweep(db, SWEEP_NAME);

await client.close();
