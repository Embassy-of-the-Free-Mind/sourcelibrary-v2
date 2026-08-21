/**
 * Ngram viewer guards (issue #3175):
 *  1. PARITY — scripts/lib/ngram-normalize.mjs (writes the ngram keys at build
 *     time) and src/lib/ngram-normalize.ts (looks them up at query time) must
 *     produce identical output, or lookups silently miss. Same for the
 *     editorial-wrapper stripper twins.
 *  2. BEHAVIOR — the normalizations the trend lines depend on (long s,
 *     ligatures, Latin u/v–i/j, Greek sigma/diacritics, line-break hyphenation).
 *  3. SERIES MATH — per-million conversion, thin-year elision, smoothing.
 */
import { describe, it, expect } from 'vitest';

import * as mjs from '../../scripts/lib/ngram-normalize.mjs';
import * as ts from '../../src/lib/ngram-normalize';
import { stripEditorialWrappers as stripMjs } from '../../scripts/lib/strip-editorial-wrappers.mjs';
import { stripEditorialWrappers as stripTs } from '../../src/lib/strip-editorial-wrappers';
import { buildSeries, buildDocSeries, smoothSeries, MIN_YEAR_TOKENS } from '../../src/lib/ngram-series';

const CORPORA = ['en', 'la', 'el', 'de', 'fr'];

const TOKENIZE_FIXTURES = [
  "The Philosopher's Stone, and its VNIVERSAL Elixir!",
  'Chymiſtry preſerves the ﬁrst ﬂame of æther and cœlum.',
  'philo-\nsopher and mer-\n  cury rejoined',
  'ejus verbum & Jovis vult — MAJESTAS',
  'ὁ Λόγος καὶ ἡ σοφία· τῆς φύσεως',
  'Die Natur würckt in „geheimen" Dingen',
  "don't strip internal apostrophes or trailing' ones",
  '',
];

const STRIP_FIXTURES = [
  '<meta>This page continues the discussion of mercury from page 88.</meta>\nReal body text here.',
  'Note: The text in the image is in French, not Latin. I have transcribed it exactly as it appears.\n\nLe vrai texte commence ici.',
  '<summary>About alchemy</summary><language>Latin</language>Corpus text <note>a gloss</note> continues.',
  '<lang>Hindustani</lang><image-desc type="woodcut">A pelican feeding her young</image-desc>Body survives.',
  '| Luigi Pulci | 493 |\n|---|---|\n# TABLE OF\n**Bold** and *italic* text',
  'Lacuna . . . . . . . . . . . . . . follows',
  '',
];

describe('normalizer parity (mjs build twin vs ts query twin)', () => {
  it('NGRAM_CORPORA and language map are identical', () => {
    expect(ts.NGRAM_CORPORA).toEqual(mjs.NGRAM_CORPORA);
    expect(ts.ORIGINAL_LANGUAGE_CORPUS).toEqual(mjs.ORIGINAL_LANGUAGE_CORPUS);
    expect(ts.MAX_NGRAM_N).toBe(mjs.MAX_NGRAM_N);
  });

  it('tokenize agrees on every fixture × corpus', () => {
    for (const corpus of CORPORA) {
      for (const text of TOKENIZE_FIXTURES) {
        expect(ts.tokenize(text, corpus)).toEqual(mjs.tokenize(text, corpus));
      }
    }
  });

  it('normalizePhrase agrees', () => {
    for (const corpus of CORPORA) {
      for (const text of TOKENIZE_FIXTURES) {
        expect(ts.normalizePhrase(text, corpus)).toEqual(mjs.normalizePhrase(text, corpus));
      }
    }
  });

  it('stripApparatusTags agrees', () => {
    const s = '<header>DE LAPIDE</header>Body <term>azoth</term> text<page-num>42</page-num>';
    expect(ts.stripApparatusTags(s)).toEqual(mjs.stripApparatusTags(s));
  });
});

