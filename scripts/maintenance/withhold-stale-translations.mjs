#!/usr/bin/env node
/**
 * PRIOR ART: `withdraw-fabricated-translation-4584.mjs` (hand-listed pages,
 * surgical `<lacuna>` replacement of invented SPANS) and
 * `quarantine-fabricated-ocr.mjs` (#4149, snapshot-then-`$unset` of a whole
 * field). Neither fits: the first is span-level on a translation that is mostly
 * right and needs a human-verified target list, the second removes text that
 * has no correct version. Here the whole page's English derives from a
 * transcription that was replaced, the set is 65k pages and GROWS with every
 * apply pass, so it has to be a re-derived predicate rather than a list. The
 * rule and the field move live in `scripts/lib/stale-translation.mjs`; read its
 * header first.
 *
 * Takes stale translations out of service (#4523).
 *
 * For each page where `staleTranslationReason()` holds:
 *   1. Snapshot `translation` to `page_revisions` under
 *      `withhold-stale-translation-4523`. Nothing is destroyed, and the
 *      withheld corpus stays countable — it is a labelled record of what the
 *      old model invented, which has research value of its own.
 *   2. Move `translation` → `translation_withheld` (text, model and dates
 *      intact, plus `reason` and `withheld_at`) and unset `translation`.
 *   3. Resync the book's page counters, because `pages_translated` and the
 *      readable bar are surfaces too.
 *
 * ACTUATION NOTE (CLAUDE.md: writing to a store an automated job reads).
 * Step 2 bumps `pages.updated_at`, and `embed-gemini.mjs --incremental` runs
 * every 4h on Hetzner selecting pages by that timestamp. It will therefore
 * re-embed these pages — correctly: `pageEmbeddingInput` falls back to OCR when
 * there is no translation and writes an EMPTY `translation` column, so the row
 * heals to the new Tibetan transcription and the English never comes back. That
 * work is paid, and it is bounded by the worker's own $5/day spend guard.
 *
 * Resumable: a page whose translation is already withheld no longer matches the
 * predicate, so re-running is a no-op over completed work. Progress is written
 * per book to the report file as it goes; interrupt and re-run freely.
 *
 * Default is DRY RUN. Run it on Hetzner (Atlas round-trips from a laptop make
 * this hours instead of minutes).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/withhold-stale-translations.mjs
 *   node --env-file=.env.production.local scripts/maintenance/withhold-stale-translations.mjs --apply
 *   … --book=<id>        one book only
 *   … --books-file=PATH   newline-separated book ids
 *   … --limit=N           stop after N books (dry-run sizing)
 *   … --report=PATH
 *   … --skip-supabase-mirror   don't re-sync the Supabase `pages` mirror per book
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import {
  STALE_CANDIDATE_FILTER, WITHHOLD_REVISION_SOURCE,
  staleTranslationReason, withholdUpdate, translationText,
} from '../lib/stale-translation.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const ONLY_BOOK = ARG('--book', null);
const BOOKS_FILE = ARG('--books-file', null);
const LIMIT = Number(ARG('--limit', '0')) || 0;
const REPORT = ARG('--report', `scripts/output/withhold-stale-translations-${new Date().toISOString().slice(0, 10)}.jsonl`);
const SKIP_MIRROR = process.argv.includes('--skip-supabase-mirror');
const BATCH = 250;

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const pages = db.collection('pages');

fs.mkdirSync(REPORT.replace(/\/[^/]+$/, ''), { recursive: true });
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

/**
 * Which books to walk. Never a frozen id list committed to the repo — either
 * the caller names one book, or we ask the database which books currently hold
 * a candidate page. The set grows with every apply pass; asking is the only way
 * to keep up with it.
 */
let bookIds;
if (ONLY_BOOK) {
  bookIds = [ONLY_BOOK];
} else if (BOOKS_FILE) {
  bookIds = fs.readFileSync(BOOKS_FILE, 'utf8').trim().split('\n').map((s) => s.trim()).filter(Boolean);
} else {
  process.stdout.write('finding candidate books … ');
  bookIds = await pages.distinct('book_id', STALE_CANDIDATE_FILTER);
  console.log(`${bookIds.length}`);
}
if (LIMIT) bookIds = bookIds.slice(0, LIMIT);

const T = {
  books: 0, booksChanged: 0, candidates: 0, stale: 0, withheld: 0,
  revisions: 0, chars: 0, byReason: {}, countersResynced: 0, mirrorSynced: 0, aborted: 0,
};

