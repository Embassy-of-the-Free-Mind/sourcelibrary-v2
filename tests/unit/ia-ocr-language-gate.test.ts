import { describe, it, expect } from 'vitest';
import { assessIaOcrLanguage, resolveLanguage, type LanguageSignal } from '@/lib/resolve-language';
import { applyTextRole } from '@/lib/text-role';
import { displayLanguage } from '@/lib/language-utils';
import { assessIaOcrLanguage as assessMjs, resolveIaLanguage } from '../../scripts/lib/ia-language.mjs';

/**
 * #4582: IA's `ocr_detected_lang` is derived from IA's own OCR, so on the scripts that OCR cannot
 * read it is confident noise (conf 1.0000 on every fixture below). Each fixture is the real
 * archive.org metadata of a book in the 2026-10-11 conflict set (`chosen_from: ia_ocr_detected`,
 * `conflict: true`), fetched live.
 */
const FIXTURES: Array<{ id: string; ocr: string; scripts: string | string[]; catalog: string | null; caller: string; want: string | null }> = [
  // Lithographed hieroglyphs, read as Kyrgyz across six scripts.
  { id: 'urkundendesaegyp010102steiuoft', ocr: 'ky', scripts: ['Arabic', 'Latin', 'Cyrillic', 'HanS', 'HanT', 'Hangul'], catalog: 'egy', caller: 'Egyptian hieroglyphs', want: 'ocr-multi-script' },
  // Latin Google scans IA called Russian / Greek while itself seeing only Latin script.
  { id: 'bub_gb_7UeWUT1dylYC', ocr: 'ru', scripts: 'Latin', catalog: 'lat', caller: 'Latin', want: 'ocr-script-mismatch' },
  { id: 'flabiouiosepouie00jose', ocr: 'el', scripts: 'Latin', catalog: 'lat', caller: 'Latin', want: 'ocr-script-mismatch' },
  // Kern's Saddharmapundarika (romanised Sanskrit) called Hindi.
  { id: 'SaddharmaPundarikaHKern', ocr: 'hi', scripts: 'Latin', catalog: 'san', caller: 'Sanskrit', want: 'ocr-script-mismatch' },
  // Fraktur is Latin script: a Russian reading of a blackletter Latin scan is the same mismatch.
  { id: 'bub_gb_9I1pe9OQsukC (ru variant)', ocr: 'ru', scripts: 'Fraktur', catalog: 'lat', caller: 'Latin', want: 'ocr-script-mismatch' },
  // One of the six Latin classics stored as "Ky": a code the registry cannot place.
  { id: 'bub_gb_o1HfOXoPkOcC', ocr: 'ky', scripts: 'Fraktur', catalog: 'lat', caller: 'Latin', want: 'ocr-unknown-language' },
  // Codes the registry cannot place: Nepali for Sanskrit, Dzongkha for Tibetan.
  { id: 'CompleteWorksOfSriSankaracharyaIn20Volumes1910Edition', ocr: 'ne', scripts: 'Devanagari', catalog: 'Sanskrit', caller: 'Sanskrit', want: 'ocr-unknown-language' },
  { id: 'dngos-grub-tshe-ring-suhrllekha-2020', ocr: 'dz', scripts: 'Han', catalog: 'tib', caller: 'Sanskrit', want: 'ocr-unknown-language' },
  // De Goeje's BGA: Arabic script OCR'd to Latin-letter noise that reads as Latin (#4582 comment).
  { id: 'BGA I (catalogue silent)', ocr: 'la', scripts: 'Latin', catalog: null, caller: 'Arabic', want: 'ocr-cannot-read-script' },
  // Satapatha Brahmana: IA has no Sanskrit model and answers with a Devanagari neighbour.
  { id: 'satapatha_bahmanam (Devanagari)', ocr: 'mr', scripts: 'Devanagari', catalog: 'Sanskrit', caller: 'Sanskrit', want: 'ocr-same-script-cousin' },
  // Coherent readings keep leading — the 2026-09-09 wave had OCR right 5/5 on Latin-script books.
  { id: 'stoicorumveterum0002arni', ocr: 'el', scripts: 'Greek', catalog: 'lat', caller: 'Latin', want: null },
  { id: 'La Bruyère, Les Caractères', ocr: 'fr', scripts: 'Latin', catalog: 'English', caller: 'English', want: null },
  { id: 'Greek Papyri in the BM', ocr: 'el', scripts: 'Greek', catalog: 'English', caller: 'English', want: null },
  { id: 'patrologiaecursu0001mign', ocr: 'la', scripts: 'Latin', catalog: 'Latin', caller: 'Greek', want: null },
];

