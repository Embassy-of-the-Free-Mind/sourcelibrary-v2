import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM util shared with scripts (no types)
import { countDistinctLanguages, atomsOfLabel } from '../../scripts/lib/language-count.mjs';

// The books.language field is free-text and messy. A naive
// distinct('language').length over-counts because it treats compound labels,
// script/stage variants, and junk tokens as separate languages — it reported
// 162 when the real distinct-language count was ~102 (2026-06-26). This guards
// the normalizer so the homepage "languages" stat stays honest.

describe('atomsOfLabel', () => {
  it('splits compound labels on / , ; & and "and"', () => {
    expect(atomsOfLabel('Greek/Latin')).toEqual(['greek', 'latin']);
    expect(atomsOfLabel('Hebrew and Judeo-Arabic')).toEqual(['hebrew', 'judeo-arabic']);
    expect(atomsOfLabel('Hebrew, Aramaic, and Judeo-Arabic')).toEqual(['hebrew', 'aramaic', 'judeo-arabic']);
  });

  it('splits hyphen compounds but keeps single hyphenated languages whole', () => {
    expect(atomsOfLabel('Latin-German')).toEqual(['latin', 'german']);
    expect(atomsOfLabel('Nahuatl-Spanish')).toEqual(['nahuatl', 'spanish']);
    expect(atomsOfLabel('Judeo-Arabic')).toEqual(['judeo-arabic']);
    expect(atomsOfLabel('Anglo-Norman')).toEqual(['french']); // variant-folded
  });

  it('folds script/stage variants into one canonical language', () => {
    expect(atomsOfLabel("Ge'ez")).toEqual(['geez']);
    expect(atomsOfLabel('Egyptian hieroglyphs')).toEqual(['egyptian']);
    expect(atomsOfLabel('Classical Chinese')).toEqual(['chinese']);
    expect(atomsOfLabel('Middle English')).toEqual(['english']);
  });

  it('strips "in X script" and parenthetical noise', () => {
    expect(atomsOfLabel('Italian in Italian script')).toEqual(['italian']);
    expect(atomsOfLabel('Aromanian (in Greek alphabet)')).toEqual(['aromanian']);
  });
});

describe('countDistinctLanguages', () => {
  it('drops junk tokens entirely', () => {
    expect(countDistinctLanguages(['auto-detect', 'Multiple', 'mul', 'Undetermined', ''])).toBe(0);
  });

  it('deduplicates variants and compounds to atomic languages', () => {
    const labels = ['Latin', 'Greek/Latin', 'Greek-Latin', "Ge'ez", 'Ethiopic', 'Hebrew and Aramaic'];
    // -> latin, greek, geez, hebrew, aramaic = 5
    expect(countDistinctLanguages(labels)).toBe(5);
  });

  it('counts far fewer than the naive distinct().length on realistic data', () => {
    const labels = [
      'Latin', 'German', 'Greek/Latin', 'Latin-German', 'Hebrew and Judeo-Arabic',
      'Hebrew and Aramaic', "Ge'ez", 'Ethiopic', 'auto-detect', 'Multiple',
    ];
    const naive = labels.filter((x) => x && !x.includes(',') && !x.includes(' and ')).length;
    const honest = countDistinctLanguages(labels);
    expect(honest).toBeLessThan(naive);
    // atomic set: latin, german, greek, hebrew, judeo-arabic, aramaic, geez = 7
    expect(honest).toBe(7);
  });
});
