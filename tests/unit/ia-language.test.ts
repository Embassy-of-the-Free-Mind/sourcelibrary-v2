import { describe, it, expect } from 'vitest';
import { iaLanguageSignals, iaOcrLanguageDoubt, resolveIaLanguage } from '../../scripts/lib/ia-language.mjs';
import { iaOcrLanguageDoubt as iaOcrLanguageDoubtTs, resolveLanguage } from '@/lib/resolve-language';
import { applyTextRole } from '@/lib/text-role';
import COMBOS_JSON from './fixtures/ia-ocr-lang-script-combos.json';

const COMBOS = COMBOS_JSON as Array<[string | string[], string | string[] | null, number]>;

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

/**
 * #4582. IA's `ocr_detected_lang` is a detector run over IA's own OCR, so on a scan that OCR could
 * not read it names noise at `ocr_detected_lang_conf: 1.0000`. These are the records that surfaced
 * it, as IA publishes them (fetched 2026-10-11).
 */
describe('iaOcrLanguageDoubt', () => {
  const SETHE = {
    ocr_detected_lang: 'ky', ocr_detected_lang_conf: '1.0000',
    ocr_detected_script: ['Arabic', 'Latin', 'Cyrillic', 'HanS', 'HanT', 'Hangul'], language: 'egy',
  };
  const BGA_V = { ocr_detected_lang: 'la', ocr_detected_script: 'Arabic', language: ['ara', 'lat'] };

  it('doubts a detected code the vocabulary cannot name', () => {
    expect(iaOcrLanguageDoubt(SETHE)).toMatch(/not a language in the vocabulary/);
    for (const junk of ['an', 'lb', 'ga', 'qu', 'dz']) {
      expect(iaOcrLanguageDoubt({ ocr_detected_lang: junk, ocr_detected_script: 'Latin' })).toBeTruthy();
    }
  });

  it('doubts a language whose script the OCR did not see', () => {
    expect(iaOcrLanguageDoubt(BGA_V)).toMatch(/Latin but the OCR saw only Arabic/);
    // 48 Latin books were stored Russian this way: `ru` detected over Latin or Fraktur type.
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'ru', ocr_detected_script: 'Fraktur' })).toBeTruthy();
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'ru', ocr_detected_script: 'Cyrillic' })).toBeNull();
  });

  it('accepts the script anywhere in the list, and Fraktur as Latin script', () => {
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'el', ocr_detected_script: ['Latin', 'Greek'] })).toBeNull();
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'de', ocr_detected_script: ['Fraktur', 'Arabic'] })).toBeNull();
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'zh', ocr_detected_script: 'Japanese' })).toBeNull();
  });

  it('does not judge what it cannot: no script, an unknown script name, a many-script language', () => {
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'la' })).toBeNull();
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'la', ocr_detected_script: 'Ogham' })).toBeNull();
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'sa', ocr_detected_script: 'Latin' })).toBeNull();
    expect(iaOcrLanguageDoubt({})).toBeNull();
    expect(iaOcrLanguageDoubt({ ocr_detected_lang: 'und' })).toBeNull();
  });

  it('is the same rule on the route side as on the script side, over every combination IA sent us', () => {
    // 146 distinct (ocr_detected_lang, ocr_detected_script) pairs from 2,297 imported IA items.
    expect(COMBOS.length).toBeGreaterThan(100);
    for (const [lang, script] of COMBOS) {
      const meta = { ocr_detected_lang: lang, ocr_detected_script: script ?? undefined };
      expect(iaOcrLanguageDoubtTs(meta), JSON.stringify(meta)).toBe(iaOcrLanguageDoubt(meta));
    }
  });

  it('lets the catalogue decide when the OCR reading is doubted (Sethe: Kyrgyz -> Egyptian)', () => {
    const r = resolveIaLanguage(SETHE, 'Egyptian hieroglyphs');
    expect(r.language).toBe('Egyptian');
    expect(r.chosen_from).toBe('ia_metadata');
    expect(r.provenance.doubted).toEqual([
      { source: 'ia_ocr_detected', value: 'Ky', why: '"ky" is not a language in the vocabulary' },
    ]);
    expect(resolveIaLanguage(BGA_V, 'Arabic')).toMatchObject({ language: 'Arabic', conflict: false, original_language: null });
  });

  it('lets the caller decide when a doubted reading is all IA has, without calling it a conflict', () => {
    // The six Latin classics stored as Kyrgyz had no catalogue language at all.
    const r = resolveIaLanguage({ ocr_detected_lang: 'ky', ocr_detected_script: 'Fraktur' }, 'Latin');
    expect(r).toMatchObject({ language: 'Latin', chosen_from: 'caller', conflict: false, original_language: null });
    expect(resolveIaLanguage({ ocr_detected_lang: 'ky', ocr_detected_script: 'Fraktur' }, null).language).toBeNull();
  });
});

describe('resolveLanguage with a doubted signal (the import routes)', () => {
  const sethe = () => resolveLanguage({
    callerLanguage: 'Egyptian hieroglyphs',
    sourceSignals: [
      { value: 'ky', source: 'ia_ocr_detected', doubt: iaOcrLanguageDoubtTs({ ocr_detected_lang: 'ky', ocr_detected_script: ['Arabic', 'Latin', 'Cyrillic'] }) },
      { value: 'egy', source: 'ia_metadata' },
      { value: null, source: 'ia_collection' },
    ],
  });

  it('does not store Kyrgyz, and does not cascade into a translation', () => {
    const r = sethe();
    expect(r.language).toBe('Egyptian');
    expect(r.provenance.chosen_from).toBe('ia_metadata');
    // The caller's "Egyptian hieroglyphs" and the catalogue's `egy` are one language: no conflict,
    // so no is_translation, no language_review, and applyTextRole reads an original.
    expect(r).toMatchObject({ conflict: false, is_translation: false, language_review: false, original_language: null });
    const doc: Record<string, unknown> = { language: r.language, title: 'Urkunden des Alten Reichs', ...(r.is_translation ? { is_translation: true } : {}) };
    applyTextRole(doc);
    expect(doc.text_role).toBe('original');
  });

  it('keeps the doubted reading on record with its reason', () => {
    const p = sethe().provenance as { claims: unknown[]; doubted: unknown[] };
    expect(p.claims).toContainEqual({ source: 'ia_ocr_detected', value: 'Ky' });
    expect(p.doubted).toEqual([{ source: 'ia_ocr_detected', value: 'Ky', why: '"ky" is not a language in the vocabulary' }]);
  });

  it('falls to the caller, then to Unknown, when a doubted reading is the only source signal', () => {
    const sig = [{ value: 'ky', source: 'ia_ocr_detected', doubt: 'x' }];
    expect(resolveLanguage({ callerLanguage: 'Latin', sourceSignals: sig })).toMatchObject({ language: 'Latin', conflict: false, is_translation: false });
    expect(resolveLanguage({ sourceSignals: sig }).language).toBe('Unknown');
  });

  it('still lets an undoubted OCR reading beat the catalogue and the caller (#2184)', () => {
    const r = resolveLanguage({
      callerLanguage: 'Latin',
      sourceSignals: [
        { value: 'ru', source: 'ia_ocr_detected', doubt: iaOcrLanguageDoubtTs({ ocr_detected_lang: 'ru', ocr_detected_script: 'Cyrillic' }) },
        { value: 'lat', source: 'ia_metadata' },
      ],
    });
    expect(r).toMatchObject({ language: 'Russian', original_language: 'Latin', conflict: true, language_review: true });
    expect(r.provenance.doubted).toBeUndefined();
  });
});
