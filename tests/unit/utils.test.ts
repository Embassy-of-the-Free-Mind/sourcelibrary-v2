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

  // Wikimedia: keep the upload.wikimedia.org CDN URL as-is. We must NOT
  // rewrite to commons.wikimedia.org/w/thumb.php — the site CSP img-src
  // whitelists upload.wikimedia.org but not commons.wikimedia.org, so a
  // thumb.php URL is blocked by the browser (loads only via curl).
  it('keeps Wikimedia upload URLs on the whitelisted CDN domain', () => {
    const book = {
      thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Image.jpg',
    };
    const result = getBookThumbnailUrl(book, 'thumb');
    expect(result).toBe('https://upload.wikimedia.org/wikipedia/commons/a/ab/Image.jpg');
    expect(result).not.toContain('commons.wikimedia.org');
  });

  // A bare artwork .jpg is the 2000px display variant; thumb mode must map it
  // down to the 600px -thumb.jpg (the bare 2000px would be ~1.5MB into a ~300px
  // card cell). Display mode keeps the bare .jpg (there's nothing to upgrade).
  it('maps a bare artwork .jpg to -thumb.jpg in thumb mode', () => {
    const book = {
      thumbnail: 'https://images.sourcelibrary.org/artwork/some-image.jpg',
      thumbnail_blob: 'https://images.sourcelibrary.org/artwork/some-image.jpg',
    };
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/artwork/some-image.jpg');
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/artwork/some-image-thumb.jpg');
  });

  // Regression for /collections/hermetic-image low-res grid (2026-06-03):
  // ~98% of artworks store a 150px book-thumbnails/{id}-thumb.jpg in image_thumb
  // while their real high-res lives at artwork/art-*.jpg (with a 600px -thumb).
  // thumb mode must prefer the 600px artwork thumb over the 150px book-thumbnail.
  it('prefers the 600px artwork thumb over a 150px book-thumbnails image_thumb', () => {
    const book = {
      image_display: 'https://images.sourcelibrary.org/artwork/art-khunrath.jpg',
      image_thumb: 'https://images.sourcelibrary.org/book-thumbnails/abc123-thumb.jpg',
      thumbnail: 'https://images.sourcelibrary.org/artwork/art-khunrath.jpg',
    };
    // Was returning the 150px book-thumbnails URL → 4x upscale in card cells.
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/artwork/art-khunrath-thumb.jpg');
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/artwork/art-khunrath.jpg');
  });

  // Non-artwork books keep using image_thumb (their pages/ thumbnails are the
  // right source — the artwork exception must not touch them).
  it('keeps image_thumb for non-artwork books', () => {
    const book = {
      image_display: 'https://images.sourcelibrary.org/pages/abc/0002.jpg',
      image_thumb: 'https://images.sourcelibrary.org/pages/abc/0002-thumb.jpg',
    };
    expect(getBookThumbnailUrl(book, 'thumb')).toBe('https://images.sourcelibrary.org/pages/abc/0002-thumb.jpg');
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

describe('getBookThumbnailUrl — browser-renderability screen', () => {
  // A stored cover the browser cannot load must read as "no cover" (null), so
  // cards render the typographic placeholder instead of an <Image> stuck in
  // its shimmer state (the pre-hydration CSP block means onError never runs).
  it('returns null for archive.org/download covers (302s off the CSP allowlist)', () => {
    const book = { thumbnail: 'https://archive.org/download/some_item/page/n0/full/pct:15/0/default.jpg' };
    expect(getBookThumbnailUrl(book, 'display')).toBeNull();
    expect(getBookThumbnailUrl(book, 'thumb')).toBeNull();
  });

  it('returns null for hosts absent from the CSP img-src allowlist', () => {
    expect(getBookThumbnailUrl({ thumbnail: 'https://example.com/cover.jpg' }, 'display')).toBeNull();
  });

  it('keeps covers on newly-allowlisted library hosts', () => {
    const url = 'https://mps.lib.harvard.edu/sds/view/12345?width=400';
    expect(getBookThumbnailUrl({ thumbnail: url }, 'display')).toBe(url);
  });

  it('trims stray whitespace from stored cover URLs', () => {
    const book = { thumbnail: 'https://images.sourcelibrary.org/pages/abc/0001.jpg\n' };
    expect(getBookThumbnailUrl(book, 'display')).toBe('https://images.sourcelibrary.org/pages/abc/0001.jpg');
  });
});
