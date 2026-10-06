/**
 * Smart Cover Selection — batch re-evaluation with the book-level cover policy
 * (scripts/lib/cover-choice.mjs). OCR + gallery based, no API calls.
 *
 * Policy, in order: illustration-led titles wear their best plate; otherwise the
 * best opening page (decorated cover, title page, frontispiece); then a
 * representative plate; then the first non-junk page. Hand-picked covers
 * (thumbnail_source manual*) are NEVER touched.
 *
 * Default scope: books whose CURRENT cover is junk (blank, binding snapshot,
 * scanner insert, bookplate, hand in frame, bleed-through) or merely weak (scores
 * under the confident threshold, e.g. a stray text leaf), plus illustration-led
 * titles that are not wearing a plate. A weak-but-not-junk cover is only replaced
 * by a CONFIDENT pick, never by another ordinary page. `--force` re-evaluates
 * every book.
 *
 * Cost: FREE
 *
 * Usage (node --env-file=.env.production.local …):
 *   --dry-run            Preview only
 *   --plan-out FILE      Write proposed changes as JSON (implies --dry-run)
 *   --apply-plan FILE    Apply exactly the entries in FILE (e.g. a reviewed plan);
 *                        each entry re-checks the book is not manual and that its
 *                        cover is unchanged since the plan was written
 *   --limit N            Stop after N proposed changes
 *   --book-id ID         Single book
 *   --collection SLUG    Books in a collection
 *   --provider NAME      image_source.provider filter
 *   --force              Re-evaluate all books, not just junk covers
 *
 * After a live run: sync the catalogue mirror (scripts/workers/sync-books-catalog.mjs)
 * and revalidate the affected book pages, or the cards keep the old cover.
 */

import fs from 'fs';
import { MongoClient } from 'mongodb';
import { buildCoverUpdate } from '../lib/cover-write.mjs';
import { scorePageForCover } from '../lib/cover-scoring.mjs';
import {
  chooseCover, isManualCover, isJunkCover, isIllustratedTitle,
  COVER_WINDOW, MIN_PLATE_QUALITY, CONFIDENT_SCORE,
} from '../lib/cover-choice.mjs';

const argv = process.argv;
const arg = name => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; };
const PLAN_OUT = arg('--plan-out');
const APPLY_PLAN = arg('--apply-plan');
const DRY_RUN = argv.includes('--dry-run') || !!PLAN_OUT;
const FORCE = argv.includes('--force');
const LIMIT = arg('--limit') ? parseInt(arg('--limit')) : 0;
const BOOK_ID = arg('--book-id');
const PROVIDER = arg('--provider');
const COLLECTION = arg('--collection');
const BATCH_SIZE = 50;

const PAGE_PROJECTION = {
  _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, hidden: 1, 'ocr.data': 1,
  photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1,
  crop: 1, enhanced_photo: 1, image_thumb: 1, thumbnail_blob: 1,
};

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 120000,
});
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

/** Retry a read a few times across transient network drops. */
async function withRetry(fn, attempts = 4) {
  for (let a = 1; ; a++) {
    try { return await fn(); } catch (err) {
      if (a >= attempts) throw err;
      console.warn(`\n  read failed (${err.name}), retrying in ${5 * a}s`);
      await new Promise(r => setTimeout(r, 5000 * a));
    }
  }
}

/** Write the cover. Flattens provenance so other field_provenance keys survive. */
async function writeCover(bookId, page, choice) {
  const update = buildCoverUpdate(page, {
    source: 'smart_ocr',
    method: 'cover-choice',
    actor: 'script',
    confidence: choice.rule === 'first-ordinary-page' ? 0.5 : 0.85,
    detail: `${choice.rule}: ${choice.reason} (score ${choice.score})`,
  });
  if (!update) return false;
  const { field_provenance, ...fields } = update;
  if (field_provenance?.thumbnail) fields['field_provenance.thumbnail'] = field_provenance.thumbnail;
  // updated_at lets sync-books-catalog's incremental mode pick the book up.
  await db.collection('books').updateOne({ id: bookId }, { $set: { ...fields, updated_at: new Date() } });
  return true;
}

// ── Apply a reviewed plan ────────────────────────────────────────────────────
if (APPLY_PLAN) {
  const plan = JSON.parse(fs.readFileSync(APPLY_PLAN, 'utf8'));
  let applied = 0, skipped = 0;
  for (const entry of plan) {
    const book = await db.collection('books').findOne(
      { id: entry.bookId },
      { projection: { id: 1, thumbnail_source: 1, cover_page: 1 } },
    );
    // Re-check at apply time: someone may have hand-picked or changed it since.
    if (!book || isManualCover(book) || book.cover_page !== entry.fromPage) { skipped++; continue; }
    const page = await db.collection('pages').findOne(
      { book_id: entry.bookId, page_number: entry.toPage }, { projection: PAGE_PROJECTION },
    );
    if (!page) { skipped++; continue; }
    if (DRY_RUN) { applied++; continue; }
    if (await writeCover(entry.bookId, page, entry)) applied++; else skipped++;
  }
  console.log(`${DRY_RUN ? 'Would apply' : 'Applied'}: ${applied}, skipped (changed since plan / manual / missing): ${skipped}`);
  await client.close();
  process.exit(0);
}

// ── Evaluate ────────────────────────────────────────────────────────────────
const bookQuery = BOOK_ID ? { id: BOOK_ID } : { pages_count: { $gt: 0 }, visible: true };
if (!BOOK_ID && PROVIDER) bookQuery['image_source.provider'] = PROVIDER;
if (!BOOK_ID && COLLECTION) bookQuery.collections = COLLECTION;

