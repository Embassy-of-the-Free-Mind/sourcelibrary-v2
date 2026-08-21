import { describe, it, expect } from 'vitest';
import { normalizeLanguageToken, parseLanguageField, languageFamily, sameLanguageFamily } from '@/lib/language-normalize';
import * as twin from '../../scripts/lib/language-normalize.mjs';

/**
 * The language detector (#4117) runs the .mjs twin under plain node; API routes
 * and future read paths run the TS side. If they disagree, the same book gets a
 * different language depending on which door it came through — which is how the
 * corpus ended up with four vocabularies in the first place.
 * (Twin convention: cf. identity-fields-parity.test.ts, r2-key.test.ts.)
 *
 * Fixtures are drawn from values actually observed in production on 2026-08-21:
 * `books.language`, `ai_metadata.secondary_languages`, and the free-text
 * `<language>` tag inside `pages.ocr.data`.
 */

const TOKENS = [
  // straightforward
  'Latin', 'Greek', 'German', 'english', 'FRENCH',
  // codes: ISO-1, ISO-2/3, MARC (the #3893 population)
  'la', 'de', 'grc', 'lat', 'ger', 'gre', 'rus', 'nld', 'ota', 'chu',
  // period variants that must COLLAPSE onto the base language
  'Ancient Greek', 'Modern Greek', 'Classical Latin', 'Koine Greek', 'New Latin',
  // period variants that are DISTINCT languages and must survive
  'Old English', 'Middle High German', 'Early New High German', 'Old French',
  'Church Slavonic', 'Classical Chinese', 'Ottoman Turkish', 'Judeo-Arabic',
  // placeholders — every one of these must be null
  'None', 'none', 'N/A', 'NA', 'und', 'zxx', 'mul', 'unknown', 'auto-detect',
  'Visual', 'undetermined', '', '-', 'Multiple', 'various',
  // the parenthetical / script noise the OCR tag emits
  'Sanskrit (transliterated)', 'undetermined (Voynich script)',
  'Russian (pre-reform)', 'Italian in Italian script', 'Hebrew in Hebrew script',
  // synonyms
  'Geez', "Ge'ez", 'Ethiopic', 'Anglo-Norman', 'Flemish', 'Castilian',
  // unmapped but real — must pass through title-cased, not vanish
  'Tamil', 'Nahuatl', 'Syriac', 'Aramaic', 'Ladino', 'Coptic',
  null, undefined,
];

const FIELDS = [
  // real compound values from books.language (96 of 229 distinct live values)
  'Greek-Latin', 'Hebrew and Aramaic', 'Sanskrit-English', 'German-Latin',
  'Cakchiquel / English', 'English, Greek, Hebrew, Latin', 'French, Latin',
  'Church Slavonic, Greek', 'Arabic and Samaritan Hebrew',
  'Hebrew, Judeo-Arabic and Ladino in Hebrew script',
  'Italian in Italian script, Hebrew in Hebrew script',
  'Arabic, Ottoman Turkish, Persian, Latin, Ternate (a Papuan language), French and Dutch.',
  'Hebrew, Aramaic, and Judeo-Arabic',
  // hyphenated SINGLE languages — must NOT split
  'Judeo-Arabic', 'Anglo-Norman', 'Scottish Gaelic', 'Judeo-Persian',
  // the N/A trap: contains "/" but is a placeholder, not two languages
  'N/A', 'n/a',
  // comma-joined forms the OCR tag emits
  'Latin, Greek', 'Greek, Latin',
  // plain singles and nulls
  'Latin', 'lat', 'None', '', null, undefined,
];

describe('language-normalize TS/mjs parity', () => {
  it('normalizeLanguageToken agrees on every fixture', () => {
    for (const t of TOKENS) {
      expect(twin.normalizeLanguageToken(t), `token: ${JSON.stringify(t)}`)
        .toEqual(normalizeLanguageToken(t));
    }
  });

  it('parseLanguageField agrees on every fixture', () => {
    for (const f of FIELDS) {
      expect(twin.parseLanguageField(f), `field: ${JSON.stringify(f)}`)
        .toEqual(parseLanguageField(f));
    }
  });

  it('languageFamily agrees on every fixture', () => {
    for (const t of TOKENS) {
      const canon = normalizeLanguageToken(t);
      expect(twin.languageFamily(canon), `family: ${JSON.stringify(canon)}`)
        .toEqual(languageFamily(canon));
    }
  });
});

