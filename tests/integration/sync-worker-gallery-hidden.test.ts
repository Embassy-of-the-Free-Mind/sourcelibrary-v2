/**
 * The gallery_book_hidden phase survives a corpus with more hidden books than fit
 * one distinct result (#8318).
 *
 * PRIOR ART: tests/integration/sync-worker-page-counts.test.ts runs syncPageCounts()
 * on the same in-memory mongod; nothing tested markHiddenBooksGalleryRows(). Until
 * #8318 it began with books.distinct('id', { hidden: true }), which threw "distinct
 * too big, 16mb cap" on every prod run from 2026-10-30 (~500K hidden books).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { markHiddenBooksGalleryRows } from '../../scripts/workers/sync-worker.mjs';

// 24-char hex ids like prod. 750K × ~35 bytes per distinct entry is ~26 MB, well
// past the 16 MB BSON cap that the old distinct hit.
const FILLER = 750_000;
const hex = (n: number) => n.toString(16).padStart(24, '0');

describe('sync-worker markHiddenBooksGalleryRows (#8318)', () => {
  const remintedOid = new ObjectId();

  beforeAll(async () => {
    await cleanDb();
    const db = getTestDb();
    const books = db.collection('books');
    for (let i = 0; i < FILLER; i += 50_000) {
      await books.insertMany(
        Array.from({ length: 50_000 }, (_, j) => ({ id: hex(i + j), hidden: true })),
        { ordered: false },
      );
    }
    await books.createIndex({ id: 1 });
    await books.insertMany([
      { id: 'H', hidden: true },              // hidden: its rows get marked
      { id: 'V', hidden: false, visible: true }, // visible: untouched
      { id: 'U', hidden: false },             // un-hidden since: a stale mark is left alone
      // Re-minted: the gallery carries the book's _id, not its `id` (#4450).
      { _id: remintedOid, id: 'R-new', hidden: true },
    ]);
    await db.collection('gallery_images').insertMany([
      { id: 'H-0', book_id: 'H', book_hidden: false },
      { id: 'H-1', book_id: 'H' },
      { id: 'H-2', book_id: 'H', book_hidden: true },
      { id: 'V-0', book_id: 'V', book_hidden: false },
      { id: 'U-0', book_id: 'U', book_hidden: true },
      { id: 'R-0', book_id: String(remintedOid), book_hidden: false },
      // A filler book that also has a plate: the batch path must reach it.
      { id: 'F-0', book_id: hex(123_456), book_hidden: null },
    ]);
  }, 300_000);

  const hiddenOf = async (id: string) =>
    (await getTestDb().collection('gallery_images').findOne({ id }))?.book_hidden;

  it('dry run counts both directions over more ids than one distinct holds, and writes nothing', async () => {
    const res = await markHiddenBooksGalleryRows(getTestDb(), { dryRun: true, batchSize: 2 });
    expect(res).toEqual({ modified: 4, hidden_books: 3, stale_hidden: 1 });
    expect(await hiddenOf('H-0')).toBe(false);
  }, 120_000);

  it('marks the rows of hidden books, by id or _id, and never un-hides', async () => {
    const res = await markHiddenBooksGalleryRows(getTestDb(), { dryRun: false });
    expect(res.modified).toBe(4);
    for (const id of ['H-0', 'H-1', 'H-2', 'R-0', 'F-0']) expect(await hiddenOf(id)).toBe(true);
    expect(await hiddenOf('V-0')).toBe(false);
    expect(await hiddenOf('U-0')).toBe(true); // one direction only
    expect((await markHiddenBooksGalleryRows(getTestDb(), { dryRun: false })).modified).toBe(0);
  }, 120_000);
});
