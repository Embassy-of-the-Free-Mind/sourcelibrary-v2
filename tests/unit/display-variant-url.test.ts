import { describe, it, expect } from 'vitest';
import { toDisplayVariantUrl, getBookThumbnailUrl } from '@/lib/utils';

const R2 = 'https://images.sourcelibrary.org';

describe('toDisplayVariantUrl (#6092)', () => {
  it('maps the -full.jpg original to the 2000px display sibling', () => {
    expect(toDisplayVariantUrl(`${R2}/artwork/art-08-le-jaloux-full.jpg`)).toBe(`${R2}/artwork/art-08-le-jaloux.jpg`);
    expect(toDisplayVariantUrl(`${R2}/pages/abc/0005-full.jpg?v=2`)).toBe(`${R2}/pages/abc/0005.jpg?v=2`);
    expect(toDisplayVariantUrl(`${R2}/cropped/abc/def-full.jpg`)).toBe(`${R2}/cropped/abc/def.jpg`);
  });

  it('leaves other families and hosts alone', () => {
    // PDF-import blobs and gallery crops have no -full sibling convention.
    expect(toDisplayVariantUrl(`${R2}/books/abc/pages/0001-full.jpg`)).toBe(`${R2}/books/abc/pages/0001-full.jpg`);
    expect(toDisplayVariantUrl('https://upload.wikimedia.org/x-full.jpg')).toBe('https://upload.wikimedia.org/x-full.jpg');
    expect(toDisplayVariantUrl(`${R2}/pages/abc/0005.jpg`)).toBe(`${R2}/pages/abc/0005.jpg`);
    expect(toDisplayVariantUrl(null)).toBeNull();
  });

  it('artwork display size no longer returns the original', () => {
    expect(getBookThumbnailUrl({ image_display: `${R2}/artwork/a-full.jpg` }, 'display')).toBe(`${R2}/artwork/a.jpg`);
    expect(getBookThumbnailUrl({ thumbnail: `${R2}/artwork/a-thumb.jpg` }, 'display')).toBe(`${R2}/artwork/a.jpg`);
    expect(getBookThumbnailUrl({ image_display: `${R2}/artwork/a.jpg` }, 'thumb')).toBe(`${R2}/artwork/a-thumb.jpg`);
  });
});

describe('getBookThumbnailUrl: IA BookReader covers', () => {
  // The BookReader URL serves IA's master whatever size it names (measured 2026-10-29),
  // so a card must never load it; IA's 180px item thumbnail stands in.
  it('maps an archive.org/download page URL to the item thumbnail, on both tiers', () => {
    const t = 'https://archive.org/download/10928485bsb/page/n0/full/pct:15/0/default.jpg';
    expect(getBookThumbnailUrl({ thumbnail: t }, 'display')).toBe('https://archive.org/services/img/10928485bsb');
    expect(getBookThumbnailUrl({ thumbnail: t }, 'thumb')).toBe('https://archive.org/services/img/10928485bsb');
  });

  it('still prefers a stored R2 cover', () => {
    expect(getBookThumbnailUrl({ image_display: `${R2}/pages/abc/0001.jpg`, thumbnail: 'https://archive.org/download/x/page/n0/full/full/0/default.jpg' }, 'display'))
      .toBe(`${R2}/pages/abc/0001.jpg`);
  });
});
