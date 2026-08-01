import { describe, it, expect } from 'vitest';
import { buildCoverUpdate, resolvePageCoverUrl, COVER_WRITE_FIELDS, isRenderableCoverUrl, selectFallbackCoverPage } from '@/lib/cover-fields';

const SAMPLE_URL = 'https://images.sourcelibrary.org/cropped/abc/page-1.jpg';
const SAMPLE_THUMB = 'https://images.sourcelibrary.org/thumbnails/abc/page-1-thumb.jpg';

describe('resolvePageCoverUrl', () => {
  it('returns enhanced_photo when present and not split', () => {
    expect(resolvePageCoverUrl({ enhanced_photo: SAMPLE_URL, photo: 'http://other' } as any)).toBe(SAMPLE_URL);
  });

  it('uses photo for split-from-spread pages', () => {
    expect(resolvePageCoverUrl({ split_from_spread: true, photo: SAMPLE_URL, archived_photo: 'http://other' } as any)).toBe(SAMPLE_URL);
  });

  it('falls back through cropped > archived > photo_original > photo', () => {
    expect(resolvePageCoverUrl({ cropped_photo: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
    expect(resolvePageCoverUrl({ archived_photo: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
    expect(resolvePageCoverUrl({ photo_original: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
    expect(resolvePageCoverUrl({ photo: SAMPLE_URL } as any)).toBe(SAMPLE_URL);
  });

  it('rejects relative or empty URLs', () => {
    expect(resolvePageCoverUrl({} as any)).toBeNull();
    expect(resolvePageCoverUrl({ photo: '/api/image?url=foo' } as any)).toBeNull();
  });
});

describe('buildCoverUpdate', () => {
  it('writes all four canonical fields plus dual-write legacy mirrors', () => {
    const update = buildCoverUpdate(
      { archived_photo: SAMPLE_URL, page_number: 5, thumbnail_blob: SAMPLE_THUMB } as any,
      { source: 'manual', actor: 'admin', method: 'cover-picker-ui' },
    );
    expect(update).not.toBeNull();
    expect(update!.image_display).toBe(SAMPLE_URL);
    expect(update!.thumbnail).toBe(SAMPLE_URL);
    expect(update!.image_thumb).toBe(SAMPLE_THUMB);
    expect(update!.thumbnail_blob).toBe(SAMPLE_THUMB);
    expect(update!.thumbnail_source).toBe('manual');
    expect(update!.cover_page).toBe(5);
    expect(update!.field_provenance?.thumbnail.method).toBe('cover-picker-ui');
  });

  it('uses display URL as thumb when page has no pre-generated thumb', () => {
    const update = buildCoverUpdate(
      { archived_photo: SAMPLE_URL, page_number: 1 } as any,
      { source: 'smart_ocr' },
    );
    expect(update!.image_thumb).toBe(SAMPLE_URL);
    expect(update!.thumbnail_blob).toBe(SAMPLE_URL);
  });

  it('returns null when page has no usable image', () => {
    expect(buildCoverUpdate({ page_number: 3 } as any, { source: 'manual' })).toBeNull();
  });

  it('omits cover_page when page has no page_number', () => {
    const update = buildCoverUpdate({ archived_photo: SAMPLE_URL } as any, { source: 'manual' });
    expect(update!.cover_page).toBeUndefined();
  });
});

describe('COVER_WRITE_FIELDS', () => {
  it('includes both legacy and canonical field names', () => {
    expect(COVER_WRITE_FIELDS).toContain('image_display');
    expect(COVER_WRITE_FIELDS).toContain('image_thumb');
    expect(COVER_WRITE_FIELDS).toContain('thumbnail');
    expect(COVER_WRITE_FIELDS).toContain('thumbnail_blob');
    expect(COVER_WRITE_FIELDS).toContain('thumbnail_source');
  });
});

describe('isRenderableCoverUrl', () => {
  it('accepts the hosts the site CSP allows', () => {
    expect(isRenderableCoverUrl('https://images.sourcelibrary.org/archived/abc/8.jpg')).toBe(true);
    expect(isRenderableCoverUrl('https://x.public.blob.vercel-storage.com/a.jpg')).toBe(true);
    expect(isRenderableCoverUrl('https://upload.wikimedia.org/wikipedia/commons/a.jpg')).toBe(true);
  });

  // The whole point of the gate: these load fine with curl but the browser
  // blocks them, so they must never be persisted as a cover.
  it('rejects un-rehosted source hosts and empty values', () => {
    expect(isRenderableCoverUrl('https://archive.org/download/abc/page1.jpg')).toBe(false);
    expect(isRenderableCoverUrl('https://gallica.bnf.fr/ark:/12148/f1.highres')).toBe(false);
    expect(isRenderableCoverUrl('https://dl.ndl.go.jp/api/iiif/123/full/full/0/default.jpg')).toBe(false);
    expect(isRenderableCoverUrl(null)).toBe(false);
    expect(isRenderableCoverUrl(undefined)).toBe(false);
    expect(isRenderableCoverUrl('')).toBe(false);
  });
});

describe('selectFallbackCoverPage', () => {
  const p = (page_number: number, page_type?: string) => ({ page_number, page_type });

  it('prefers a classified title page over anything earlier', () => {
    const pages = [p(0, 'color-card'), p(1, 'blank'), p(2, 'frontispiece'), p(3, 'title-page'), p(4, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(3);
  });

  it('falls back to a frontispiece when there is no title page', () => {
    const pages = [p(0, 'blank'), p(1, 'frontispiece'), p(2, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(1);
  });

  // The regression this exists to prevent: an un-curated scan opens with the
  // digitizer's colour chart, which used to become the book's cover.
  it('skips scanner junk and blanks when nothing is classified', () => {
    const pages = [p(0, 'color-card'), p(1, 'scanner_metadata'), p(2, 'blank'), p(3, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(3);
  });

  it('keeps cover/frontcover leaves eligible — they are good covers, not junk', () => {
    const pages = [p(0, 'frontcover'), p(1, 'text')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(0);
  });

  it('returns the first page rather than nothing when every leaf is junk', () => {
    const pages = [p(0, 'color-card'), p(1, 'blank')];
    expect(selectFallbackCoverPage(pages)?.page_number).toBe(0);
  });

  it('returns undefined for an empty book', () => {
    expect(selectFallbackCoverPage([])).toBeUndefined();
  });
});
