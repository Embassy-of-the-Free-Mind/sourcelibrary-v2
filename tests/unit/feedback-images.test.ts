import { describe, it, expect } from 'vitest';
import { isFeedbackImageUrl, sanitizeFeedbackImages, feedbackImageKey } from '@/lib/feedback-images';
import { r2Url } from '@/lib/storage';
import { MAX_FEEDBACK_IMAGES } from '@/lib/feedback-limits';

/**
 * `/api/feedback` stores whatever `images[]` survives `sanitizeFeedbackImages`,
 * and the admin inbox renders it. The inbox is public and unauthenticated, so
 * the only thing standing between a stranger and an <img> in front of the
 * triager is this check: a URL must be one `/api/feedback/upload` could have
 * written, and nothing else.
 */

const good = r2Url('feedback/2026-09/0123456789abcdef.webp');

describe('isFeedbackImageUrl', () => {
  it('accepts exactly what the upload route writes', () => {
    expect(isFeedbackImageUrl(good)).toBe(true);
    expect(isFeedbackImageUrl(r2Url(feedbackImageKey('fedcba9876543210', new Date('2026-01-15T12:00:00Z'))))).toBe(true);
  });

  it('rejects other hosts, other prefixes, and decorated URLs', () => {
    expect(isFeedbackImageUrl('https://evil.example/feedback/2026-09/0123456789abcdef.webp')).toBe(false);
    expect(isFeedbackImageUrl(r2Url('pages/abc/0001.jpg'))).toBe(false);
    expect(isFeedbackImageUrl(r2Url('feedback/../pages/abc/0001.jpg'))).toBe(false);
    expect(isFeedbackImageUrl(good + '?x=1')).toBe(false);
    expect(isFeedbackImageUrl(good + '#f')).toBe(false);
    expect(isFeedbackImageUrl(good.replace('.webp', '.svg'))).toBe(false);
    expect(isFeedbackImageUrl(good.replace('0123456789abcdef', 'ZZZZ'))).toBe(false);
    expect(isFeedbackImageUrl(null)).toBe(false);
    expect(isFeedbackImageUrl(42)).toBe(false);
  });
});

describe('sanitizeFeedbackImages', () => {
  it('drops bad entries, dedupes, and caps the count', () => {
    const many = Array.from({ length: MAX_FEEDBACK_IMAGES + 3 }, (_, i) =>
      r2Url(`feedback/2026-09/${i.toString(16).padStart(16, '0')}.webp`));
    expect(sanitizeFeedbackImages([good, 'javascript:alert(1)', good, ...many]))
      .toEqual([good, ...many.slice(0, MAX_FEEDBACK_IMAGES - 1)]);
  });

  it('is empty for anything that is not an array', () => {
    expect(sanitizeFeedbackImages(undefined)).toEqual([]);
    expect(sanitizeFeedbackImages(good)).toEqual([]);
    expect(sanitizeFeedbackImages({ 0: good })).toEqual([]);
  });
});

describe('feedbackImageKey', () => {
  it('is month-bucketed and content-addressed', () => {
    expect(feedbackImageKey('0123456789abcdef', new Date('2026-09-25T03:00:00Z')))
      .toBe('feedback/2026-09/0123456789abcdef.webp');
  });
});
