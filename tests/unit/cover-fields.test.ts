import { describe, it, expect } from 'vitest';
import { buildCoverUpdate, resolvePageCoverUrl, COVER_WRITE_FIELDS } from '@/lib/cover-fields';

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