const allBooks = (await db.collection('books')
  .find(bookQuery, { projection: { _id: 0, id: 1, title: 1, display_title: 1, thumbnail_source: 1, cover_page: 1 } })
  .toArray())
  .filter(b => !isManualCover(b));

console.log(`\n=== Smart Cover Selection (cover-choice policy) ===`);
console.log(`Mode: ${APPLY_PLAN ? 'APPLY PLAN' : DRY_RUN ? 'DRY RUN' : 'LIVE'}${FORCE ? ' (force: all books)' : ' (junk covers + unplated illustrated titles)'}`);
console.log(`Books (manual covers excluded): ${allBooks.length}\n`);

const changes = [];
let checked = 0;

outer:
for (let i = 0; i < allBooks.length; i += BATCH_SIZE) {
  const batch = allBooks.slice(i, i + BATCH_SIZE);
  const ids = batch.map(b => b.id);
  // A long sweep outlives the odd dropped connection; retry the batch's reads.
  const [pages, plates] = await withRetry(() => Promise.all([
    db.collection('pages')
      .find({ book_id: { $in: ids }, page_number: { $gt: 0, $lte: COVER_WINDOW } }, { projection: PAGE_PROJECTION })
      .toArray(),
    db.collection('gallery_images')
      .find({ book_id: { $in: ids }, gallery_quality: { $gte: MIN_PLATE_QUALITY } },
        { projection: { _id: 0, book_id: 1, page_number: 1, gallery_quality: 1, type: 1, bbox: 1 } })
      .toArray(),
  ]));
  const pagesBy = new Map(), platesBy = new Map();
  for (const p of pages) (pagesBy.get(p.book_id) || pagesBy.set(p.book_id, []).get(p.book_id)).push(p);
  for (const g of plates) (platesBy.get(g.book_id) || platesBy.set(g.book_id, []).get(g.book_id)).push(g);

  // Plate pages beyond the opening window, fetched once per batch.
  const outside = plates.filter(g => g.page_number > COVER_WINDOW);
  const platePagesBy = new Map();
  if (outside.length) {
    const docs = await withRetry(() => db.collection('pages')
      .find({ $or: outside.map(g => ({ book_id: g.book_id, page_number: g.page_number })) }, { projection: PAGE_PROJECTION })
      .toArray());
    for (const d of docs) (platePagesBy.get(d.book_id) || platePagesBy.set(d.book_id, new Map()).get(d.book_id)).set(d.page_number, d);
  }

  for (const book of batch) {
    const bookPages = (pagesBy.get(book.id) || []).sort((a, b) => a.page_number - b.page_number);
    if (!bookPages.length) continue;
    checked++;
    const bookPlates = platesBy.get(book.id) || [];
    const platePages = platePagesBy.get(book.id) || new Map();
    const current = book.cover_page
      ? bookPages.find(p => p.page_number === book.cover_page) || platePages.get(book.cover_page)
      : null;
    const currentJunk = !current || isJunkCover(current, book);
    const currentWeak = currentJunk || scorePageForCover(current, { bookTitle: book.title }).score < CONFIDENT_SCORE;
    const illustrated = isIllustratedTitle(book);
    const currentIsPlate = !!book.cover_page && bookPlates.some(g => g.page_number === book.cover_page);

    if (!FORCE && !currentWeak && !(illustrated && !currentIsPlate)) continue;

    const choice = chooseCover(book, bookPages, bookPlates, platePages);
    if (!choice || choice.page.page_number === book.cover_page) continue;
    // The last-resort pick only displaces a cover that is itself junk.
    if (choice.rule === 'first-ordinary-page' && !currentJunk) continue;

    const entry = {
      bookId: book.id,
      title: (book.display_title || book.title || '').slice(0, 120),
      fromPage: book.cover_page ?? null,
      fromSource: book.thumbnail_source || null,
      fromJunk: currentJunk,
      fromWeak: currentWeak,
      toPage: choice.page.page_number,
      rule: choice.rule,
      reason: choice.reason,
      score: choice.score,
    };
    changes.push(entry);
    if (!DRY_RUN) await writeCover(book.id, choice.page, choice);
    if (LIMIT && changes.length >= LIMIT) break outer;
  }
  process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allBooks.length / BATCH_SIZE)} — ${changes.length} changes\r`);
  // Checkpoint the plan so a crash late in a long sweep loses nothing.
  if (PLAN_OUT && (i / BATCH_SIZE) % 20 === 0) fs.writeFileSync(PLAN_OUT, JSON.stringify(changes, null, 1));
}

const byRule = {};
for (const c of changes) byRule[c.rule] = (byRule[c.rule] || 0) + 1;
console.log(`\n\n=== Results ===`);
console.log(`Books checked: ${checked}`);
console.log(`${DRY_RUN ? 'Would change' : 'Changed'}: ${changes.length}  ${JSON.stringify(byRule)}`);
if (PLAN_OUT) {
  fs.writeFileSync(PLAN_OUT, JSON.stringify(changes, null, 1));
  console.log(`Plan written: ${PLAN_OUT}`);
}
for (const c of changes.slice(0, BOOK_ID ? 1 : 30)) {
  console.log(`  ${c.title.slice(0, 55).padEnd(56)} p${c.fromPage} → p${c.toPage}  ${c.rule} (${c.reason})`);
}
await client.close();
