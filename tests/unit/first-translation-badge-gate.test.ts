import { describe, it, expect } from 'vitest';
import {
  FIRST_FAMILY_DISPOSITIONS,
  FIRST_FAMILY_VERDICTS,
  FIRST_TRANSLATION_GATE_SB_OR,
  passesFirstTranslationGate,
  withFirstTranslationGate,
} from '@/lib/first-translation/badge-gate';

// The gate must give the book page's answer (FirstTranslationEvidence.tsx): verdict, else the legacy
// disposition, in the first family, AND the stored flag, AND translated pages (#3687).
describe('first-translation badge gate', () => {
  const base = { is_first_translation: true, pages_translated: 10 };

  it('passes a graded first verdict', () => {
    expect(passesFirstTranslationGate({ ...base, first_translation: { verdict: 'first_no_prior' } })).toBe(true);
  });

  it('refuses a flagged book whose verdict is not_first (the 214 frozen-flag books)', () => {
    expect(passesFirstTranslationGate({ ...base, first_translation: { verdict: 'not_first' }, translation_verification: { disposition: 'confirmed_first' } })).toBe(false);
  });

  it('refuses needs_review even when the legacy disposition said first', () => {
    expect(passesFirstTranslationGate({ ...base, first_translation: { verdict: 'needs_review' }, translation_verification: { disposition: 'confirmed_first' } })).toBe(false);
  });

  it('falls back to the legacy disposition only when there is no graded verdict', () => {
    expect(passesFirstTranslationGate({ ...base, translation_verification: { disposition: 'confirmed_first' } })).toBe(true);
    expect(passesFirstTranslationGate({ ...base, translation_verification: { disposition: 'translation_found' } })).toBe(false);
    expect(passesFirstTranslationGate({ ...base })).toBe(false);
  });

  it('needs the flag and translated pages, as the page does', () => {
    expect(passesFirstTranslationGate({ ...base, is_first_translation: false, first_translation: { verdict: 'first_no_prior' } })).toBe(false);
    expect(passesFirstTranslationGate({ ...base, pages_translated: 0, first_translation: { verdict: 'first_no_prior' } })).toBe(false);
  });

  it('reads catalog-row column names too', () => {
    expect(passesFirstTranslationGate({ ...base, ft_verdict: 'first_complete' })).toBe(true);
    expect(passesFirstTranslationGate({ ...base, ft_verdict: 'not_first', ft_disposition: 'confirmed_first' })).toBe(false);
    expect(passesFirstTranslationGate({ ...base, ft_verdict: null, ft_disposition: 'first_from_source' })).toBe(true);
  });

  it('keeps a caller $or intact', () => {
    const q = withFirstTranslationGate({ $or: [{ held_by: 'x' }, { 'image_source.provider': 'x' }] });
    expect(Array.isArray((q as { $and: unknown[] }).$and)).toBe(true);
    expect((q as { $and: Array<Record<string, unknown>> }).$and[0].$or).toBeDefined();
  });

  it('lists the families the page uses, and the Supabase filter names both columns', () => {
    expect(FIRST_FAMILY_VERDICTS).toContain('first_no_prior');
    expect(FIRST_FAMILY_VERDICTS).not.toContain('not_first');
    expect(FIRST_FAMILY_DISPOSITIONS).toContain('confirmed_first');
    expect(FIRST_FAMILY_DISPOSITIONS).not.toContain('translation_found');
    expect(FIRST_TRANSLATION_GATE_SB_OR).toMatch(/^ft_verdict\.in\.\(.+\),and\(ft_verdict\.is\.null,ft_disposition\.in\.\(.+\)\)$/);
  });
});
