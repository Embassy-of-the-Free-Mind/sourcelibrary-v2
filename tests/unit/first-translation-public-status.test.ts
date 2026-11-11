import { describe, it, expect } from 'vitest';
import { publicFirstTranslationStatus } from '@/lib/first-translation/public-status';

// A db with no card and no attempts: the status then rests on the book row alone.
const emptyDb = {
  collection: () => ({
    findOne: async () => null,
    find: () => ({ sort: () => ({ toArray: async () => [] }) }),
  }),
} as never;

const base = { id: 'b1', title: 'T', author: 'A', language: 'Latin', visible: true, pages_translated: 10, pages_count: 10, pages_ocr: 10 };

describe('publicFirstTranslationStatus', () => {
  it('shows the badge only when flag, first-family verdict and translated pages agree', async () => {
    const shown = await publicFirstTranslationStatus(emptyDb, {
      ...base, is_first_translation: true, first_translation: { verdict: 'first_no_prior', evidence_strength: 'strong' },
    });
    expect(shown.badge_shown).toBe(true);
    expect(shown.badge_label).toBe('First Translation');
    expect(shown.claim).toBe('confirmed');

    const noPages = await publicFirstTranslationStatus(emptyDb, {
      ...base, pages_translated: 0, is_first_translation: true, first_translation: { verdict: 'first_no_prior', evidence_strength: 'strong' },
    });
    expect(noPages.badge_shown).toBe(false);
    expect(noPages.badge_label).toBeNull();
  });

  it('weak evidence still badges but is a candidate, not confirmed', async () => {
    const s = await publicFirstTranslationStatus(emptyDb, {
      ...base, is_first_translation: true, first_translation: { verdict: 'first_no_prior', evidence_strength: 'weak' },
    });
    expect(s.badge_shown).toBe(true);
    expect(s.claim).toBe('candidate');
  });

  it('an unflagged book reports no badge', async () => {
    const s = await publicFirstTranslationStatus(emptyDb, { ...base, is_first_translation: false });
    expect(s.badge_shown).toBe(false);
    expect(s.is_first_translation).toBe(false);
  });
});
