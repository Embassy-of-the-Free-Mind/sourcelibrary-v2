import { describe, it, expect } from 'vitest';
import { matchKnownEntity } from '@/lib/known-entities';

// Known-entity capture (#2790): a query naming a place in the library resolves
// to a direct destination; generic words must NOT resolve (strict match only).

describe('matchKnownEntity', () => {
  // The SHWEP reading room was taken down; no query may route to /shwep again.
  it('does NOT resolve the retired SHWEP reading room', () => {
    expect(matchKnownEntity('shwep')).toBeNull();
    expect(matchKnownEntity('  SHWEP ')).toBeNull();
    expect(matchKnownEntity('Secret History of Western Esotericism')).toBeNull();
  });

  it('is case-insensitive and tolerant of spacing', () => {
    const collections = [
      { slug: 'alchemy', name: 'Alchemy', description: 'The art', subtitle: 'Transmutation' },
    ];
    expect(matchKnownEntity('  ALCHEMY ', { collections })?.href).toBe('/collections/alchemy');
  });

  it('resolves a collection by slug or name', () => {
    const collections = [
      { slug: 'alchemy', name: 'Alchemy', description: 'The art', subtitle: 'Transmutation' },
    ];
    expect(matchKnownEntity('alchemy', { collections })?.href).toBe('/collections/alchemy');
    expect(matchKnownEntity('Alchemy', { collections })?.kind).toBe('collection');
  });

  it('resolves a library partner', () => {
    const m = matchKnownEntity('internet archive');
    expect(m?.href).toBe('/libraries/internet-archive');
    expect(m?.kind).toBe('library');
  });

  it('does NOT resolve generic words or partial matches', () => {
    expect(matchKnownEntity('history')).toBeNull();
    expect(matchKnownEntity('the')).toBeNull();
    expect(matchKnownEntity('mercury')).toBeNull();
    // a substring of an alias must not match (strict, not contains)
    expect(matchKnownEntity('secret history')).toBeNull();
  });

  it('returns null for empty / too-short queries', () => {
    expect(matchKnownEntity('')).toBeNull();
    expect(matchKnownEntity('a')).toBeNull();
  });
});
