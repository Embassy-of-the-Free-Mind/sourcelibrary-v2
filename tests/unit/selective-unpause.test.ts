import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { getScopeConfig, hasScope, shouldBypassPause, resolveScopeBookIds } from '../../scripts/workers/lib/selective-unpause.mjs';

// Minimal Mongo-ish stub: books.find({collections:{$in}}).toArray() returns the
// rows whose `collections` intersect the queried slugs.
function mockDb(booksByCollection: Record<string, string[]>) {
  return {
    collection() {
      return {
        find(query: any) {
          const slugs: string[] = query?.collections?.$in ?? [];
          const ids = new Set<string>();
          for (const slug of slugs) for (const id of booksByCollection[slug] ?? []) ids.add(id);
          return { toArray: async () => [...ids].map(id => ({ id })) };
        },
      };
    },
  };
}

describe('selective-unpause scope helpers', () => {
  describe('shouldBypassPause — the load-bearing invariant', () => {
    it('proceeds when not paused', () => {
      expect(shouldBypassPause({ paused: false })).toBe(true);
      expect(shouldBypassPause({})).toBe(true);
      expect(shouldBypassPause(null)).toBe(true);
    });

    it('does NOT proceed when paused with no scope and no override (the whole point of the pause)', () => {
      expect(shouldBypassPause({ paused: true })).toBe(false);
      expect(shouldBypassPause({ paused: true, allow_book_ids: [] })).toBe(false);
      expect(shouldBypassPause({ paused: true, allow_collections: [] })).toBe(false);
    });

    it('proceeds when paused but a book is allowlisted', () => {
      expect(shouldBypassPause({ paused: true, allow_book_ids: ['abc'] })).toBe(true);
    });

    it('proceeds when paused but a collection is allowlisted', () => {
      expect(shouldBypassPause({ paused: true, allow_collections: ['cannabis-western-record'] })).toBe(true);
    });

    it('proceeds when paused but a single --book override is active', () => {
      expect(shouldBypassPause({ paused: true }, { bookOverride: true })).toBe(true);
    });
  });

  describe('hasScope', () => {
    it('is false for empty / missing scope', () => {
      expect(hasScope({ paused: true })).toBe(false);
      expect(hasScope({ allow_book_ids: [], allow_collections: [] })).toBe(false);
      expect(hasScope(null)).toBe(false);
    });
    it('is true when either list is non-empty', () => {
      expect(hasScope({ allow_book_ids: ['x'] })).toBe(true);
      expect(hasScope({ allow_collections: ['y'] })).toBe(true);
    });
  });

  describe('resolveScopeBookIds — book ids ∪ collection-resolved ids', () => {
    it('returns explicit allow_book_ids when no collections', async () => {
      const ids = await resolveScopeBookIds(mockDb({}), { allow_book_ids: ['a', 'b'] });
      expect([...ids].sort()).toEqual(['a', 'b']);
    });
    it('unions allow_book_ids with books in allow_collections (deduped)', async () => {
      const db = mockDb({ 'cannabis-western-record': ['b', 'c'] });
      const ids = await resolveScopeBookIds(db, { allow_book_ids: ['a', 'b'], allow_collections: ['cannabis-western-record'] });
      expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    });
    it('is empty when no scope is configured', async () => {
      const ids = await resolveScopeBookIds(mockDb({}), {});
      expect(ids.size).toBe(0);
    });
  });

  describe('getScopeConfig', () => {
    it('coerces ids to strings and drops falsy entries', () => {
      expect(getScopeConfig({ allow_book_ids: ['a', 1, '', null], allow_collections: ['c', ''] }))
        .toEqual({ bookIds: ['a', '1'], collections: ['c'] });
    });
    it('returns empty arrays for missing fields', () => {
      expect(getScopeConfig({})).toEqual({ bookIds: [], collections: [] });
      expect(getScopeConfig(null)).toEqual({ bookIds: [], collections: [] });
    });
  });
});
