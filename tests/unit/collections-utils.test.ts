import { describe, it, expect } from 'vitest';
import { sanitizeThumbnail, bookTitle, PINNED_COLLECTION_SLUGS, sortCollections } from '@/lib/collections-utils';

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
