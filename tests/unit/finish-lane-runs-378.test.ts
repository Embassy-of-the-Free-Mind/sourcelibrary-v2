/**
 * The finish lane's memory between runs (#378): ledger entries are retried after a week, and a book found empty is
 * skipped until it changes.
 *
 * PRIOR ART: tests/unit/finish-first-8482.test.ts — pins the lane's order, frame and stamp; nothing pinned what a run
 * remembers from the last one.
 */
import { describe, it, expect } from 'vitest';
import { freshLedger, emptySkip, FINISH_LEDGER_RETRY_DAYS, FINISH_EMPTY_TTL_H } from '../../scripts/batch/cli-translate-lane.mjs';

const DAY = 86400e3;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const line = (page_id: string, daysAgo: number, error_class = 'not_read') => JSON.stringify({ page_id, error_class, at: new Date(NOW - daysAgo * DAY).toISOString() });

describe('freshLedger (#378): a ledgered page is retried after FINISH_LEDGER_RETRY_DAYS', () => {
  it('keeps out only pages whose latest entry is younger than the retry age', () => {
    expect(FINISH_LEDGER_RETRY_DAYS).toBe(7);
    const got = freshLedger([line('a', 1), line('b', 8), line('c', 6.9)], { now: NOW });
    expect([...got].sort()).toEqual(['a', 'c']);
  });
  it('a page ledgered again after its retry counts from the new entry', () => {
    const got = freshLedger([line('a', 20), line('a', 2)], { now: NOW });
    expect([...got]).toEqual(['a']);
  });
  it('a line with no date is retried (never kept forever), a bad line is ignored', () => {
    const got = freshLedger([JSON.stringify({ page_id: 'x' }), 'not json', line('y', 0)], { now: NOW });
    expect([...got]).toEqual(['y']);
  });
});

describe('emptySkip (#378): a book found with nothing to translate is skipped until it changes', () => {
  const book = { id: 'b', updated_at: new Date('2026-11-15T10:00:00Z') };
  const entry = { u: String(book.updated_at), at: NOW - 3600e3 };
  it('skips an unchanged book inside the TTL', () => {
    expect(emptySkip(book, entry, { now: NOW })).toBe(true);
  });
  it('looks again when the book changed (its counters or rung moved)', () => {
    expect(emptySkip({ ...book, updated_at: new Date('2026-11-15T11:00:00Z') }, entry, { now: NOW })).toBe(false);
  });
  it('looks again after the TTL, and when never seen', () => {
    expect(emptySkip(book, { ...entry, at: NOW - FINISH_EMPTY_TTL_H * 3600e3 }, { now: NOW })).toBe(false);
    expect(emptySkip(book, undefined, { now: NOW })).toBe(false);
  });
});