describe('assessIaOcrLanguage (#4582)', () => {
  for (const f of FIXTURES) {
    it(`${f.id}: ${f.ocr} → ${f.want ?? 'trusted'}`, () => {
      const args = { ocrLang: f.ocr, ocrScripts: f.scripts, catalogLang: f.catalog, callerLang: f.caller };
      expect(assessIaOcrLanguage(args)).toBe(f.want);
      // The direct importers' twin must reach the same verdict.
      expect(assessMjs(args)).toBe(f.want);
    });
  }

  it('has nothing to judge when IA sent no reading', () => {
    expect(assessIaOcrLanguage({ ocrLang: null, catalogLang: 'lat' })).toBeNull();
    expect(assessIaOcrLanguage({ ocrLang: 'und', catalogLang: 'lat' })).toBeNull();
  });

  it('lets an unknown code stand when it is the only signal there is', () => {
    expect(assessIaOcrLanguage({ ocrLang: 'ky' })).toBeNull();
  });
});

describe('resolveLanguage with a discounted OCR signal', () => {
  const signals = (f: (typeof FIXTURES)[number]): LanguageSignal[] => [
    {
      value: f.ocr,
      source: 'ia_ocr_detected',
      discounted: assessIaOcrLanguage({ ocrLang: f.ocr, ocrScripts: f.scripts, catalogLang: f.catalog, callerLang: f.caller }),
    },
    { value: f.catalog, source: 'ia_metadata' },
  ];

  it('the Urkunden: the cataloguer decides, no translation cascade, the OCR claim is kept', () => {
    const f = FIXTURES.find((x) => x.id === 'urkundendesaegyp010102steiuoft')!;
    const r = resolveLanguage({ callerLanguage: f.caller, sourceSignals: signals(f) });
    expect(r.language).toBe(displayLanguage('egy'));
    expect(r.provenance.chosen_from).toBe('ia_metadata');
    expect(r.is_translation).toBe(false);
    expect(r.conflict).toBe(false);
    expect(r.provenance.claims).toContainEqual({ source: 'ia_ocr_detected', value: 'Ky', discounted: 'ocr-multi-script' });
  });

  it('a Latin Google scan IA called Russian stays Latin', () => {
    const r = resolveLanguage({ callerLanguage: 'Latin', sourceSignals: signals(FIXTURES.find((x) => x.id === 'bub_gb_7UeWUT1dylYC')!) });
    expect(r.language).toBe('Latin');
    expect(r.language_review).toBe(false);
  });

  it('when only the caller is left, it decides — but a person is asked to look', () => {
    const r = resolveLanguage({ callerLanguage: 'Arabic', sourceSignals: signals(FIXTURES.find((x) => x.id.startsWith('BGA I'))!) });
    expect(r.language).toBe('Arabic');
    expect(r.provenance.chosen_from).toBe('caller');
    expect(r.is_translation).toBe(false);
    expect(r.language_review).toBe(true);
  });

  it('a coherent OCR reading still overrides a wrong catalogue (#2184 is unchanged)', () => {
    const f = FIXTURES.find((x) => x.id.startsWith('La Bruy'))!;
    const r = resolveLanguage({ callerLanguage: f.caller, sourceSignals: signals(f) });
    expect(r.language).toBe('French');
    expect(r.provenance.chosen_from).toBe('ia_ocr_detected');
    expect(r.conflict).toBe(true);
  });
});

describe('resolveIaLanguage (direct importers) honours the gate', () => {
  it('drops a Russian reading of a Latin-script scan', () => {
    const r = resolveIaLanguage({ ocr_detected_lang: 'ru', ocr_detected_script: 'Latin', language: 'lat' }, 'Latin');
    expect(r.language).toBe('Latin');
    expect(r.chosen_from).toBe('ia_metadata');
    expect(r.conflict).toBe(false);
    expect(r.provenance.claims).toContainEqual({ source: 'ia_ocr_detected', value: 'Russian', discounted: 'ocr-script-mismatch' });
  });
});

describe('applyTextRole does not cascade an unreviewed language (#4582)', () => {
  it('leaves text_role unset while language_review is open', () => {
    const doc: Record<string, unknown> = { language: 'Ky', original_language: 'Latin', is_translation: true, language_review: true, published: '1890' };
    applyTextRole(doc);
    expect(doc.text_role).toBeUndefined();
  });

  it('still classifies a settled book', () => {
    const doc: Record<string, unknown> = { language: 'Latin', published: '1550' };
    applyTextRole(doc);
    expect(doc.text_role).toBe('original');
  });
});
