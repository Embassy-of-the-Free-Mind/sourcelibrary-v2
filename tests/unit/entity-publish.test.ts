/**
 * Published-entity tier (issue #4321).
 *
 * The entity layer holds ~1M entities; ~76% appear in one book. A page is
 * PUBLISHED (indexable, linkable from prose) only with both reach
 * (book_count >= 3) and identity (wikidata_id or description). The tier is a
 * read-side predicate — there is deliberately no stored flag to sweep.
 *
 * Two things are pinned here:
 *  1. The predicate's semantics, case by case.
 *  2. That the Mongo filter fragment agrees with the predicate — a guard
 *     that only normalizes one side is inert (the link side gates with the
 *     filter, the page's noindex with the function; if they drift, entities
 *     get linked-but-noindexed or hidden-but-indexed).
 */
import { describe, it, expect } from 'vitest';

import {
  isPublishedEntity,
  PUBLISHED_ENTITY_FILTER,
  PUBLISHED_ENTITY_MIN_BOOKS,
} from '@/lib/entity-publish';

describe('isPublishedEntity', () => {
  it('requires BOTH reach and identity', () => {
    expect(isPublishedEntity({ book_count: 5, wikidata_id: 'Q1234' })).toBe(true);
    expect(isPublishedEntity({ book_count: 5, description: 'A Greek astronomer.' })).toBe(true);
    // reach without identity — the "Axis" case: a common noun in many books
    expect(isPublishedEntity({ book_count: 50 })).toBe(false);
    // identity without reach — enriched but not yet a cross-corpus claim
    expect(isPublishedEntity({ book_count: 2, wikidata_id: 'Q1234' })).toBe(false);
  });

  it('sits exactly at the 3-book boundary', () => {
    expect(isPublishedEntity({ book_count: 3, wikidata_id: 'Q1' })).toBe(true);
    expect(isPublishedEntity({ book_count: 2, wikidata_id: 'Q1' })).toBe(false);
    expect(PUBLISHED_ENTITY_MIN_BOOKS).toBe(3);
  });

  it('does not accept empty identity fields', () => {
    expect(isPublishedEntity({ book_count: 10, wikidata_id: '' })).toBe(false);
    expect(isPublishedEntity({ book_count: 10, wikidata_id: null, description: null })).toBe(false);
  });

  it('treats a missing book_count as zero', () => {
    expect(isPublishedEntity({ wikidata_id: 'Q1' })).toBe(false);
    expect(isPublishedEntity({ book_count: null, wikidata_id: 'Q1' })).toBe(false);
  });
});

describe('PUBLISHED_ENTITY_FILTER agrees with the predicate', () => {
  // Minimal evaluator for the exact operators the filter uses. If the filter
  // grows an operator this evaluator doesn't know, the test throws — which is
  // the point: both sides must be updated together.
  function matchesFilter(doc: Record<string, unknown>): boolean {
    const evalCond = (value: unknown, cond: Record<string, unknown>): boolean =>
      Object.entries(cond).every(([op, operand]) => {
        switch (op) {
          case '$gte':
            return typeof value === 'number' && value >= (operand as number);
          case '$type':
            return operand === 'string' ? typeof value === 'string' : (() => { throw new Error(`unhandled $type ${operand}`); })();
          case '$ne':
            return value !== operand;
          default:
            throw new Error(`unhandled operator ${op}`);
        }
      });
    return Object.entries(PUBLISHED_ENTITY_FILTER).every(([key, cond]) => {
      if (key === '$or') {
        return (cond as Array<Record<string, Record<string, unknown>>>).some(branch =>
          Object.entries(branch).every(([f, c]) => evalCond(doc[f], c)),
        );
      }
      return evalCond(doc[key], cond as Record<string, unknown>);
    });
  }

  const cases: Array<Record<string, unknown>> = [
    { book_count: 5, wikidata_id: 'Q1' },
    { book_count: 5, description: 'x' },
    { book_count: 3, wikidata_id: 'Q1' },
    { book_count: 2, wikidata_id: 'Q1' },
    { book_count: 50 },
    { book_count: 10, wikidata_id: '' },
    { book_count: 10, description: '   ' },
    { wikidata_id: 'Q1' },
    { book_count: 0, description: 'x' },
  ];

  it.each(cases.map(c => [JSON.stringify(c), c] as const))('%s', (_label, doc) => {
    expect(matchesFilter(doc)).toBe(
      isPublishedEntity(doc as { book_count?: number; wikidata_id?: string; description?: string }),
    );
  });
});
