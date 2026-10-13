import { describe, it, expect } from 'vitest';
import { iiifCanvasId, iiifManifestUri, iiifRefsForGalleryItem, withIiifRefs } from '@/lib/iiif-refs';

describe('iiif refs on gallery items (#4289)', () => {
  it('a plate points at the canvas of its page', () => {
    expect(iiifRefsForGalleryItem({ bookId: 'abc', pageNumber: 42 })).toEqual({
      iiifManifest: 'https://sourcelibrary.org/api/iiif/abc/manifest',
      iiifCanvas: 'https://sourcelibrary.org/api/iiif/abc/canvas/p42',
    });
    expect(iiifCanvasId('abc', 42)).toBe(`${iiifManifestUri('abc').replace(/manifest$/, '')}canvas/p42`);
  });

  it('a standalone artwork resolves to the single canvas its manifest synthesises', () => {
    expect(iiifRefsForGalleryItem({ bookId: 'art1', pageNumber: 0, source: 'artwork' }).iiifCanvas)
      .toBe('https://sourcelibrary.org/api/iiif/art1/canvas/p1');
  });

  it('an item with no page and no artwork marker gets the manifest but no guessed canvas', () => {
    expect(iiifRefsForGalleryItem({ bookId: 'cover1', pageNumber: null })).toEqual({
      iiifManifest: 'https://sourcelibrary.org/api/iiif/cover1/manifest',
    });
  });

  it('an item with no book gets nothing', () => {
    expect(iiifRefsForGalleryItem({ bookId: null, pageNumber: 3 })).toEqual({});
  });

  it('withIiifRefs leaves a tenant-scoped body untouched: no apex URL leaves a partner host', () => {
    const body = { items: [{ bookId: 'abc', pageNumber: 2 }], total: 1 };
    expect(withIiifRefs(body, false)).toBe(body);
    expect(JSON.stringify(withIiifRefs(body, false))).not.toContain('sourcelibrary.org');
  });

  it('withIiifRefs keeps every other field and the rest of the body', () => {
    const out = withIiifRefs({ items: [{ bookId: 'abc', pageNumber: 2, description: 'x' }], total: 7 }, true);
    expect(out.total).toBe(7);
    expect(out.items[0]).toMatchObject({ description: 'x', iiifCanvas: 'https://sourcelibrary.org/api/iiif/abc/canvas/p2' });
  });
});
