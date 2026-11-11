/**
 * #7628: the agy enrichment lane claims a book in the batch lane's state collection BEFORE its call, so the API batch
 * lane (whose admission skips any book with a row there, unless the row is `failed`) never pays for the same book.
 * A book the batch lane failed may be taken here; one this lane failed is left to the API lane (the fallback).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs, no types
import { claimBook, groupBatches, MAX_CHARS, MAX_TURNS, PART_CHARS, AGY_ATTEMPTS, isRetryable, parseJsonLoose, needsChapters, retryEmptyFilter } from '../../scripts/workers/lib/enrich-agy-lane.mjs';
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
      // claimBook's retry clause: { $or: [{ lane: { $ne: 'agy' } }, { lane: 'agy', attempts: { $lt: N } }] }
      const or = filter.$or as Array<{ lane: string | { $ne: string }; attempts?: { $lt: number } }> | undefined;
      const orOk = !or || or.some((c) => (typeof c.lane === 'object' ? r?.lane !== c.lane.$ne : r?.lane === c.lane && ((r?.attempts as number) || 0) < (c.attempts?.$lt ?? Infinity)));
      if (!r || r.stage !== filter.stage || !orOk) return { modifiedCount: 0 };
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

  it('takes a book the batch lane failed', async () => {
    const s = fakeStates([{ _id: 'api', stage: 'failed', attempts: 2, error: 'x' }]);
    expect(await claimBook(s, 'api', me)).toBe('from_failed');
    expect(s.m.get('api')).toMatchObject({ stage: 'agy_claimed', lane: 'agy' });
    expect(s.m.get('api')?.error).toBeUndefined();
  });

  it('retries its own failure once, then leaves the book to the batch lane (2026-11-10)', async () => {
    expect(AGY_ATTEMPTS).toBe(2);
    const s = fakeStates([{ _id: 'once', stage: 'failed', lane: 'agy', attempts: 1 }, { _id: 'twice', stage: 'failed', lane: 'agy', attempts: 2 }]);
    expect(await claimBook(s, 'once', me)).toBe('from_failed');
    expect(await claimBook(s, 'twice', me)).toBeNull();
    expect(s.m.get('twice')?.stage).toBe('failed');
    // The run's in-memory pre-filter says the same.
    expect(isRetryable({ stage: 'failed', lane: 'agy', attempts: 1 })).toBe(true);
    expect(isRetryable({ stage: 'failed', lane: 'agy', attempts: 2 })).toBe(false);
    expect(isRetryable({ stage: 'failed', attempts: 5 })).toBe(true);
    expect(isRetryable({ stage: 'done', lane: 'agy' })).toBe(false);
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
  it('reads a book over the cap in parts that fit one 150K message (2026-11-10)', () => {
    // Each turn re-reads the conversation: a part must be one message to be read once.
    expect(PART_CHARS).toBeLessThanOrEqual(130_000);
  });
});

describe('enrich-agy-lane parseJsonLoose', () => {
  it('parses clean JSON unchanged', () => {
    expect(parseJsonLoose('{"a": "b", "c": [1, 2]}')).toEqual({ a: 'b', c: [1, 2] });
  });
  it('drops trailing commas and raw control characters', () => {
    expect(parseJsonLoose('{"a": "x\ty", "c": [1, 2,],}')).toEqual({ a: 'x y', c: [1, 2] });
  });
  it('escapes unescaped quotes inside a string', () => {
    const bad = '{"quotes": [{"text": "He called it "the stone of the wise" and kept it", "page": 12}], "n": 1}';
    expect(parseJsonLoose(bad)).toEqual({ quotes: [{ text: 'He called it "the stone of the wise" and kept it', page: 12 }], n: 1 });
  });
  it('escapes a quoted word mid-sentence; an ambiguous quote before the closing one is refused', () => {
    expect(parseJsonLoose('{"s": "the "Tabula" says so"}')).toEqual({ s: 'the "Tabula" says so' });
    expect(() => parseJsonLoose('{"s": "says "so""}')).toThrow();
  });
  it('never repairs a missing comma into a string that swallows the next key', () => {
    expect(() => parseJsonLoose('{"a": "x" "b": "y"}')).toThrow();
    expect(() => parseJsonLoose('{"a": "x", "b": [1, 2}')).toThrow();
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