describe('language families', () => {
  /**
   * The artifact this guards: on the first full corpus run,
   * "Chinese + Classical Chinese" was 2,387 of 6,230 apparently-bilingual books
   * — 38% of the headline finding — and every one was the OCR model emitting
   * two labels for a single text. Same trap on the Korean hanmun corpus.
   */
  it('treats historical stages as one language for bilingual purposes', () => {
    expect(sameLanguageFamily('Chinese', 'Classical Chinese')).toBe(true);
    expect(sameLanguageFamily('English', 'Old English')).toBe(true);
    expect(sameLanguageFamily('German', 'Middle High German')).toBe(true);
    expect(sameLanguageFamily('Hebrew', 'Biblical Hebrew')).toBe(true);
  });

  it('still keeps the names distinct for cataloguing', () => {
    expect(normalizeLanguageToken('Classical Chinese')).toBe('Classical Chinese');
    expect(normalizeLanguageToken('Old English')).toBe('Old English');
    expect(languageFamily('Classical Chinese')).toBe('Chinese');
    expect(languageFamily('Latin')).toBe('Latin');
  });

  it('does not merge genuinely different languages', () => {
    expect(sameLanguageFamily('Latin', 'Greek')).toBe(false);
    expect(sameLanguageFamily('Chinese', 'Korean')).toBe(false);
    expect(sameLanguageFamily('German', 'Dutch')).toBe(false);
    expect(sameLanguageFamily('Hebrew', 'Aramaic')).toBe(false);
  });
});

describe('language-normalize behaviour', () => {
  it('collapses period variants onto the base language', () => {
    expect(normalizeLanguageToken('Ancient Greek')).toBe('Greek');
    expect(normalizeLanguageToken('Koine Greek')).toBe('Greek');
    expect(normalizeLanguageToken('Classical Latin')).toBe('Latin');
  });

  it('keeps genuinely distinct period languages apart', () => {
    expect(normalizeLanguageToken('Old English')).toBe('Old English');
    expect(normalizeLanguageToken('Middle High German')).toBe('Middle High German');
    expect(normalizeLanguageToken('Old French')).toBe('Old French');
  });

  it('folds codes, including the MARC set behind #3893', () => {
    for (const [code, name] of [['lat', 'Latin'], ['ger', 'German'], ['gre', 'Greek'], ['grc', 'Greek'], ['de', 'German']]) {
      expect(normalizeLanguageToken(code)).toBe(name);
    }
  });

  it('returns null for every placeholder, so callers can tell "no signal" from a value', () => {
    for (const p of ['None', 'n/a', 'und', 'zxx', 'mul', 'auto-detect', 'Visual', 'undetermined', '']) {
      expect(normalizeLanguageToken(p), `placeholder: ${p}`).toBeNull();
    }
  });

  it('does NOT split N/A into languages named "n" and "a"', () => {
    // The bug this guards: splitting on "/" before the placeholder check made
    // "N/A" look like two languages, which then showed up at 1-2% share across
    // the corpus and read as real signal.
    expect(parseLanguageField('N/A')).toEqual([]);
    expect(parseLanguageField('n/a')).toEqual([]);
  });

  it('splits real compounds but never a hyphenated single language', () => {
    expect(parseLanguageField('Greek-Latin')).toEqual(['Greek', 'Latin']);
    expect(parseLanguageField('Hebrew and Aramaic')).toEqual(['Hebrew', 'Aramaic']);
    expect(parseLanguageField('Cakchiquel / English')).toEqual(['Cakchiquel', 'English']);
    expect(parseLanguageField('Judeo-Arabic')).toEqual(['Judeo-Arabic']);
    expect(parseLanguageField('Anglo-Norman')).toEqual(['Anglo-Norman']);
  });

  it('de-duplicates, which is what kills the "Latin + Latin" rows', () => {
    // 257 books list Latin as a secondary language of Latin; 204 the same for Greek.
    expect(parseLanguageField('Latin, Latin')).toEqual(['Latin']);
    expect(parseLanguageField('Greek and Ancient Greek')).toEqual(['Greek']);
  });

  it('strips the parenthetical and script noise the OCR tag emits', () => {
    expect(normalizeLanguageToken('Sanskrit (transliterated)')).toBe('Sanskrit');
    expect(normalizeLanguageToken('Russian (pre-reform)')).toBe('Russian');
    expect(normalizeLanguageToken('undetermined (Voynich script)')).toBeNull();
    expect(normalizeLanguageToken('Italian in Italian script')).toBe('Italian');
  });
});
