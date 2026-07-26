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
import {
  buildPageTexts,
  attributeEntityPages,
  entityCounters,
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

const stats = {
  booksScanned: 0,
  booksWithNoPages: 0,
  entityEntriesExamined: 0,
  entriesNowPagePrecision: 0,
  entriesNowSection: 0,
  entriesUnchanged: 0,
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

const bookFilter = ONLY_BOOK
  ? { id: ONLY_BOOK }
  : { index: { $exists: true }, ...(RESUME_FROM ? { id: { $gt: RESUME_FROM } } : {}) };

const bookCursor = db.collection('books')
  .find(bookFilter, { projection: { id: 1, title: 1, display_title: 1 } })
  .sort({ id: 1 });

let processed = 0;
for await (const book of bookCursor) {
  if (LIMIT && processed >= LIMIT) break;
  processed++;
  stats.booksScanned++;

  // Every entity that claims this book. If none, there is nothing to repair.
  const entities = await db.collection('entities')
    .find({ 'books.book_id': book.id }, { projection: { name: 1, type: 1, books: 1 } })
    .toArray();
  if (entities.length === 0) continue;

  const pages = await db.collection('pages')
    .find({ book_id: book.id }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .toArray();

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

    // Candidate window = the union of pages the old entry claimed, which is the
    // batch range Gemini actually read. Staying inside it means we never invent
    // a location in a section the model never saw. Fall back to the whole book
    // only when the claim is empty (nothing to narrow from).
    const claimed = [...new Set(ownEntries.flatMap(e => e.pages || []))].sort((a, b) => a - b);
    stats.pagesClaimedBefore += claimed.length;

    const candidates = claimed.length > 0
      ? claimed.map(n => pageTextsByNumber.get(n)).filter(Boolean)
      : pageTexts;

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
        ...(claimed.length > 0
          ? { page_range: { start: claimed[0], end: claimed[claimed.length - 1] } }
          : {}),
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
    // Ordered: each entity's $pull must land before its $push.
    await db.collection('entities').bulkWrite(ops, { ordered: true });
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
 * per book and flushed as a single bulkWrite — three round trips per entity
 * (pull, push, recount) put the full 19.6K-book sweep in the multi-day range.
 *
 * Uses $pull + $push rather than $set-ing the whole `books` array, so a
 * concurrent writer touching a DIFFERENT book on the same entity isn't
 * clobbered. Counters are computed from the known post-state, which is exact
 * while the enrich pipeline is paused and self-corrects on the next re-run
 * otherwise.
 */
function queueEntry(ops, entity, bookId, repaired) {
  stats.entitiesTouched.add(entity._id.toString());
  if (DRY_RUN) return;

  const postState = [
    ...(entity.books || []).filter(b => b.book_id !== bookId),
    repaired,
  ];

  ops.push({
    updateOne: {
      filter: { _id: entity._id },
      update: { $pull: { books: { book_id: bookId } } },
    },
  });
  ops.push({
    updateOne: {
      filter: { _id: entity._id },
      update: {
        $push: { books: repaired },
        $set: { ...entityCounters(postState), updated_at: new Date() },
      },
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
if (!DRY_RUN) console.log(`progress log: ${PROGRESS_FILE}`);

await client.close();
