/**
 * split-book.mjs sets the reading order of a spread's halves from the printed numbers (#5699), not from
 * the language. These pin the vote: a clear majority decides, anything less is `unreadable` (the split
 * flags the book rather than guessing).
 */
import { describe, it, expect } from 'vitest';

import { voteSpreadOrder, printedNumber } from '../../scripts/lib/split-page-order.mjs';

const leaf = (n: number | null, body = 'text of the page') => (n == null ? body : `<header>${n}</header>\n${body}`);
const pairs = (list: [number | null, number | null][]) => list.map(([l, r]) => ({ left: leaf(l), right: leaf(r) }));

describe('voteSpreadOrder', () => {
  it('reads a running-head number', () => expect(printedNumber(leaf(211))).toBe(211));
  it('left-to-right binding (Maqrizi, Arabic) → ltr, whatever the language', () => {
    expect(voteSpreadOrder(pairs([[208, 209], [210, 211], [212, 213], [214, 215]])).verdict).toBe('ltr');
  });
  it('right-to-left binding → rtl', () => {
    expect(voteSpreadOrder(pairs([[3, 2], [5, 4], [7, 6]])).verdict).toBe('rtl');
  });
  it('too few readable pairs → unreadable (flag, do not guess)', () => {
    const v = voteSpreadOrder(pairs([[2, 3], [null, null], [null, 5], [8, 9]]));
    expect(v).toMatchObject({ verdict: 'unreadable', ltr: 2, readable: 2 });
  });
  it('no text at all (gutter-only split) → unreadable', () => {
    expect(voteSpreadOrder([{ left: null, right: null }, { left: null, right: null }]).verdict).toBe('unreadable');
  });
  it('a split vote → unreadable', () => {
    expect(voteSpreadOrder(pairs([[2, 3], [4, 5], [7, 6], [9, 8]])).verdict).toBe('unreadable');
  });
  it('unrelated numbers do not vote', () => {
    expect(voteSpreadOrder(pairs([[2, 30], [4, 50], [6, 70], [10, 11]]))).toMatchObject({ verdict: 'unreadable', ltr: 1, readable: 4 });
  });
});
