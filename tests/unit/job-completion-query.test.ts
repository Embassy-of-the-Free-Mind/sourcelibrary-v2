import { describe, it, expect } from 'vitest';
import { getCompletionQuery } from '@/lib/job-completion';

/**
 * #4839: image-extraction completion counted pages carrying `detected_images`. A candidate page the
 * model looked at and found no illustrations on never gets that field — the writer refuses to
 * overwrite existing detections with an empty array — so it was paid for and permanently
 * uncounted, and the job could never reach its total.
 */
describe('getCompletionQuery — image extraction counts ATTEMPTS, not detections', () => {
  const createdAt = new Date('2026-09-15T10:00:00Z');

  it('counts pages extracted during this run', () => {
    const query = getCompletionQuery('b1', ['p1', 'p2'], 'image_extraction', createdAt) as Record<string, any>;

    expect(query.image_extraction_updated_at).toEqual({ $gte: createdAt });
    expect(query.detected_images).toBeUndefined();
  });

  it('does not count an extraction that predates the job — a stale result cannot close a new run', () => {
    const query = getCompletionQuery('b1', ['p1'], 'image_extraction', createdAt) as Record<string, any>;

    expect(query.image_extraction_updated_at.$gte).toBe(createdAt);
  });

  it('falls back to the old predicate without a job timestamp (under-counts, never over-counts)', () => {
    const query = getCompletionQuery('b1', ['p1'], 'image_extraction') as Record<string, any>;

    expect(query.detected_images).toEqual({ $exists: true });
  });

  it('leaves OCR and translation predicates untouched', () => {
    const ocr = getCompletionQuery('b1', ['p1'], 'ocr', createdAt) as Record<string, any>;
    const translation = getCompletionQuery('b1', ['p1'], 'translation', createdAt) as Record<string, any>;

    expect(ocr['ocr.data']).toEqual({ $exists: true, $nin: [null, ''] });
    expect(translation['translation.data']).toEqual({ $exists: true, $nin: [null, ''] });
  });
});
