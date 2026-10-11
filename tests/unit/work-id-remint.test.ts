import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no type declarations
import { mintAuthorPart, planRemintAliases } from '../../scripts/lib/work-id-remint.mjs';
import { planQueuedPair, resolveWorkIdsFrom } from '@/lib/work-alias';

// #4329: a local work id is derived from title + author, so repairing either
// moves the id. These pin the trail that keeps the old id followable.

describe('planRemintAliases', () => {
  const OLD = 'local:n:homerus:homeri-odyssea';
  const NEW = 'local:a:homer:homeri-odyssea';

  it('aliases the old id when its whole cluster moves to one new id', () => {
    const { aliasFor, tally } = planRemintAliases(
      [{ id: 'b1', from: OLD, to: NEW }, { id: 'b2', from: OLD, to: NEW }],
      new Map([[OLD, 2]]),
    );
    expect([...aliasFor]).toEqual([['b1', OLD], ['b2', OLD]]);
    expect(tally).toEqual({ renamed: 1, split: 0, partial: 0 });
  });

  it('writes no alias for a split: the old id named a fusion, not a work', () => {
    const { aliasFor, tally } = planRemintAliases(
      [{ id: 'b1', from: OLD, to: NEW }, { id: 'b2', from: OLD, to: 'local:a:homer:ilias' }],
      new Map([[OLD, 2]]),
    );
    expect(aliasFor.size).toBe(0);
    expect(tally.split).toBe(1);
  });

  it('writes no alias while another book still carries the old id', () => {
    const { aliasFor, tally } = planRemintAliases([{ id: 'b1', from: OLD, to: NEW }], new Map([[OLD, 2]]));
    expect(aliasFor.size).toBe(0);
    expect(tally.partial).toBe(1);
  });

  it('treats an uncounted old id as unknown, not as fully moved', () => {
    expect(planRemintAliases([{ id: 'b1', from: OLD, to: NEW }], new Map()).aliasFor.size).toBe(0);
  });

  it('ignores first mints and no-op writes', () => {
    const { aliasFor, tally } = planRemintAliases(
      [{ id: 'b1', from: null, to: NEW }, { id: 'b2', from: NEW, to: NEW }],
      new Map([[NEW, 1]]),
    );
    expect(aliasFor.size).toBe(0);
    expect(tally).toEqual({ renamed: 0, split: 0, partial: 0 });
  });

  it('aliases both sides of a merge onto the survivor', () => {
    const other = 'local:n:homerus:odyssea';
    const { aliasFor } = planRemintAliases(
      [{ id: 'b1', from: OLD, to: NEW }, { id: 'b2', from: other, to: NEW }],
      new Map([[OLD, 1], [other, 1]]),
    );
    expect(aliasFor.get('b1')).toBe(OLD);
    expect(aliasFor.get('b2')).toBe(other);
  });
});

describe('mintAuthorPart', () => {
  it('prefers the thesaurus id, then the normalised byline', () => {
    expect(mintAuthorPart({ author_id: 'homer', author: 'Homerus' })).toEqual({ part: 'a:homer' });
    expect(mintAuthorPart({ author: 'Cornelius Tacitus' })).toEqual({ part: 'n:cornelius-tacitus' });
  });
  it('reports a missing author as anonymous', () => {
    expect(mintAuthorPart({})).toEqual({ part: null, reason: 'anonymous' });
    expect(mintAuthorPart({ author: '  ' })).toEqual({ part: null, reason: 'anonymous' });
  });
  it('refuses an author that normalises to an empty slot instead of minting local:n::', () => {
    // the two Sancai Tuhui records from the 2026-08-30 report, and the wider class
    for (const author of ['王圻、王思義', 'ابن سينا', 'Ed.', 'Li Po']) {
      expect(mintAuthorPart({ author })).toEqual({ part: null, reason: 'empty-slot' });
    }
  });
});

describe('resolveWorkIdsFrom / planQueuedPair', () => {
  const holders = [
    { work_id: 'W1', work_id_aliases: ['old-a'] },
    { work_id: 'W1', work_id_aliases: ['old-a', 'old-b'] },
    { work_id: 'W2', work_id_aliases: ['fused'] },
    { work_id: 'W3', work_id_aliases: ['fused'] },
  ];
  const res = resolveWorkIdsFrom(['live', 'old-a', 'old-b', 'fused', 'gone', 'W2'], ['live', 'W2'], holders);

  it('names the four outcomes', () => {
    expect(res.get('live')).toEqual({ via: 'live', current: 'live' });
    expect(res.get('old-a')).toEqual({ via: 'alias', current: 'W1' });
    expect(res.get('fused')).toEqual({ via: 'ambiguous', current: null, candidates: ['W2', 'W3'] });
    expect(res.get('gone')).toEqual({ via: 'orphaned', current: null });
  });

  it('a live id wins over an alias of the same name', () => {
    const r = resolveWorkIdsFrom(['x'], ['x'], [{ work_id: 'y', work_id_aliases: ['x'] }]);
    expect(r.get('x')).toEqual({ via: 'live', current: 'x' });
  });

  it('follows a retired side to its current id and merges that', () => {
    expect(planQueuedPair('old-a', 'live', res)).toEqual({ kind: 'merge', a: 'W1', b: 'live' });
  });
  it('reports a pair whose sides already share a work as already-merged', () => {
    expect(planQueuedPair('old-a', 'old-b', res)).toEqual({ kind: 'stale', reason: 'already-merged', ids: ['old-a', 'old-b'] });
  });
  it('reports an orphaned side by name rather than as finished work', () => {
    expect(planQueuedPair('gone', 'live', res)).toEqual({ kind: 'stale', reason: 'orphaned-id', ids: ['gone'] });
  });
  it('never guesses through an ambiguous alias', () => {
    expect(planQueuedPair('fused', 'live', res)).toEqual({ kind: 'stale', reason: 'ambiguous-alias', ids: ['fused'] });
  });
  it('treats an id it was never given a resolution for as orphaned', () => {
    expect(planQueuedPair('never-seen', 'live', res)).toEqual({ kind: 'stale', reason: 'orphaned-id', ids: ['never-seen'] });
  });
});