describe('wrapper-stripper parity (mjs twin vs src/lib original)', () => {
  it('stripEditorialWrappers agrees on every fixture', () => {
    for (const text of STRIP_FIXTURES) {
      expect(stripMjs(text)).toEqual(stripTs(text));
    }
  });
});

/**
 * The EPIGRAPHY/ARTIFACT wrapper family (#3524).
 *
 * Tablet and papyrus records use a schema the codex wrappers never covered, and
 * `<condition>` holds a paragraph of English prose describing the OBJECT. Served
 * as quotable text that is a fabricated citation — the #2232 class in a family
 * nobody had enumerated.
 *
 * The distinction that matters: `<condition>` is ABOUT the artifact and goes;
 * `<transliteration>` IS the artifact's text and stays. A stripper that took both
 * would erase the only readable content these records have.
 */
describe('artifact wrappers: description goes, transliteration stays', () => {
  const TABLET = [
    '<surface>full-view</surface>',
    '<language>Akkadian</language>',
    '<period>ca. 668-631 BC (Library of Ashurbanipal)</period>',
    '<condition>The image shows multiple fragments (K.2421, K.2511, K.16765) from',
    'the British Museum collection, joined to form a substantial portion of a tablet.</condition>',
    '<genre>literary</genre>',
    '<transliteration>a-sar-ri ba-ni i-ne-mi sa-a-ti</transliteration>',
  ].join('\n');

  for (const [name, strip] of [['ts', stripTs], ['mjs', stripMjs]] as const) {
    it(`${name}: drops the artifact DESCRIPTION`, () => {
      const out = strip(TABLET);
      expect(out).not.toMatch(/British Museum/);
      expect(out).not.toMatch(/fragments/);
      expect(out).not.toMatch(/Library of Ashurbanipal/);
      expect(out).not.toMatch(/literary/);
    });

    it(`${name}: KEEPS the transliteration — it is the page's text`, () => {
      expect(strip(TABLET)).toMatch(/a-sar-ri ba-ni/);
    });
  }

  it('the two twins agree on the artifact fixture', () => {
    expect(stripMjs(TABLET)).toEqual(stripTs(TABLET));
  });
});

describe('normalizer behavior', () => {
  it('folds long s and ligatures', () => {
    expect(ts.tokenize('Chymiſtry æther ﬁre', 'en')).toEqual(['chymistry', 'aether', 'fire']);
  });

  it('Latin folds u/v and i/j; other corpora do not', () => {
    expect(ts.normalizePhrase('VNIVERSVM ejus Jovis', 'la')).toBe('uniuersum eius iouis');
    expect(ts.normalizePhrase('universal jove', 'en')).toBe('universal jove');
  });

  it('Greek folds diacritics and final sigma', () => {
    expect(ts.tokenize('ὁ Λόγος', 'el')).toEqual(['ο', 'λογοσ']);
  });

  it('rejoins line-break hyphenation', () => {
    expect(ts.tokenize('philo-\nsopher', 'en')).toEqual(['philosopher']);
    // a hyphen NOT at a line break stays a compound
    expect(ts.tokenize('semi-circle', 'en')).toEqual(['semi-circle']);
  });

  it('keeps internal apostrophes, trims trailing punctuation-like tails', () => {
    expect(ts.tokenize("philosopher's stone", 'en')).toEqual(["philosopher's", 'stone']);
    expect(ts.tokenize("trailing' word-", 'en')).toEqual(['trailing', 'word']);
  });

  it('drops apparatus tag content but keeps gloss content', () => {
    const out = ts.stripApparatusTags(
      '<header>DE LAPIDE PHILOSOPHORUM</header>The stone <term>azoth</term> is one.',
    );
    expect(out).not.toContain('LAPIDE');
    expect(out).toContain('azoth');
    expect(out).toContain('stone');
  });

  it('editorial wrapper content never reaches tokens', () => {
    const cleaned = stripTs('<meta>mercury on the previous page</meta>Sulphur is here.');
    expect(ts.tokenize(cleaned, 'en')).toEqual(['sulphur', 'is', 'here']);
  });
});

