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

// #1180: tools are reachable by the name a reader types ("identify" → /identify),
// without generic topic words ("map", "images") being captured as tool names.
describe('matchKnownEntity — site features', () => {
  it('resolves a tool by its name', () => {
    expect(matchKnownEntity('identify')).toMatchObject({ href: '/identify', kind: 'feature' });
    expect(matchKnownEntity('Ngram Viewer')).toMatchObject({ href: '/ngrams', kind: 'feature' });
    expect(matchKnownEntity('ask the librarian')).toMatchObject({ href: '/librarian', kind: 'feature' });
  });

  it('does not capture topic words a reader searches the books for', () => {
    for (const q of ['map', 'images', 'engravings', 'game', 'data', 'works', 'research']) {
      expect(matchKnownEntity(q)).toBeNull();
    }
  });

  it('lets a collection of the same name win over a tool', () => {
    const collections = [{ slug: 'gallery', name: 'Gallery', description: '', subtitle: '' }];
    expect(matchKnownEntity('gallery', { collections: collections as any })?.kind).toBe('collection');
  });
});

// #4330: the proxy refuses the Librarian on partner hosts, so the search page
// on a partner host must not offer a card that leads to a 404.
describe('matchKnownEntity — on a partner host', () => {
  it('does not offer the Librarian there, and still does on the apex', () => {
    for (const q of ['librarian', 'ask the librarian', 'AI Librarian']) {
      expect(matchKnownEntity(q, { onTenantHost: true }), q).toBeNull();
      expect(matchKnownEntity(q)?.href, q).toBe('/librarian');
      expect(matchKnownEntity(q, { onTenantHost: false })?.href, q).toBe('/librarian');
    }
  });

  it('still offers what the partner host serves', () => {
    expect(matchKnownEntity('gallery', { onTenantHost: true })?.href).toBe('/gallery');
    const collections = [{ slug: 'alchemy', name: 'Alchemy', description: '', subtitle: '' }];
    expect(matchKnownEntity('alchemy', { collections, onTenantHost: true })?.href).toBe('/collections/alchemy');
  });
});
