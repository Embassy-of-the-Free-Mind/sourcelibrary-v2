import { describe, it, expect } from 'vitest';
import {
  buildGalleryDoc,
  galleryImageUrl,
  GALLERY_DOC_KEYS,
  GALLERY_DOC_OPTIONAL_KEYS,
} from '@/lib/gallery-doc';
import {
  buildGalleryDoc as buildGalleryDocJs,
  galleryImageUrl as galleryImageUrlJs,
  GALLERY_DOC_KEYS as GALLERY_DOC_KEYS_JS,
  GALLERY_DOC_OPTIONAL_KEYS as GALLERY_DOC_OPTIONAL_KEYS_JS,
} from '../../scripts/lib/gallery-doc.mjs';

// `gallery_images` is written by four paths that historically drifted apart
// (#2531). A freshly-extracted image was invisible on the gallery read path
// (which requires `book_visible` + `image_url`) until a separate sync ran.
// These tests pin the canonical field set across the two JS twins so a future
// edit to one without the other fails CI. The two Mongo-aggregation writers
// (admin sync route + sync-worker) build docs server-side via `$project` and
// must mirror GALLERY_DOC_KEYS by hand — see the helper module docs.

const PAGE = {
  id: 'page123',
  book_id: 'book999',
  page_number: 42,
  archived_photo: 'https://images.sourcelibrary.org/archived/book999/42.jpg',
  photo: 'https://images.sourcelibrary.org/pages/book999/0042-full.jpg',
};

const BOOK = {
  id: 'book999',
  display_title: 'Atalanta Fugiens',
  title: 'Atalanta',
  author: 'Michael Maier',
  year: 1617,
  language: 'la',
  visible: true,
  hidden: false,
  image_source: { provider: 'internet-archive' },
};

const DETECTION = {
  bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  description: 'An emblem',
  type: 'engraving',
  gallery_quality: 0.85,
  gallery_rationale: 'figural emblem',
  museum_description: 'A compelling allegorical scene.',
  detection_source: 'vision_model',
  model: 'gemini-3-flash-preview',
  detected_at: new Date('2026-06-22T00:00:00Z'),
  metadata: { subjects: ['alchemy'] },
  confidence: 0.9,
};

const baseArgs = {
  page: PAGE,
  book: BOOK,
  detectedImage: DETECTION,
  index: 0,
  now: new Date('2026-06-22T00:00:00Z'),
};

describe('gallery-doc twins stay in sync', () => {
  it('both twins export an identical canonical key list', () => {
    expect([...GALLERY_DOC_KEYS]).toEqual([...GALLERY_DOC_KEYS_JS]);
    expect([...GALLERY_DOC_OPTIONAL_KEYS]).toEqual([...GALLERY_DOC_OPTIONAL_KEYS_JS]);
  });

  it('both twins produce the same document for the same input', () => {
    const ts = buildGalleryDoc(baseArgs as never);
    const js = buildGalleryDocJs(baseArgs);
    expect(ts).toEqual(js);
  });

  it('galleryImageUrl twins agree', () => {
    expect(galleryImageUrl(PAGE)).toBe(galleryImageUrlJs(PAGE));
  });
});

describe('buildGalleryDoc produces the canonical schema', () => {
  it('emits exactly the base key set (no rank/scan unless supplied)', () => {
    const doc = buildGalleryDoc(baseArgs as never);
    expect(Object.keys(doc).sort()).toEqual([...GALLERY_DOC_KEYS].sort());
  });

  it('includes the fields the gallery read path requires (#2531 regression)', () => {
    const doc = buildGalleryDoc(baseArgs as never);
    // These three were the silent omissions that left images invisible.
    expect(doc.book_visible).toBe(true);
    expect(doc.image_url).toBe(PAGE.archived_photo);
    expect(doc.page_number).toBe(42);
    expect(doc.id).toBe('page123-0');
    expect(doc.book_provider).toBe('internet-archive');
  });

  it('carries AI provenance (model + detected_at)', () => {
    const doc = buildGalleryDoc(baseArgs as never);
    expect(doc.model).toBe('gemini-3-flash-preview');
    expect(doc.detected_at).toEqual(DETECTION.detected_at);
  });

  it('book_visible defaults to false when the book is missing/unknown', () => {
    const doc = buildGalleryDoc({ ...baseArgs, book: null } as never);
    expect(doc.book_visible).toBe(false);
    expect(doc.book_title).toBe('Unknown');
  });

  it('omits book_rank/scan_quality unless supplied; includes them when given', () => {
    const plain = buildGalleryDoc(baseArgs as never);
    expect(plain).not.toHaveProperty('book_rank');
    expect(plain).not.toHaveProperty('scan_quality');

    const enriched = buildGalleryDoc({
      ...baseArgs,
      bookRank: 3,
      scanQuality: { scan_class: 'color_photo', source: 'page_inherited' },
      pageImageCharacteristics: { megapixels: 4 },
    } as never);
    expect(enriched.book_rank).toBe(3);
    expect(enriched.scan_quality).toMatchObject({ scan_class: 'color_photo' });
    expect(enriched.page_image_characteristics).toMatchObject({ megapixels: 4 });
  });

  it('uses a scan-adjusted gallery_quality when passed explicitly', () => {
    const doc = buildGalleryDoc({ ...baseArgs, galleryQuality: 0.55 } as never);
    expect(doc.gallery_quality).toBe(0.55);
  });

  it('image_url prefers the full-page source, never the crop', () => {
    // extracted_url is the crop; the lens magnifier crops on the fly from the
    // full page, so image_url must resolve to the page-display source.
    const doc = buildGalleryDoc({
      ...baseArgs,
      detectedImage: { ...DETECTION, extracted_url: 'https://crop.example/x.jpg' },
    } as never);
    expect(doc.image_url).toBe(PAGE.archived_photo);
    expect(doc.extracted_url).toBe('https://crop.example/x.jpg');
  });
});
