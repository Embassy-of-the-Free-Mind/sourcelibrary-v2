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