for (const bookId of bookIds) {
  T.books++;
  const candidates = await pages.find(
    { book_id: bookId, ...STALE_CANDIDATE_FILTER },
    { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1, translation_withheld: 1 } },
  ).toArray();
  T.candidates += candidates.length;

  const targets = [];
  for (const p of candidates) {
    const reason = staleTranslationReason(p);
    if (!reason) continue;
    targets.push({ page: p, reason });
  }
  if (!targets.length) continue;

  T.stale += targets.length;
  for (const { reason } of targets) T.byReason[reason] = (T.byReason[reason] || 0) + 1;
  const chars = targets.reduce((n, t) => n + translationText(t.page.translation).length, 0);
  T.chars += chars;

  if (!APPLY) {
    rec({ book: bookId, status: 'dry-run', stale: targets.length, chars });
    continue;
  }

  // Snapshot FIRST, in batches, and refuse the book if the snapshot is short.
  // A withhold that loses its revision row is the one thing here that is not
  // reversible, so a mismatch stops this book rather than trading text for
  // throughput. (Pages whose translation is a marker string are skipped by
  // saveRevisionsBeforeOverwrite by design — those are counted and excluded
  // from the expectation below.)
  const revisionable = targets.filter((t) => translationText(t.page.translation).length > 0);
  let saved = 0;
  for (let i = 0; i < revisionable.length; i += BATCH) {
    const slice = revisionable.slice(i, i + BATCH).map((t) => t.page.id);
    saved += await saveRevisionsBeforeOverwrite(db, slice, 'translation', { reason: WITHHOLD_REVISION_SOURCE });
  }
  if (saved !== revisionable.length) {
    T.aborted++;
    rec({ book: bookId, status: 'ABORT-revision-mismatch', want: revisionable.length, got: saved });
    console.error(`ABORT ${bookId}: revisions ${saved} != ${revisionable.length} — nothing withheld for this book`);
    continue;
  }
  T.revisions += saved;

  const now = new Date();
  for (let i = 0; i < targets.length; i += BATCH) {
    const ops = [];
    for (const { page, reason } of targets.slice(i, i + BATCH)) {
      const update = withholdUpdate(page, reason, now);
      if (!update) continue;
      // Pin the write to the state we judged: if another writer retranslated
      // this page since we read it, the filter misses and we leave it alone
      // rather than withhold a translation that is now fresh.
      // Two shapes: the object and the legacy bare string. Pin on whichever
      // this page actually has — `'translation.data': undefined` on a
      // string-shaped page matches nothing, and the write would silently skip.
      const pin = typeof page.translation === 'string'
        ? { translation: page.translation }
        : { 'translation.data': page.translation.data };
      ops.push({ updateOne: { filter: { id: page.id, ...pin }, update } });
    }
    if (!ops.length) continue;
    const res = await pages.bulkWrite(ops, { ordered: false });
    T.withheld += res.modifiedCount;
    if (res.modifiedCount !== ops.length) {
      rec({ book: bookId, status: 'partial-batch', wanted: ops.length, modified: res.modifiedCount });
    }
  }

  // pages_translated feeds the card count and the readable bar, so it is a
  // surface. Same pipeline `recount-page-stats.mjs` uses — one definition of
  // the counters, not a second one that can disagree with it.
  try {
    const [counts] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
    if (counts) {
      await db.collection('books').updateOne({ id: bookId }, {
        $set: {
          pages_count: counts.total,
          pages_ocr: counts.with_ocr,
          pages_translated: counts.with_translation,
          pages_translatable: counts.translatable,
          updated_at: new Date(),
        },
      });
      T.countersResynced++;
    }
  } catch (e) {
    rec({ book: bookId, status: 'counter-resync-failed', error: e.message?.slice(0, 120) });
  }

  // The Supabase `pages` mirror holds its own copy of the text in
  // `translation_data`, and its 5-minute sync worker selects by
  // `translation.updated_at` — a field this write REMOVES. So the mirror would
  // keep the withheld English indefinitely, and nothing would report it. Re-sync
  // the book explicitly, through the worker that owns the row shape rather than
  // a second flattener that can drift from it.
  if (!SKIP_MIRROR) {
    try {
      execFileSync(process.execPath, ['scripts/workers/sync-pages-content.mjs', `--book=${bookId}`], {
        stdio: 'pipe', timeout: 300000, env: process.env,
      });
      T.mirrorSynced++;
    } catch (e) {
      rec({ book: bookId, status: 'supabase-pages-mirror-sync-failed', error: String(e.message).slice(0, 160) });
    }
  }

  T.booksChanged++;
  rec({ book: bookId, status: 'applied', stale: targets.length, chars });
  if (T.booksChanged % 10 === 0) console.log(`  ${T.booksChanged} books, ${T.withheld} pages withheld`);
}

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...T }, null, 2));
rec({ status: 'run-summary', mode: APPLY ? 'apply' : 'dry-run', ...T });
report.end();
await mongo.close();
