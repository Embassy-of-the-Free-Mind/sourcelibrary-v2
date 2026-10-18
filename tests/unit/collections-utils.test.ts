import { describe, it, expect } from 'vitest';
import { sanitizeThumbnail, bookTitle, PINNED_COLLECTION_SLUGS, sortCollections, isHighlightMember } from '@/lib/collections-utils';

describe('sanitizeThumbnail', () => {
  it('passes through https URLs', () => {
    expect(sanitizeThumbnail('https://example.com/img.jpg')).toBe('https://example.com/img.jpg');
  });

  it('passes through http URLs', () => {
    expect(sanitizeThumbnail('http://example.com/img.jpg')).toBe('http://example.com/img.jpg');
  });

  it('passes through data URIs', () => {
    expect(sanitizeThumbnail('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });

  it('passes through relative paths', () => {
    expect(sanitizeThumbnail('/images/logo.png')).toBe('/images/logo.png');
  });

  it('unwraps /api/image proxy URLs', () => {
    expect(sanitizeThumbnail('/api/image?url=https%3A%2F%2Fexample.com%2Fimg.jpg'))
      .toBe('https://example.com/img.jpg');
  });

  it('returns undefined for /api/image without url param', () => {
    expect(sanitizeThumbnail('/api/image')).toBeUndefined();
  });

  it('returns undefined for null/undefined/empty', () => {
    expect(sanitizeThumbnail(null)).toBeUndefined();
    expect(sanitizeThumbnail(undefined)).toBeUndefined();
    expect(sanitizeThumbnail('')).toBeUndefined();
  });

  it('rejects random strings', () => {
    expect(sanitizeThumbnail('not-a-url')).toBeUndefined();
  });
});

describe('bookTitle', () => {
  it('returns display_title when available', () => {
    expect(bookTitle({ display_title: 'Atalanta Fleeing', title: 'Atalanta Fugiens' }))
      .toBe('Atalanta Fleeing');
  });

  it('falls back to title when display_title is absent', () => {
    expect(bookTitle({ title: 'Atalanta Fugiens' })).toBe('Atalanta Fugiens');
  });

  it('falls back to title when display_title is "None"', () => {
    expect(bookTitle({ display_title: 'None', title: 'Atalanta Fugiens' }))
      .toBe('Atalanta Fugiens');
  });

  it('falls back to title when display_title is empty', () => {
    expect(bookTitle({ display_title: '', title: 'Atalanta Fugiens' }))
      .toBe('Atalanta Fugiens');
  });
});

describe('sortCollections', () => {
  it('pins specified collections first in order', () => {
    const collections = [
      { slug: 'alchemy', name: 'Alchemy' },
      { slug: 'natural-philosophy', name: 'Natural Philosophy' },
      { slug: 'sacred-texts', name: 'Sacred Texts' },
      { slug: 'classical-philosophy', name: 'Classical Philosophy' },
      { slug: 'hermetica', name: 'Hermetica' },
      { slug: 'renaissance-philosophy', name: 'Renaissance Philosophy' },
    ];

    const sorted = sortCollections(collections);

    // All 6 are pinned — should appear in PINNED_COLLECTION_SLUGS order
    expect(sorted[0].slug).toBe('sacred-texts');
    expect(sorted[1].slug).toBe('classical-philosophy');
    expect(sorted[2].slug).toBe('hermetica');
    expect(sorted[3].slug).toBe('alchemy');
    expect(sorted[4].slug).toBe('natural-philosophy');
    expect(sorted[5].slug).toBe('renaissance-philosophy');
    expect(sorted).toHaveLength(6);
  });

  it('handles subset of pinned collections', () => {
    const collections = [
      { slug: 'alchemy', name: 'Alchemy' },
      { slug: 'hermetica', name: 'Hermetica' },
    ];

    const sorted = sortCollections(collections);
    expect(sorted).toHaveLength(2);
    // Both are pinned — hermetica comes before alchemy in PINNED_COLLECTION_SLUGS
    expect(sorted[0].slug).toBe('hermetica');
    expect(sorted[1].slug).toBe('alchemy');
  });
});

describe('isHighlightMember (#6899)', () => {
  // /collections/maya opened on Herold's Heydenweldt: visible, readable, never tagged `maya`.
  it('rejects a visible, readable book that is not tagged with the collection', () => {
    expect(isHighlightMember({ collections: ['ancient-religion'], pages_count: 412 }, 'maya')).toBe(false);
  });

  it('accepts a tagged book with pages', () => {
    expect(isHighlightMember({ collections: ['maya', 'americas'], pages_count: 300 }, 'maya')).toBe(true);
  });

  it('accepts a tagged artwork without pages, rejects a tagged record with neither', () => {
    expect(isHighlightMember({ collections: ['erotic-art'], pages_count: 0, resource_type: 'print' }, 'erotic-art')).toBe(true);
    expect(isHighlightMember({ collections: ['erotic-art'], pages_count: 0 }, 'erotic-art')).toBe(false);
  });

  it('rejects a missing book and a book whose collections were projected away', () => {
    expect(isHighlightMember(undefined, 'maya')).toBe(false);
    expect(isHighlightMember({ pages_count: 300 }, 'maya')).toBe(false);
  });
});
