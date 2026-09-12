import { describe, it, expect } from 'vitest';
import { iaLanguageSignals, resolveIaLanguage } from '../../scripts/lib/ia-language.mjs';

/**
 * Pins the precedence the direct IA importers now follow: IA's own OCR reading beats IA's catalogue
 * record, and both beat the importer's hardcoded value. This is the rule src/lib/resolve-language.ts
 * establishes for the route (#2184/#2185) and that no direct importer applied — they wrote a
 * hardcoded language with `field_provenance: {language:'caller'}` and never read the source.
 *
 * Fixtures are the real disagreements measured on the 2026-09-09 acquisition wave, where IA's
 * ocr_detected_lang was right and the catalogued value wrong in 5 of the 42 cases it covered.
 */
describe('iaLanguageSignals', () => {
  it('puts IA\'s OCR reading ahead of its catalogue record', () => {
    const s = iaLanguageSignals({ ocr_detected_lang: 'fr', language: 'English' });
    expect(s.map((x) => x.source)).toEqual(['ia_ocr_detected', 'ia_metadata']);
    expect(s[0].value).toBe('French');
  });

  it('normalises 2- and 3-letter codes alike', () => {
    // An ad-hoc map that knew 3-letter codes but not 2-letter ones reported 30 false conflicts
    // before this was delegated to the pinned normalizer.
    expect(iaLanguageSignals({ ocr_detected_lang: 'de' })[0].value).toBe('German');
    expect(iaLanguageSignals({ ocr_detected_lang: 'ger' })[0].value).toBe('German');
    expect(iaLanguageSignals({ language: 'lat' })[0].value).toBe('Latin');
  });

  it('drops placeholders rather than treating them as a signal', () => {
    expect(iaLanguageSignals({ ocr_detected_lang: 'und', language: 'none' })).toEqual([]);
    expect(iaLanguageSignals({})).toEqual([]);
  });

  it('takes the first entry when IA sends an array', () => {
    expect(iaLanguageSignals({ language: ['ger', 'lat'] })[0].value).toBe('German');
  });
});

describe('resolveIaLanguage', () => {
  it('lets the source override the importer\'s hardcoded value, and keeps the caller as a work hint', () => {
    // La Bruyère's Les Caractères: stored English, IA's OCR says French.
    const r = resolveIaLanguage({ ocr_detected_lang: 'fr', language: 'English' }, 'English');
    expect(r.language).toBe('French');
    expect(r.original_language).toBe('English');
    expect(r.conflict).toBe(true);
    expect(r.chosen_from).toBe('ia_ocr_detected');
  });

  it('does not flag a conflict when caller and source agree', () => {
    const r = resolveIaLanguage({ ocr_detected_lang: 'de' }, 'German');
    expect(r.language).toBe('German');
    expect(r.conflict).toBe(false);
    expect(r.original_language).toBeNull();
  });

  it('falls back to the caller when IA is silent, and says so in provenance', () => {
    const r = resolveIaLanguage({}, 'Latin');
    expect(r.language).toBe('Latin');
    expect(r.chosen_from).toBe('caller');
    expect(r.conflict).toBe(false);
  });

  it('prefers the OCR reading over the catalogue even when the caller matches the catalogue', () => {
    // Caeremoniale Episcoporum: caller and IA catalogue both said English; the pages are Latin.
    const r = resolveIaLanguage({ ocr_detected_lang: 'la', language: 'English' }, 'English');
    expect(r.language).toBe('Latin');
    expect(r.chosen_from).toBe('ia_ocr_detected');
    expect(r.conflict).toBe(true);
  });

  it('returns no language at all rather than inventing one', () => {
    const r = resolveIaLanguage({}, null);
    expect(r.language).toBeNull();
    expect(r.chosen_from).toBe('none');
  });

  it('records every distinct claim for provenance', () => {
    const r = resolveIaLanguage({ ocr_detected_lang: 'el', language: 'eng' }, 'English');
    expect(r.provenance.claims).toEqual([
      { source: 'caller', value: 'English' },
      { source: 'ia_ocr_detected', value: 'Greek' },
      { source: 'ia_metadata', value: 'English' },
    ]);
    expect(r.provenance.conflict).toBe(true);
  });
});
