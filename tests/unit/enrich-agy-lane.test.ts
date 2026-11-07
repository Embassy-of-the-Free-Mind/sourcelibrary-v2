/**
 * #7628: the agy enrichment lane claims a book in the batch lane's state collection BEFORE its call, so the API batch
 * lane (whose admission skips any book with a row there, unless the row is `failed`) never pays for the same book.
 * A book the batch lane failed may be taken here; one this lane failed is left to the API lane (the fallback).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs, no types
import { claimBook, groupBatches, MAX_CHARS, MAX_TURNS, needsChapters, retryEmptyFilter } from '../../scripts/workers/lib/enrich-agy-lane.mjs';
// @ts-expect-error — plain .mjs, no types
import { gapFilter } from '../../scripts/workers/lib/enrich-batch-lane.mjs';

type Row = Record<string, unknown> & { _id: string };
/** The two operations claimBook uses, over an in-memory map, with Mongo's duplicate-key error. */
function fakeStates(rows: Row[]) {
  const m = new Map(rows.map((r) => [r._id, { ...r }]));
  return {
    m,
    async insertOne(doc: Row) {
      if (m.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      m.set(doc._id, { ...doc });
    },
    async updateOne(filter: Record<string, unknown>, update: { $set: Record<string, unknown>; $unset?: Record<string, unknown> }) {
      const r = m.get(filter._id as string);
      const laneNe = (filter.lane as { $ne?: string } | undefined)?.$ne;
      if (!r || r.stage !== filter.stage || (laneNe !== undefined && r.lane === laneNe)) return { modifiedCount: 0 };
      Object.assign(r, update.$set);
      for (const k of Object.keys(update.$unset || {})) delete r[k];
      return { modifiedCount: 1 };
    },
  };
}
const me = { run: 'run-1', runTag: 'enrich-agy-7628' };

describe('enrich-agy-lane claim (#7628)', () => {
  it('claims a book no lane has, as agy_claimed', async () => {
    const s = fakeStates([]);
    expect(await claimBook(s, 'b1', me)).toBe('new');
    expect(s.m.get('b1')).toMatchObject({ stage: 'agy_claimed', lane: 'agy', agy_run: 'run-1', attempts: 0 });
  });

  it('never takes a book the batch lane has in flight or finished', async () => {
    for (const stage of ['index_pending', 'index_submitted', 'index_collected', 'summary_submitted', 'indexed', 'chapters_submitted', 'done', 'dropped', 'agy_claimed']) {
      const s = fakeStates([{ _id: 'b1', stage }]);
      expect(await claimBook(s, 'b1', me), stage).toBeNull();
      expect(s.m.get('b1')?.stage).toBe(stage);
    }
  });

  it('takes a book the batch lane failed, but leaves one this lane failed to the batch lane', async () => {
    const s = fakeStates([{ _id: 'api', stage: 'failed', attempts: 2, error: 'x' }, { _id: 'mine', stage: 'failed', lane: 'agy', attempts: 1 }]);
    expect(await claimBook(s, 'api', me)).toBe('from_failed');
    expect(s.m.get('api')).toMatchObject({ stage: 'agy_claimed', lane: 'agy' });
    expect(s.m.get('api')?.error).toBeUndefined();
    expect(await claimBook(s, 'mine', me)).toBeNull();
  });
});

describe('enrich-agy-lane parts', () => {
  const batch = (chars: number) => [{ translation: { data: 'x'.repeat(chars) } }];
  it('groups page batches into parts under the cap, never splitting a batch', () => {
    const parts = groupBatches([batch(250), batch(250), batch(250), batch(400)], 600);
    expect(parts.map((p: unknown[]) => p.length)).toEqual([2, 1, 1]);
    expect(groupBatches([batch(900)], 600)).toHaveLength(1);
  });
  it('keeps the measured defaults: 600K characters a conversation, 8 turns', () => {
    expect(MAX_CHARS).toBe(600_000);
    expect(MAX_TURNS).toBe(8);
  });
});

describe('enrich-agy-lane --retry-empty-chapters (#8333)', () => {
  // Olaus Magnus as the lane's cursor projects it: chapters as a length, extraction stamped 2026-03-06.
  const olaus = { id: '699065763dc2ed39a49f155d', pages_count: 915, chapters: 0, chapters_extracted_at: new Date('2026-03-06T19:10:59Z') };
  it('asks again for a book whose extraction stored an empty list only when the retry is asked for', () => {
    expect(needsChapters(olaus)).toBe(false);
    expect(needsChapters(olaus, { retryEmpty: true })).toBe(true);
  });
  it('never re-asks a book that has chapters, or one too short to have any', () => {
    expect(needsChapters({ ...olaus, chapters: 22 }, { retryEmpty: true })).toBe(false);
    expect(needsChapters({ ...olaus, pages_count: 5 }, { retryEmpty: true })).toBe(false);
  });
  it('selects on an empty chapter list alone, keeping every other exclusion of the gap', () => {
    const gap = gapFilter({});
    const f = retryEmptyFilter(gap) as Record<string, unknown>;
    expect(f.$or).toEqual([{ chapters: null }, { chapters: { $size: 0 } }]);
    expect(JSON.stringify(f.$or)).not.toContain('summary');
    for (const k of Object.keys(gap).filter(k => k !== '$or' && k !== 'pages_count')) expect(f[k]).toEqual((gap as Record<string, unknown>)[k]);
  });
});
