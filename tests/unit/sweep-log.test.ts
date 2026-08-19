/**
 * recordSweepAction: the row-shaped alternative to sweep columns (#3969).
 *
 * What these pin: a sweep records its per-book verdicts as ROWS in `sweep_log`,
 * with a fixed shape (timestamp, sweep, book_id, action, detail?, script) —
 * and invalid input THROWS instead of writing junk, because a sweep that
 * half-records is worse than one that stops.
 *
 * No live DB: the helper takes any object with a .collection().insertOne(),
 * so a spy stands in for Mongo and the tests assert the exact row written.
 */
import { describe, it, expect, vi } from 'vitest';

import { recordSweepAction } from '../../scripts/lib/sweep-log.mjs';

function fakeDb() {
  const insertOne = vi.fn(async (doc: Record<string, unknown>) => ({ insertedId: doc._id ?? 'fake-id' }));
  const collection = vi.fn(() => ({ insertOne }));
  return { db: { collection }, collection, insertOne };
}

describe('recordSweepAction', () => {
  it('writes one row to sweep_log with the documented shape', async () => {
    const { db, collection, insertOne } = fakeDb();
    const before = new Date();
    const row = await recordSweepAction(db, {
      sweep: 'dedup-2026-08',
      book_id: '66f000000000000000000001',
      action: 'hidden-as-duplicate',
      detail: { kept: '66f000000000000000000002' },
    });

    expect(collection).toHaveBeenCalledExactlyOnceWith('sweep_log');
    expect(insertOne).toHaveBeenCalledTimes(1);
    const written = insertOne.mock.calls[0][0];
    expect(written).toBe(row); // returns the row it wrote
    expect(written).toMatchObject({
      sweep: 'dedup-2026-08',
      book_id: '66f000000000000000000001',
      action: 'hidden-as-duplicate',
      detail: { kept: '66f000000000000000000002' },
    });
    expect(written.timestamp).toBeInstanceOf(Date);
    expect(written.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    // script is stamped from process.argv[1] — under vitest that's the runner,
    // but it must always be a non-empty basename (no slashes).
    expect(typeof written.script).toBe('string');
    expect(written.script.length).toBeGreaterThan(0);
    expect(written.script).not.toContain('/');
  });

  it('accepts a string detail and omits the key entirely when detail is absent', async () => {
    const { db, insertOne } = fakeDb();
    await recordSweepAction(db, { sweep: 'a-sweep', book_id: 'b1', action: 'noted', detail: 'kept the longer copy' });
    expect(insertOne.mock.calls[0][0].detail).toBe('kept the longer copy');

    await recordSweepAction(db, { sweep: 'a-sweep', book_id: 'b2', action: 'noted' });
    expect('detail' in insertOne.mock.calls[1][0]).toBe(false);
  });

  it('throws on missing or non-string required fields, without writing', async () => {
    const { db, insertOne } = fakeDb();
    const base = { sweep: 'a-sweep', book_id: 'b1', action: 'noted' };

    await expect(recordSweepAction(db, { ...base, sweep: undefined as never })).rejects.toThrow(/'sweep'/);
    await expect(recordSweepAction(db, { ...base, book_id: '' })).rejects.toThrow(/'book_id'/);
    await expect(recordSweepAction(db, { ...base, book_id: 123 as never })).rejects.toThrow(/'book_id'/);
    await expect(recordSweepAction(db, { ...base, action: undefined as never })).rejects.toThrow(/'action'/);
    // entry object omitted entirely
    await expect(recordSweepAction(db, undefined as never)).rejects.toThrow(/'sweep'/);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('throws on a non-kebab-case sweep name', async () => {
    const { db, insertOne } = fakeDb();
    for (const bad of ['Dedup2026', 'dedup_2026', 'dedup 2026', '-leading', 'trailing-', 'UPPER-CASE']) {
      await expect(
        recordSweepAction(db, { sweep: bad, book_id: 'b1', action: 'noted' })
      ).rejects.toThrow(/kebab-case/);
    }
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('throws on a detail that is neither a plain object nor a string', async () => {
    const { db, insertOne } = fakeDb();
    const base = { sweep: 'a-sweep', book_id: 'b1', action: 'noted' };
    for (const bad of [42, true, ['a'], new Date(), null]) {
      await expect(recordSweepAction(db, { ...base, detail: bad as never })).rejects.toThrow(/'detail'/);
    }
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('throws when handed something that is not a db handle', async () => {
    await expect(
      recordSweepAction(undefined as never, { sweep: 'a-sweep', book_id: 'b1', action: 'noted' })
    ).rejects.toThrow(/db handle/);
  });
});
