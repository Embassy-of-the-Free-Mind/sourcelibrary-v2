import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs audit script, no types
import { classify, isArtworkRecord, findExtractedSiblings } from '../../scripts/audit/image-extraction-coverage.mjs';

const ev = (o = {}) => ({ galleryRows: 0, gradePages: 0, typedPages: 0, strongTyped: 0, markerPages: null, ...o });

describe('image-extraction-coverage: classify (#4241)', () => {
  it('a gallery row is the only thing that counts as extracted', () => {
    expect(classify({ pages_ocr: 10, detected_images_count: 5 }, ev({ galleryRows: 3 }))).toBe('extracted');
    expect(classify({ pages_ocr: 10, detected_images_count: 5 }, ev())).toBe('examined_empty');
  });

  it('gallery-grade detections with no gallery row are unmaterialized, even with no rollup field', () => {
    // The shape --reconcile could not see: the rollup is written BY materialization.
    expect(classify({ pages_ocr: 700 }, ev({ gradePages: 105 }))).toBe('unmaterialized');
  });

  it('a book stamped no_candidates is not a measured zero', () => {
    const book = { pages_ocr: 700, pipeline_auto: { images_skipped_reason: 'no_candidates' } };
    expect(classify(book, ev())).toBe('no_candidates');
    // …and joins the queue once its pages are typed or its markers are read.
    expect(classify(book, ev({ typedPages: 4, strongTyped: 2 }))).toBe('queue');
    expect(classify(book, ev({ markerPages: 9 }))).toBe('queue');
  });

  it('a title page alone is not evidence of a plate', () => {
    expect(classify({ pages_ocr: 90 }, ev({ typedPages: 1, strongTyped: 0 }))).toBe('queue_weak');
  });

  it('an un-OCRd book is unknown, not empty', () => {
    expect(classify({ pages_ocr: 0 }, ev())).toBe('never_ocr');
    expect(classify({ pages_ocr: 40 }, ev())).toBe('no_evidence');
  });

  it('keeps the Babad chronicle: an explicit non-artwork content_type wins over resource_type', () => {
    expect(isArtworkRecord({ content_type: 'text', resource_type: 'text' })).toBe(false);
    expect(isArtworkRecord({ content_type: 'artwork', resource_type: 'print' })).toBe(true);
    expect(isArtworkRecord({ resource_type: 'painting' })).toBe(true);
    expect(isArtworkRecord({ content_type: 'book' })).toBe(false);
  });
});

describe('image-extraction-coverage: extracted siblings (#4241)', () => {
  const extracted = [
    { id: 'done-integrum', work_id: 'w:other', author: 'Fludd, Robert', title: 'Integrum Morborum Mysterium' },
    { id: 'done-cosmi-1', work_id: 'w:cosmi', author: 'Robert Fludd', title: 'Utriusque Cosmi Historia, Volume 1' },
  ];

  it('finds another copy filed under a different work_id by author + title', () => {
    const got = findExtractedSiblings([{ id: 'q1', work_id: 'w:fragment', author: 'Robert Fludd', title: 'Integrum morborum mysterium, sive medicinae catholicae' }], extracted);
    expect(got.get('q1')).toEqual({ id: 'done-integrum', via: 'title' });
  });

  it('prefers a shared work_id', () => {
    const got = findExtractedSiblings([{ id: 'q2', work_id: 'w:cosmi', author: 'Robert Fludd', title: 'Something else entirely here' }], extracted);
    expect(got.get('q2')).toEqual({ id: 'done-cosmi-1', via: 'work_id' });
  });

  it('volume 2 is not a copy of volume 1', () => {
    const got = findExtractedSiblings([{ id: 'q3', work_id: 'w:x', author: 'Robert Fludd', title: 'Utriusque Cosmi Historia, Volume 2' }], extracted);
    expect(got.has('q3')).toBe(false);
  });

  it('a title that cannot be folded is unjudged, never "no sibling"', () => {
    const got = findExtractedSiblings([
      { id: 'q4', author: '李時珍', title: '本草綱目' },
      { id: 'q5', author: 'Boethius', title: 'Works' },
      { id: 'q6', title: 'Theatrum Chemicum Britannicum' },
    ], extracted);
    expect(got.get('q4')).toBe('unjudged');
    expect(got.get('q5')).toBe('unjudged');
    expect(got.get('q6')).toBe('unjudged');
  });
});
