import { describe, expect, it } from 'vitest';

import { hasExistingTranslationContent } from '@/lib/translation-request-cta';

describe('hasExistingTranslationContent', () => {
  it('returns true when the page already has translation text', () => {
    expect(hasExistingTranslationContent({ translationText: 'Existing translation' })).toBe(true);
  });

  it('returns true when the page has translation metadata but no visible text yet', () => {
    expect(hasExistingTranslationContent({ translationUpdatedAt: '2026-07-01T00:00:00.000Z' })).toBe(true);
  });

  it('returns false when there is no translation content or metadata', () => {
    expect(hasExistingTranslationContent({ translationText: '', translationData: '', translationUpdatedAt: null })).toBe(false);
  });
});
