import { describe, it, expect } from 'vitest';
import {
  findCitedBookLinks,
  findCitedArtworkSlugs,
  findCitedCollectionSlugs,
} from '@/lib/embassy/citation-fixes';

// The Librarian's dead-link checker walks a streamed response for
// sourcelibrary.org links and verifies each one resolves. The regression
// these helpers exist to pin: `images.sourcelibrary.org` (the CDN host that
// serves cover art and gallery crops) ends with the substring
// `sourcelibrary.org`, so an unanchored host pattern misreads a perfectly
// good image URL as a link to a reader page and reports it dead. The fix is
// a negative lookbehind (SITE_HOST_PATTERN) requiring the host to start a
// URL, not just end with the right characters.

describe('findCitedArtworkSlugs', () => {
  it('does not mistake a CDN image URL for an artwork page link', () => {
    const text = 'See the plate: https://images.sourcelibrary.org/artwork/an-alchemist-at-work.jpg';
    expect(findCitedArtworkSlugs(text)).toEqual([]);
  });

  it('finds a real artwork page link', () => {
    const text = 'Full record at https://sourcelibrary.org/artwork/foo';
    expect(findCitedArtworkSlugs(text)).toEqual(['foo']);
  });

  it('ignores the CDN image URL but keeps a real page link in the same text', () => {
    const text = [
      'Here is the image: https://images.sourcelibrary.org/artwork/an-alchemist-at-work.jpg',
      'and here is the page: https://sourcelibrary.org/artwork/an-alchemist-at-work',
    ].join('\n');
    expect(findCitedArtworkSlugs(text)).toEqual(['an-alchemist-at-work']);
  });
});

describe('findCitedBookLinks', () => {
  it('ignores CDN image and thumbnail URLs but finds a real book link', () => {
    const text = [
      'CDN cover: https://images.sourcelibrary.org/book/foo',
      'CDN thumbnail: https://images.sourcelibrary.org/book-thumbnails/x-thumb.jpg',
      'Real link: https://sourcelibrary.org/book/foo',
    ].join('\n');
    expect(findCitedBookLinks(text)).toEqual([{ slug: 'foo' }]);
  });

  it('parses a ?page= suffix', () => {
    const text = 'https://sourcelibrary.org/book/foo?page=42';
    expect(findCitedBookLinks(text)).toEqual([{ slug: 'foo', page: 42 }]);
  });

  it('parses a /page-number/ suffix', () => {
    const text = 'https://sourcelibrary.org/book/foo/page-number/42';
    expect(findCitedBookLinks(text)).toEqual([{ slug: 'foo', page: 42 }]);
  });

  it('parses a /page/ suffix', () => {
    const text = 'https://sourcelibrary.org/book/foo/page/42';
    expect(findCitedBookLinks(text)).toEqual([{ slug: 'foo', page: 42 }]);
  });

  it('parses a bare book link with no page key', () => {
    const text = 'https://sourcelibrary.org/book/foo';
    const result = findCitedBookLinks(text);
    expect(result).toEqual([{ slug: 'foo' }]);
    expect(result[0]).not.toHaveProperty('page');
  });
});

describe('findCitedCollectionSlugs', () => {
  it('separates plural (real route) from singular (not a route) collection links', () => {
    const text = [
      'Real collection: https://sourcelibrary.org/collections/x',
      'Fabricated singular: https://sourcelibrary.org/collection/y',
    ].join('\n');
    expect(findCitedCollectionSlugs(text)).toEqual({ plural: ['x'], singular: ['y'] });
  });

  it('does not double-count a plural collection link as a singular hit', () => {
    // /collections/x contains the substring "collection" immediately followed
    // by "s", not "/" — the singular pattern requires "/collection/" as a
    // contiguous literal, so it must not also fire on the plural URL.
    const text = 'https://sourcelibrary.org/collections/x';
    expect(findCitedCollectionSlugs(text)).toEqual({ plural: ['x'], singular: [] });
  });
});

describe('SITE_HOST_PATTERN anchoring', () => {
  it('still matches a bare host with no scheme', () => {
    const text = 'Reference: sourcelibrary.org/book/foo for details.';
    expect(findCitedBookLinks(text)).toEqual([{ slug: 'foo' }]);
  });
});