describe('series math', () => {
  const totals = new Map<number, number>([
    [1600, 1_000_000],
    [1601, 500_000],
    [1602, 2_000],       // thin year — must be elided
    [1603, 1_000_000],
  ]);

  it('converts to per-million and elides thin years', () => {
    const series = buildSeries({ '1600': 10, '1602': 5 }, totals, 1600, 1603, 0);
    expect(series.map(p => p.year)).toEqual([1600, 1601, 1603]);
    expect(series[0].perMillion).toBeCloseTo(10);
    expect(series[1]).toMatchObject({ year: 1601, count: 0, perMillion: 0 });
    expect(totals.get(1602)!).toBeLessThan(MIN_YEAR_TOKENS);
  });

  it('smoothing is a centered moving average with edge shrink', () => {
    expect(smoothSeries([0, 3, 6], 1)).toEqual([1.5, 3, 4.5]);
    expect(smoothSeries([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it('smoothed values ride on the series points', () => {
    const series = buildSeries({ '1600': 10 }, totals, 1600, 1603, 1);
    expect(series[0].smoothed).toBeCloseTo((10 + 0) / 2);
  });

  it('doc-frequency mode: % of books, same thin-year elision as tokens mode', () => {
    const bookTotals = new Map<number, number>([
      [1600, 40], [1601, 10], [1602, 1], [1603, 20],
    ]);
    const series = buildDocSeries({ '1600': 8, '1602': 1 }, totals, bookTotals, 1600, 1603, 0);
    // 1602 elided by the TOKEN threshold (identical x-axis to tokens mode).
    expect(series.map(p => p.year)).toEqual([1600, 1601, 1603]);
    expect(series[0]).toMatchObject({ year: 1600, count: 8 });
    expect(series[0].pctBooks).toBeCloseTo(20); // 8 of 40 books
    expect(series[1]).toMatchObject({ year: 1601, count: 0, pctBooks: 0 });
  });
});

describe('cross-language term specs + lexicon', () => {
  it('parses a :corpus suffix into a tagged spec', async () => {
    const { parseTermSpec } = await import('../../src/lib/ngram-series');
    expect(parseTermSpec('mercurius:la', 'en')).toEqual({ term: 'mercurius', corpus: 'la', tagged: true });
    expect(parseTermSpec('stein der weisen:de', 'en')).toEqual({ term: 'stein der weisen', corpus: 'de', tagged: true });
  });

  it('treats unknown suffixes and bare colons as text, not tags', async () => {
    const { parseTermSpec } = await import('../../src/lib/ngram-series');
    expect(parseTermSpec('12:30', 'en')).toEqual({ term: '12:30', corpus: 'en', tagged: false });
    expect(parseTermSpec('mercury:xx', 'en')).toEqual({ term: 'mercury:xx', corpus: 'en', tagged: false });
    expect(parseTermSpec(':la', 'en')).toEqual({ term: ':la', corpus: 'en', tagged: false });
  });

  it('lexicon corpus ids are all real corpora and forms normalize non-empty', async () => {
    const { NGRAM_LEXICON, findTermFamily } = await import('../../src/lib/ngram-lexicon');
    const ids = new Set(ts.NGRAM_CORPORA.map(c => c.id));
    for (const fam of NGRAM_LEXICON) {
      expect(ts.normalizePhrase(fam.en, 'en')).not.toBe('');
      for (const [corpus, forms] of Object.entries(fam.forms)) {
        expect(ids.has(corpus)).toBe(true);
        for (const form of forms) {
          expect(ts.normalizePhrase(form, corpus)).not.toBe('');
        }
      }
    }
    expect(findTermFamily('Mercurius')?.en).toBe('mercury');
    expect(findTermFamily('unknownword')).toBeNull();
  });
});
