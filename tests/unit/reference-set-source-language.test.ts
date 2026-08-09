/**
 * Source-language screening for the reference set. (#3459)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The screen compared our book's source language against the reference-set row
 * through a table of MARC-21 codes. LoC rows carry MARC codes, so it worked
 * there. Wikidata rows carry Q-numbers, so it failed on every single one —
 * `['gre','grc'].includes('Q35497')` is false, and the candidate was thrown away
 * as WRONG_LANGUAGE. On the 2026-07-31 run that discarded 228 real candidates,
 * among them Xenophon's *Symposium* and all six *Rubáiyát of Omar Khayyám*
 * records: exactly the prior translations the search exists to find.
 *
 * Both regressions are pinned below with the values that actually appeared in
 * that output, so the fix cannot be undone by a later refactor of the tables.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import {
  canonicalLanguage,
  rowSourceLanguages,
  languageMismatch,
} from '../../scripts/lib/source-language-match.mjs';
import {
  canonicalLanguage as canonicalLanguageTs,
  rowSourceLanguages as rowSourceLanguagesTs,
  languageMismatch as languageMismatchTs,
} from '@/lib/first-translation/source-language-match';

describe('the Wikidata regression — real rows from the 2026-07-31 run', () => {
  it('keeps Xenophon\'s Symposium against a Greek source', () => {
    // Rejected with: "record translates from Q35497, our source is greek (gre/grc)"
    expect(languageMismatch('Greek', {
      title: 'Symposion (Xenophon)',
      original_languages: ['Q35497'],
      original_language_label: 'Ancient Greek',
    })).toBeNull();
  });

  it('keeps the Rubáiyát of Omar Khayyám against a Persian source', () => {
    // Six records, all rejected with: "record translates from Q9168".
    expect(languageMismatch('Persian', {
      title: 'Rubáiyát of Omar Khayyám (1909 edition)',
      original_languages: ['Q9168'],
      original_language_label: 'Persian',
    })).toBeNull();
  });

  it('still keeps LoC rows working — the lane that was never broken', () => {
    expect(languageMismatch('Greek', { original_languages: ['grc'] })).toBeNull();
    expect(languageMismatch('Latin', { original_languages: ['lat'] })).toBeNull();
  });
});

describe('a genuine mismatch is still rejected', () => {
  it('rejects a Latin source against a German original', () => {
    const reason = languageMismatch('Latin', {
      original_languages: ['Q188'], original_language_label: 'German',
    });
    expect(reason).toContain('German');
    expect(reason).toContain('Latin');
  });

  it('rejects across MARC codes too', () => {
    expect(languageMismatch('Greek', { original_languages: ['ger'] })).not.toBeNull();
  });
});

describe('UNKNOWN must never read as MISMATCH', () => {
  // Every defect in this area failed toward a confident clean negative. A
  // rejection here silently preserves a possibly-false badge, so anything we
  // cannot resolve has to keep the candidate open.
  it('skips the screen when we do not know our own source language', () => {
    // `books.language` is the EDITION language; `original_language` is often absent.
    expect(languageMismatch(null, { original_languages: ['ger'] })).toBeNull();
    expect(languageMismatch('', { original_language_label: 'German' })).toBeNull();
  });

  it('skips the screen when the row declares no source language', () => {
    expect(languageMismatch('Latin', { original_languages: [] })).toBeNull();
    expect(languageMismatch('Latin', {})).toBeNull();
  });

  it('skips the screen on an unrecognised Q-number rather than guessing', () => {
    // There is deliberately no QID table — an unreadable identifier is unknown.
    expect(languageMismatch('Latin', { original_languages: ['Q999999999'] })).toBeNull();
  });

  it('skips the screen on a language outside the table', () => {
    // (Nahuatl was the example here until #3785 added it to the table — the
    // catalog stores hand-verified 'nah' rows. Quechua is genuinely unmapped.)
    expect(languageMismatch('Latin', { original_language_label: 'Quechua' })).toBeNull();
    expect(canonicalLanguage('Quechua')).toBeNull();
  });
});

describe('canonical names collapse historical registers', () => {
  // A translation from Homeric Greek defeats a first-English claim on a Greek
  // text. The register matters to a philologist, not to this question.
  it.each([
    ['Ancient Greek', 'greek'], ['Homeric Greek', 'greek'], ['grc', 'greek'], ['gre', 'greek'],
    ['medieval Latin', 'latin'], ['lat', 'latin'],
    ['Classical Chinese', 'chinese'], ['Literary Chinese', 'chinese'], ['chi', 'chinese'],
    ['Quranic Arabic', 'arabic'], ['ara', 'arabic'],
    ['American English', 'english'], ['Early Modern English', 'english'],
    ['Old Norse', 'icelandic'], ['Bangla', 'bengali'], ["Ge'ez", 'ethiopic'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalLanguage(input)).toBe(expected);
  });

  it('prefers the readable label over the Q-number', () => {
    expect(rowSourceLanguages({
      original_languages: ['Q35497'], original_language_label: 'Ancient Greek',
    })).toEqual(['greek']);
  });

  it('falls back to MARC codes when there is no label', () => {
    expect(rowSourceLanguages({ original_languages: ['gre', 'grc'] })).toEqual(['greek']);
  });
});

describe('.mjs / .ts twin parity (#3785)', () => {
  // src/lib/first-translation/source-language-match.ts mirrors the .mjs for
  // TS consumers (tier0-catalog.ts). Parity is the point of the twin — a table
  // edited in one file only is exactly the one-sided-normalizer bug class.
  const samples = [
    'Latin', 'la', 'lat', 'grc', 'Ancient Greek', 'fa', 'Persian', 'per',
    'nah', 'Nahuatl', 'zz-unmapped', 'Q35497', 'enm', 'es', 'Spanish', '',
    'bo', 'syc', 'hy', 'ave', 'myz', 'hai', 'lzh', 'Old Norse', "Ge'ez",
  ];
  it('canonicalLanguage agrees on every sample', () => {
    for (const s of samples) {
      expect(canonicalLanguageTs(s), `canonicalLanguage(${JSON.stringify(s)})`).toBe(canonicalLanguage(s));
    }
  });
  it('rowSourceLanguages and languageMismatch agree', () => {
    const rows = [
      { original_languages: ['grc'] },
      { original_languages: ['Q35497'], original_language_label: 'Ancient Greek' },
      { original_languages: [] },
      {},
    ];
    for (const row of rows) {
      expect(rowSourceLanguagesTs(row)).toEqual(rowSourceLanguages(row));
      for (const lang of ['Latin', 'Greek', null]) {
        expect(languageMismatchTs(lang, row)).toBe(languageMismatch(lang, row));
      }
    }
  });
});
