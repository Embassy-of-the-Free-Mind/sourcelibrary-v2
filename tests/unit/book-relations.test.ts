import { describe, it, expect } from 'vitest';
import { RELATION_TYPES, canonicalBookId, isRelationType, isSymmetric, orderPair } from '@/lib/book-relations';

describe('book_relations: the stored pair', () => {
  it('sorts a symmetric pair, so either entry order is one row', () => {
    for (const type of ['other_copy_of_edition', 'bound_with'] as const) {
      expect(orderPair('b2', 'a1', type)).toEqual({ a: 'a1', b: 'b2' });
      expect(orderPair('a1', 'b2', type)).toEqual({ a: 'a1', b: 'b2' });
    }
  });

  it('keeps direction for contains: a is the volume, b the part', () => {
    expect(isSymmetric('contains')).toBe(false);
    expect(orderPair('zz-sammelband', 'aa-tract', 'contains')).toEqual({ a: 'zz-sammelband', b: 'aa-tract' });
  });

  it('knows its types and refuses the one it must not grow into', () => {
    expect([...RELATION_TYPES]).toEqual(['other_copy_of_edition', 'bound_with', 'contains']);
    // Same-object records stay on books.duplicate_of (#6019 decision 5).
    expect(isRelationType('duplicate_of')).toBe(false);
    expect(isRelationType(undefined)).toBe(false);
  });

  it('prefers the book id over a re-minted _id', () => {
    expect(canonicalBookId({ _id: 'new-oid', id: 'old-id' })).toBe('old-id');
    expect(canonicalBookId({ _id: 'only-oid' })).toBe('only-oid');
  });
});
