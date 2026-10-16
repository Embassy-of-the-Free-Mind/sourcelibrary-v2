import { describe, it, expect } from 'vitest';
import { aiLanguageAssessment } from '../../scripts/lib/ai-language-provenance.mjs';

// #4766: six Syriac manuscripts catalogued Hebrew carried `note: 'AI confirmed as "Syriac" (high)'`
// next to `value: Hebrew`. A disagreement must never be stored as a confirmation.
const now = new Date('2026-10-13T00:00:00Z');

describe('aiLanguageAssessment', () => {
  it('records a high-confidence disagreement as a conflict with both claims', () => {
    const e = aiLanguageAssessment('Hebrew', 'Syriac', 'high', now, 'gemini_text');
    expect(e).toMatchObject({ value: 'Hebrew', chosen_from: 'catalogue', conflict: true });
    expect(e.claims).toEqual([
      { source: 'catalogue', value: 'Hebrew' },
      { source: 'gemini_text', value: 'Syriac' },
    ]);
    expect(e.note).toBeUndefined();
  });

  it('never writes "AI confirmed" for a lower-confidence disagreement', () => {
    expect(aiLanguageAssessment('Hebrew', 'Syriac', 'medium', now, 'gemini_text')).toBeNull();
    expect(aiLanguageAssessment('Hebrew', 'Syriac', 'low', now, 'gemini_vision')).toBeNull();
  });

  it('confirms only a real agreement, across registers and codes', () => {
    expect(aiLanguageAssessment('Latin', 'Latin', 'high', now, 'gemini_text')?.note).toBe('AI confirmed as "Latin" (high)');
    expect(aiLanguageAssessment('Hebrew', 'Biblical Hebrew', 'medium', now, 'gemini_text')?.conflict).toBeUndefined();
    expect(aiLanguageAssessment('lat', 'Latin', 'high', now, 'gemini_text')?.note).toMatch(/confirmed/);
  });
});

describe('aiLanguageAssessment — edge values seen in the corpus', () => {
  it('a compound catalogue value is confirmed by any of its parts', () => {
    expect(aiLanguageAssessment('Hebrew and Aramaic', 'Hebrew', 'high', now, 'gemini_text')?.note).toMatch(/confirmed/);
  });
  it('a model answer carrying no language records nothing', () => {
    expect(aiLanguageAssessment('Visual', 'null', 'high', now, 'gemini_vision')).toBeNull();
  });
});
