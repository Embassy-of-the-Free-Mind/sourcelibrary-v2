#!/usr/bin/env node
// PRIOR ART: scripts/split-book.mjs Step 6–7 (archive the spreads, write split_into, withdraw their vectors, recount,
// set the split flags): the same writes, but there they happen the moment the leaves exist, before any leaf has text or
// English (#7605 gate). scripts/maintenance/split-spreads-agy.mjs apply checks a split after the fact; it does not
// wait for the leaves to be read. Nothing wrote shortlink redirects; /q resolved every code by page number alone.
/**
 * SWAP a book's staged split leaves in (#7605, build then swap; Derek 2026-10-30).
 *
 *   node --env-file=.env.production.local scripts/maintenance/split-swap.mjs <book_id> [--codes-file=F] [--apply]
 *
 * Dry run unless --apply. Refuses (scripts/lib/split-stage.mjs swapRefusal) unless the staged run covers exactly the
 * book's live pages, no spread was re-read since the stage, and every leaf has OCR and, where it has anything to
 * translate, English. Then, in one transaction:
 *   - each spread is archived as split-book.mjs archives it (page_number -(n+1), page_type archived-spread, hidden) and
 *     names its leaves in split_into, so /book/<id>/page/<spreadId> redirects to its first leaf (#5842);
 *   - each leaf takes its number (page_number = staged_split.leaf) and loses `hidden`.
 * After it: the spreads' search vectors are withdrawn, the book's rows in Supabase `pages` are re-synced (the
 * incremental sync keys on ocr/translation timestamps, which a renumbering does not move), the book is recounted and
 * its split flags set, and every KNOWN
 * shortlink to an old page number gets a `shortlink_redirects` row ({ code, book_id, page_number, page_id }) sending it
 * to that spread's first leaf. Known = seen in analytics_events (shortlink_visit) or listed in --codes-file (codes
 * found in the repo's own pages and articles). A code is the book and the page number and nothing else, so a NEW
 * shortlink to leaf N of the same book has the same code as the old one to spread N: the redirect sends it to the old
 * spread's leaf. That is the trade Derek took; only known codes get a row.
 * Leaves a book_events row and a sweep_log row with readable and translated pages before and after.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { swapRefusal, stagedLeavesQuery, splitIntoByFrame, firstLeafByOldNumber, leafNumberOf, carriedTranslation } from '../lib/split-stage.mjs';
import { isTranslatablePage } from '../lib/translate-core.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { withdrawPageVectors } from '../lib/withdraw-page-vectors.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { decodeShortlinkCode } from '../lib/shortlink-code.mjs';
import { revalidatePaths } from '../lib/revalidate.mjs';

const args = process.argv.slice(2);
const bookId = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const codesFile = args.find((a) => a.startsWith('--codes-file='))?.split('=').slice(1).join('=');
if (!bookId) { console.error('usage: split-swap.mjs <book_id> [--codes-file=F] [--apply]'); process.exit(2); }

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
try {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, slug: 1, title: 1, cover_page: 1, needs_splitting: 1, split_completed: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1, 'pipeline_auto.hold': 1 } });
  if (!book) throw new Error(`book ${bookId} not found`);
  const frames = await pages.find({ book_id: bookId, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, translation: 1 } }).sort({ page_number: 1 }).toArray();
  const leaves = await pages.find(stagedLeavesQuery(bookId), { projection: { id: 1, page_number: 1, page_type: 1, staged_split: 1, split_side: 1, ocr: 1, translation: 1 } }).toArray();
  // A staged leaf is judged as the page it will be (its swapped-in number), with translate-core's own rule.
  const translatable = (l) => isTranslatablePage({ ...l, page_number: leafNumberOf(l) });
  // A leaf that is its whole frame, with the frame's text, keeps the frame's English (carriedTranslation).
  const frameById = new Map(frames.map((f) => [f.id, f]));
  const carries = leaves.map((l) => [l, carriedTranslation(l, frameById.get(l.staged_split.frame_id))]).filter(([, t]) => t);
  for (const [l, t] of carries) l.translation = t;
  if (carries.length) console.log(`  ${carries.length} whole-frame leaf/leaves keep their frame's English: ${carries.map(([l]) => leafNumberOf(l)).join(', ')}`);
  // A held book is out of every lane until its holder releases it: a containment hold (#7605: recited Qur'an text on
  // 6a20329e…) means the text under these leaves is in question, so they do not go live either.
  const held = book.pipeline_auto?.hold?.reason;
  const why = held ? `book is held (${held}): release it first` : swapRefusal({ frames, leaves, translatable });
  console.log(`${bookId} ${String(book.title).slice(0, 60)}: ${frames.length} live spreads, ${leaves.length} staged leaves`);
  if (why) { console.log(`REFUSED: ${why}`); process.exitCode = 1; }
  else {
    const into = splitIntoByFrame(leaves);
    const firstLeaf = firstLeafByOldNumber(frames, leaves);
    const leafById = new Map(leaves.map((l) => [l.id, l]));
    const sides = [...into.values()].find((ids) => ids.length === 2)?.map((id) => leafById.get(id).split_side);
    const pageOrder = sides?.[0] === 'right' ? 'rtl' : 'ltr';

    // Known shortlinks to this book's old page numbers.
    const codes = new Map();
    for (const e of await db.collection('analytics_events').aggregate([{ $match: { event: 'shortlink_visit', book_id: bookId } }, { $group: { _id: '$code', page_number: { $first: '$page_number' } } }]).toArray()) codes.set(e._id, { page_number: e.page_number, seen: 'analytics' });
    if (codesFile) {
      for (const code of fs.readFileSync(codesFile, 'utf8').split(/\s+/).filter(Boolean)) {
        const d = decodeShortlinkCode(code);
        if (d?.bookId === bookId && !codes.has(code)) codes.set(code, { page_number: d.pageNumber, seen: 'repo' });
      }
    }
    const redirects = [...codes].map(([code, c]) => ({ code, book_id: bookId, page_number: c.page_number, page_id: firstLeaf.get(c.page_number) ?? null, seen: c.seen })).filter((r) => r.page_id);
    console.log(`  ${frames.length} spreads → ${leaves.length} leaves (${pageOrder}); ${redirects.length} known shortlink(s) to redirect${codes.size > redirects.length ? `, ${codes.size - redirects.length} to page numbers past the old last page (left alone)` : ''}`);
    for (const r of redirects) console.log(`    /q/${r.code} (old p.${r.page_number}, ${r.seen}) → leaf ${leafNumberOf(leafById.get(r.page_id))}`);
    const coverPage = book.cover_page != null && firstLeaf.get(book.cover_page) ? leafNumberOf(leafById.get(firstLeaf.get(book.cover_page))) : null;
    if (!APPLY) { console.log('  dry run: nothing written (--apply to swap)'); }
    else {
      const now = new Date();
      const before = { readable: book.pages_ocr ?? null, translated: book.pages_translated ?? null, pages: book.pages_count ?? null };
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const r1 = await pages.updateMany(
            { id: { $in: frames.map((f) => f.id) }, book_id: bookId, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } },
            [{ $set: { page_number: { $subtract: [-1, { $abs: '$page_number' }] }, page_type: 'archived-spread', archived_spread: true, hidden: true, updated_at: now } }],
            { session },
          );
          if (r1.modifiedCount !== frames.length) throw new Error(`archived ${r1.modifiedCount}/${frames.length} spreads: aborting the swap`);
          await pages.bulkWrite([...into].map(([id, ids]) => ({ updateOne: { filter: { id, book_id: bookId, page_type: 'archived-spread' }, update: { $set: { split_into: ids } } } })), { session });
          const carried = new Map(carries.map(([l, t]) => [l.id, t]));
          const r2 = await pages.bulkWrite(leaves.map((l) => ({ updateOne: {
            filter: { id: l.id, book_id: bookId, page_number: l.page_number },
            // translation.updated_at = the moment this English reached a live page. Three readers key on it: the stale
            // sweep (OCR newer than English = stale; a carried translation is older than the cut OCR under it), and the
            // keyword and embedding deltas, which skipped the leaf while it sat below zero.
            update: { $set: { page_number: leafNumberOf(l), 'staged_split.swapped_at': now, updated_at: now,
              ...(carried.has(l.id) ? { translation: { ...carried.get(l.id), updated_at: now } } : l.translation?.data ? { 'translation.updated_at': now } : {}) }, $unset: { hidden: '' } },
          } })), { session });
          if (r2.modifiedCount !== leaves.length) throw new Error(`promoted ${r2.modifiedCount}/${leaves.length} leaves: aborting the swap`);
        });
      } finally { await session.endSession(); }
      // The archived spreads stop being served by semantic search: their rows carry the old page numbers (#6270).
      const withdrawn = await withdrawPageVectors(frames.map((f) => f.id), { reason: 'archived', writer: 'split-swap' });
      const counts = await recountBook(db, bookId, { reason: 'split-swap' });
      await db.collection('books').updateOne({ id: bookId }, { $set: {
        needs_splitting: false, split_completed: true, split_completed_at: now, split_page_order: pageOrder,
        ...(coverPage ? { cover_page: coverPage } : {}), 'pipeline_auto.split_checked': true, updated_at: now,
      } });
      if (redirects.length) await db.collection('shortlink_redirects').createIndex({ code: 1 }, { unique: true });
      for (const r of redirects) {
        await db.collection('shortlink_redirects').updateOne({ code: r.code }, { $set: { ...r, reason: 'spread split #7605', run: leaves[0].staged_split.run, created_at: now } }, { upsert: true });
      }
      const after = { readable: counts.after?.pages_ocr ?? null, translated: counts.after?.pages_translated ?? null, pages: counts.after?.pages_count ?? null };
      const detail = { issue: 7605, run: leaves[0].staged_split.run, frames: frames.length, leaves: leaves.length, page_order: pageOrder, english_carried: carries.map(([l]) => leafNumberOf(l)), before, after, redirects: redirects.map((r) => r.code), vectors_withdrawn: withdrawn?.withdrawn ?? null };
      await db.collection('book_events').insertOne({ book_id: bookId, type: 'spread_split', at: now, source: 'split-swap', details: detail });
      await recordSweepAction(db, { sweep: 'split-swap-7605', book_id: bookId, action: 'swapped-in-staged-leaves', detail });
      // Supabase `pages` (keyword search) is synced by ocr/translation timestamps, which a swap does not move: without
      // this the archived spreads keep their old positive numbers there beside the leaves (gate book, 2026-10-30).
      const sync = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workers', 'sync-pages-content.mjs'), `--book=${bookId}`], { encoding: 'utf8', env: process.env, timeout: 300_000 });
      console.log(`  supabase pages: ${(sync.stdout || sync.stderr || '').trim().split('\n').pop()}`);
      // The book page is ISR- and CDN-cached with the old page count (gate run: 17 pages shown for 32): tell the cache.
      try {
        const rv = await revalidatePaths([...new Set([`/book/${book.slug || bookId}`, `/book/${bookId}`])], { quiet: true });
        console.log(`  revalidated: ${rv?.revalidated ?? '?'} path(s)`);
      } catch (e) { console.log(`  REVALIDATE FAILED (${e.message}): the book page may show the old page count until its ISR expires`); }
      console.log(`  SWAPPED: pages ${before.pages} → ${after.pages}, readable ${before.readable} → ${after.readable}, translated ${before.translated} → ${after.translated}; ${redirects.length} redirect(s)`);
      console.log(`  check: https://sourcelibrary.org/book/${book.slug || bookId}`);
    }
  }
} finally { await client.close(); }
