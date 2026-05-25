import { describe, it, expect } from 'vitest';
import { normalizeText, isUsableImageUrl, isArchiveFailed, getPageImageUrl, getBookThumbnailUrl, getCoverImageCandidates } from '@/lib/utils';

describe('normalizeText', () => {
  it('lowercases text', () => {
    expect(normalizeText('HELLO')).toBe('hello');
  });

  it('strips diacritics', () => {
    expect(normalizeText('Dürer')).toBe('durer');
    expect(normalizeText('café')).toBe('cafe');
    expect(normalizeText('señor')).toBe('senor');
  });

  it('trims whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('handles combined transformations', () => {
    expect(normalizeText('  René Descartes  ')).toBe('rene descartes');
  });
});

describe('isUsableImageUrl', () => {
  it('accepts https URLs', () => {
    expect(isUsableImageUrl('https://example.com/image.jpg')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isUsableImageUrl('http://example.com/image.jpg')).toBe(true);
  });

  it('rejects null', () => {
    expect(isUsableImageUrl(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isUsableImageUrl(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isUsableImageUrl('')).toBe(false);
  });

  it('rejects failed markers', () => {
    expect(isUsableImageUrl('failed:HTTP 404')).toBe(false);
  });

  it('rejects data URIs', () => {
    expect(isUsableImageUrl('data:image/png;base64,abc')).toBe(false);
  });
});

describe('isArchiveFailed', () => {
  it('detects failed: prefix', () => {
    expect(isArchiveFailed('failed:HTTP 404')).toBe(true);
    expect(isArchiveFailed('failed:timeout')).toBe(true);
  });

  it('rejects normal URLs', () => {
    expect(isArchiveFailed('https://example.com/img.jpg')).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(isArchiveFailed(null)).toBe(false);
    expect(isArchiveFailed(undefined)).toBe(false);
  });
});

describe('getPageImageUrl', () => {
  it('prefers cropped_photo', () => {
    expect(getPageImageUrl({
      cropped_photo: 'https://r2.example.com/cropped.jpg',
      archived_photo: 'https://r2.example.com/archived.jpg',
      photo_original: 'https://ia.example.com/original.jpg',
      photo: 'https://ia.example.com/photo.jpg',
    })).toBe('https://r2.example.com/cropped.jpg');
  });

  it('falls back to archived_photo', () => {
    expect(getPageImageUrl({
      archived_photo: 'https://r2.example.com/archived.jpg',
      photo_original: 'https://ia.example.com/original.jpg',
    })).toBe('https://r2.example.com/archived.jpg');
  });

  it('returns null when archive failed (source URLs assumed dead)', () => {
    expect(getPageImageUrl({
      archived_photo: 'failed:HTTP 404',
      photo_original: 'https://ia.example.com/original.jpg',
      photo: 'https://ia.example.com/photo.jpg',
    })).toBeNull();
  });

  it('falls back to photo_original when no archived version', () => {
    expect(getPageImageUrl({
      photo_original: 'https://ia.example.com/original.jpg',
      photo: 'https://ia.example.com/photo.jpg',
    })).toBe('https://ia.example.com/original.jpg');
  });

  it('falls back to photo as last resort', () => {
    expect(getPageImageUrl({
      photo: 'https://ia.example.com/photo.jpg',
    })).toBe('https://ia.example.com/photo.jpg');
  });

  it('returns null when no images available', () => {
    expect(getPageImageUrl({})).toBeNull();
  });
});

describe('getBookThumbnailUrl', () => {
  // Artwork URLs: -thumb vs -full routing
  it('returns -thumb.jpg for artwork URLs in thumb mode', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/goltzius-full.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/goltzius-thumb.jpg',
    };
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/artwork/goltzius-thumb.jpg');
  });

  it('returns -full.jpg for artwork URLs in display mode', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/goltzius-full.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/goltzius-thumb.jpg',
    };
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/artwork/goltzius-full.jpg');
  });

  it('rewrites artwork -thumb to -full in display mode', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/durer-thumb.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/durer-thumb.jpg',
    };
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/artwork/durer-full.jpg');
  });

  it('rewrites artwork -full to -thumb in thumb mode', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/durer-full.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/durer-full.jpg',
    };
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/artwork/durer-thumb.jpg');
  });

  // Archived book URLs: rewrite to /pages/ with size suffix
  it('rewrites /archived/ URLs to /pages/ with -thumb suffix', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/archived/abc123/5.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/archived/abc123/5.jpg',
    };
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/pages/abc123/0005-thumb.jpg');
  });

  it('rewrites /archived/ URLs to /pages/ display size', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/archived/abc123/5.jpg',
    };
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/pages/abc123/0005.jpg');
  });

  // Wikimedia: rewrite to thumb.php
  it('rewrites Wikimedia URLs to thumb.php', () => {
    const book = {
      thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Image.jpg',
    };
    const result = getBookThumbnailUrl(book, 'thumb');
    expect(result).toContain('thumb.php');
    expect(result).toContain('w=400');
  });

  // Artwork URLs without -thumb or -full suffix should pass through
  it('passes through artwork URLs without size suffix', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/some-image.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/some-image.jpg',
    };
    // Display: no -thumb to rewrite, passes through
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/artwork/some-image.jpg');
    // Thumb: no -full to rewrite, passes through
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/artwork/some-image.jpg');
  });

  // Default size is 'display'
  it('defaults to display size', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/test-full.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/test-thumb.jpg',
    };
    expect(getBookThumbnailUrl(book)).toBe('https://images.sourcelibrary.org/artwork/test-full.jpg');
  });

  // Null handling
  it('returns null when no thumbnail', () => {
    expect(getBookThumbnailUrl({}, 'display')).toBeNull();
    expect(getBookThumbnailUrl({ thumbnail: null, thumbnail_blob: null }, 'thumb')).toBeNull();
  });
});

describe('getCoverImageCandidates', () => {
  it('rewrites book thumbnail then adds page fallbacks', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/archived/abc123/1.jpg',
      thumbnail_blob: null as string | null,
    };
    const pages = [
      { photo: 'https://images.sourcelibrary.org/pages/abc123/0002.jpg' },
    ];
    const c = getCoverImageCandidates(book, pages);
    expect(c[0]).toContain('/pages/abc123/0001.jpg');
    expect(c.some((u) => u.includes('0002'))).toBe(true);
  });

  it('uses first page when book has no thumbnails', () => {
    const book = {};
    const pages = [{ photo: 'https://images.sourcelibrary.org/pages/xyz/0001.jpg' }];
    const c = getCoverImageCandidates(book, pages);
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c[0]).toContain('-thumb.jpg');
  });
});
