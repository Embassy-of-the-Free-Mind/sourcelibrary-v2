import { describe, it, expect } from 'vitest';
import { tierFromTags, isCrossScriptTradition } from '../../scripts/audit/language-review-triage.mjs';
import {
  classifyLanguageContent,
  classifyPageSample,
  toClassifierKey,
  formatDetectedLanguage,
  RELIABLE_CATALOGUE_LANGS,
} from '../../scripts/lib/language-content-classify.mjs';

/**
 * Guards for the `language_review` triage (#3958).
 *
 * The routing this pins is not cosmetic. Two of these rules exist because a
 * sweep that got them wrong nearly relabelled 547 books, and a third because the
 * largest apparent-mislabel cluster in the corpus is not a mislabel at all. A
 * tier is a routing claim about published metadata, so the classes that must
 * NEVER be auto-cleared or auto-flipped are pinned here rather than left to a
 * comment.
 */

/** Minimal detector row, in the shape `detect-book-languages.mjs` writes. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'x', bucket: 'agree', catalogued: ['Latin'],
  shares: [['Latin', 0.98, 200]], proposed_languages: ['Latin'], ...over,
});
const book = (language: string) => ({ id: 'x', title: 't', language });

describe('tierFromTags — the clear tiers', () => {
  it('clears a book whose pages match the catalogue', () => {
    expect(tierFromTags(book('Latin'), row()).tier).toBe('clear');
  });

  it('clears `add_second` — an incomplete catalogue is a #4117 job, not a review hold', () => {
    const v = tierFromTags(book('German'), row({
      bucket: 'add_second', catalogued: ['German'],
      shares: [['German', 0.61, 61], ['Latin', 0.38, 38]],
    }));
    expect(v.tier).toBe('clear');
  });
});

describe('tierFromTags — the hanmun class must never be flipped', () => {
  // 211 of the detector's ~1,015 apparent mislabels. Joseon scholarly works are
  // written in literary Chinese; provenance and readership are Korean. Both facts
  // are true. Auto-flipping `language` here destroys the correct record.
  it('routes Korean -> Classical Chinese to clear_tradition, never a defect', () => {
    const v = tierFromTags(book('Korean'), row({
      bucket: 'contradict', catalogued: ['Korean'],
      shares: [['Classical Chinese', 0.99, 300]],
    }));
    expect(v.tier).toBe('clear_tradition');
    expect(v.tier).not.toMatch(/^defect/);
  });

  it('routes Tibetan -> Sanskrit the same way', () => {
    const v = tierFromTags(book('Tibetan'), row({
      bucket: 'contradict', catalogued: ['Tibetan'],
      shares: [['Sanskrit', 0.95, 120]],
    }));
    expect(v.tier).toBe('clear_tradition');
  });

  it('matches by family, so plain `Chinese` and `Literary Chinese` both count', () => {
    expect(isCrossScriptTradition(['Korean'], ['Chinese'])).toBe(true);
    expect(isCrossScriptTradition(['Korean'], ['Literary Chinese'])).toBe(true);
    expect(isCrossScriptTradition(['Japanese'], ['Classical Chinese'])).toBe(true);
  });

  it('does not fire on an unrelated pair', () => {
    expect(isCrossScriptTradition(['Greek'], ['Latin'])).toBe(false);
    expect(isCrossScriptTradition(['German'], ['French'])).toBe(false);
  });

  it('does NOT treat Latin-in-vernacular as a tradition — it is indistinguishable from #3261', () => {
    // Deliberately absent from CROSS_SCRIPT_TRADITIONS: auto-clearing it would
    // hide the source-vs-edition defect it looks exactly like.
    expect(isCrossScriptTradition(['Italian'], ['Latin'])).toBe(false);
  });
});

describe('tierFromTags — splitting `contradict` into its two defect classes', () => {
  // #4181's distinction. Present-but-not-dominant is a Latin edition of a Greek
  // author (#3261, fix is language -> edition, source -> original_language, gated
  // on text_role). Wholly absent is the real mislabel (#2184).
  it('present but not dominant -> defect_edition', () => {
    const v = tierFromTags(book('Greek'), row({
      bucket: 'contradict', catalogued: ['Greek'],
      shares: [['Latin', 0.99, 330], ['Greek', 0.04, 13]],
    }));
    expect(v.tier).toBe('defect_edition');
  });

  it('absent from its own pages -> defect_record', () => {
    const v = tierFromTags(book('Arabic'), row({
      bucket: 'contradict', catalogued: ['Arabic'],
      shares: [['Latin', 0.99, 400]],
    }));
    expect(v.tier).toBe('defect_record');
  });

  it('a zero-page share does not count as present', () => {
    const v = tierFromTags(book('Greek'), row({
      bucket: 'contradict', catalogued: ['Greek'],
      shares: [['Latin', 0.99, 400], ['Greek', 0, 0]],
    }));
    expect(v.tier).toBe('defect_record');
  });
});

describe('tierFromTags — no verdict without evidence', () => {
  it.each(['no_tag', 'thin', 'unparsed'])('returns null for `%s` so the caller falls back', (bucket) => {
    expect(tierFromTags(book('Latin'), row({ bucket }))).toBeNull();
  });

  it.each(['unsupported_claim', 'no_catalogue_value', 'error'])('routes `%s` to unclear', (bucket) => {
    expect(tierFromTags(book('Latin'), row({ bucket })).tier).toBe('unclear');
  });

  it('never invents a clear tier from an unknown bucket', () => {
    expect(tierFromTags(book('Latin'), row({ bucket: 'something_new' }))).toBeNull();
  });
});

describe('content classifier — the fallback and its blind spot', () => {
  it('reads a Latin body as Latin', () => {
    const r = classifyLanguageContent('quod est in principio et non est aliud cum hoc esse per se');
    expect(r.dominant).toBe('latin');
  });

  it('reads a German body as German', () => {
    const r = classifyLanguageContent('der die das und ist von zu den nicht mit auch ein auf im dem');
    expect(r.dominant).toBe('german');
  });

  it('strips the OCR metadata block so a language tag cannot vote on the body', () => {
    const tagged = '<language>German</language>' + ' quod est in principio et non est aliud cum hoc esse';
    expect(classifyLanguageContent(tagged).dominant).toBe('latin');
  });

  it('only trusts itself for Latin and Greek — every other script is invisible to it', () => {
    // A near-zero density for Arabic/Hebrew/Sanskrit/Chinese is an artifact of the
    // instrument, not evidence the language is absent. Gating on this set is what
    // stops the fallback manufacturing mislabels.
    expect([...RELIABLE_CATALOGUE_LANGS].sort()).toEqual(['greek', 'latin']);
    expect(RELIABLE_CATALOGUE_LANGS.has('arabic')).toBe(false);
    expect(RELIABLE_CATALOGUE_LANGS.has('chinese')).toBe(false);
  });

  it('weights a multi-page sample by word count', () => {
    const r = classifyPageSample([
      'der die das und ist von zu den nicht mit auch ein auf im dem sich des wird',
      'der die das und ist von zu den nicht',
    ]);
    expect(r.dominant).toBe('german');
    expect(r.words).toBeGreaterThan(20);
  });

  it('survives an empty sample without throwing', () => {
    expect(() => classifyPageSample([])).not.toThrow();
    expect(classifyPageSample([]).words).toBe(0);
  });

  it('round-trips catalogue name -> classifier key -> canonical name', () => {
    expect(toClassifierKey('Ancient Greek')).toBe('greek');
    expect(formatDetectedLanguage('greek')).toBe('Greek');
    expect(toClassifierKey(formatDetectedLanguage('german'))).toBe('german');
  });
});
