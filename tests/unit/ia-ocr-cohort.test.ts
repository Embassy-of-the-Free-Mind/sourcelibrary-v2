import { describe, it, expect } from 'vitest';
import {
  IA_ARCHIVE_COHORT, archiveCohortDecision, confirmedFolios, latinShare, pageNumbers, publicationYear, wasRecitationRefused,
} from '../../scripts/lib/ia-ocr-cohort.mjs';

/**
 * Pins the English page cohort for the free IA lane (#5124, adopted 2026-09-30). The thresholds are
 * a measured policy (122 proofread reference pages; scripts/eval/results/en-ocr-ref-5124/report.md),
 * so a change here should come with a re-measurement and an EXPERIMENTS.md entry.
 */

const prose = 'It was a quiet evening and the family gathered by the fire to read aloud from the old book.';
/** A run of leaves with a running head and a folio, like an ABBYY leaf of a 1890s county history. */
const book = (first: number, bodies: string[]) => bodies.map((body, i) => `${first + i} HISTORY OF THE COUNTY.\n${body}`);

describe('publicationYear', () => {
  it('reads the first 4-digit year out of free text', () => {
    expect(publicationYear({ published: '1890' })).toBe(1890);
    expect(publicationYear({ published: 'c1890' })).toBe(1890);
    expect(publicationYear({ published: '[1917?]' })).toBe(1917);
    expect(publicationYear({ published: '1880-1885' })).toBe(1880);
    expect(publicationYear({ published: 'Boston : Little, Brown, 1904.' })).toBe(1904);
  });
  it('prefers a numeric year, and returns null when there is none', () => {
    expect(publicationYear({ year: 1911, published: '1850' })).toBe(1911);
    expect(publicationYear({ published: 'n.d.' })).toBeNull();
    expect(publicationYear({})).toBeNull();
  });
});

describe('confirmedFolios + pageNumbers', () => {
  it('exempts a page number that runs with its neighbours', () => {
    const leaves = book(24, [prose, prose, prose]);
    const f = confirmedFolios(leaves);
    expect([...f[1]]).toEqual([25]);
    expect(pageNumbers(leaves[1], f[1])).toEqual([]);
  });
  it('bridges an unnumbered plate between two numbered pages', () => {
    const leaves = [`24 HISTORY OF THE COUNTY.\n${prose}`, 'PLATE III. The old mill.', `25 HISTORY OF THE COUNTY.\n${prose}`];
    const f = confirmedFolios(leaves);
    expect(f[0].has(24)).toBe(true);
    expect(f[2].has(25)).toBe(true);
  });
  it('does NOT exempt a misread folio (186 read as 136) — it stays a number and refuses the page', () => {
    const leaves = [`185 HISTORY.\n${prose}`, `136 HISTORY.\n${prose}`, `187 HISTORY.\n${prose}`];
    const f = confirmedFolios(leaves);
    expect(f[1].size).toBe(0);
    expect(pageNumbers(leaves[1], f[1])).toEqual([136]);
  });
  it('does NOT exempt a year repeated in every running head', () => {
    const leaves = [1, 2, 3].map((i) => `OMAHA, 1854-1917. ${20 + i}\n${prose}`);
    const f = confirmedFolios(leaves);
    expect(pageNumbers(leaves[1], f[1]).sort()).toEqual([1854, 1917]);
  });
  it('counts numbers the Archive half-read as letters, or split (validation 2026-09-30)', () => {
    expect(pageNumbers('Related by Edward Cornplanter, March IQ06.')).toContain('IQ06');
    expect(pageNumbers('after going 1 8 yojanas')).toEqual(['1 8']);
    expect(pageNumbers('THE CODE OF HANDSOME LAKE IO5')).toEqual(['IO5']);
    expect(pageNumbers('born in l886 at Boston')).toContain('l886');
    // …but not ordinary words, a footnote marker, or a single digit
    expect(pageNumbers('the IO and SO words, Ohio, Illinois')).toEqual([]);
    expect(pageNumbers('1 Related by Edward Cornplanter')).toEqual([]);
  });
  it('does not take a year closing a footnote on the foot line as a folio', () => {
    const leaves = [104, 105, 106].map((n) => `THE CODE OF HANDSOME LAKE ${n}\n${prose}\n1 Related by Edward Cornplanter, March ${n + 1800}.`);
    const f = confirmedFolios(leaves);
    expect([...f[1]]).toEqual([105]);
    expect(pageNumbers(leaves[1], f[1])).toEqual([1905]);
  });
  it('counts every body number, including 5+ digit runs and pieces of "1,000"', () => {
    expect(pageNumbers('In 1836 he paid 1,000 dollars for 12345 acres.')).toEqual([1836, 0, 12345]);
    expect(pageNumbers('He had 3 sons and 4 daughters.')).toEqual([]);
  });
});

describe('latinShare', () => {
  it('is 1 for English and low for English OCR\'d as Greek', () => {
    expect(latinShare(prose)).toBe(1);
    expect(latinShare('ΟΝ ΤῊ ΟΑΥ̓Ε ΟΕ ΤΗΕ ΜΟΟΝ')).toBeLessThan(0.1);
    expect(latinShare('')).toBe(1);
  });
});

describe('wasRecitationRefused', () => {
  it('reads every stamp the OCR lanes write', () => {
    expect(wasRecitationRefused({ ocr: { recitation_count: 1 } })).toBe(true);
    expect(wasRecitationRefused({ ocr: { recitation_blocked: true } })).toBe(true);
    expect(wasRecitationRefused({ ocr: { last_skip: { reason: 'recitation' } } })).toBe(true);
    expect(wasRecitationRefused({ ocr: null })).toBe(false);
    expect(wasRecitationRefused({ ocr: { last_skip: { reason: 'truncated' } } })).toBe(false);
  });
});

describe('archiveCohortDecision', () => {
  const leaves = book(40, [prose, `In 1836 the first church was built. ${prose}`, prose]);
  const folios = confirmedFolios(leaves);
  const d = (k: number, over: Record<string, unknown> = {}) =>
    archiveCohortDecision({ language: 'English', year: 1890, text: leaves[k], folios: folios[k], page: { ocr: null }, ...over });

  it('admits a number-free 1880–1930 English page (the folio does not count)', () => {
    expect(d(0)).toMatchObject({ admit: true, admitted_by: 'cohort', numbers: 0 });
  });
  it('refuses a page carrying a date — the #5186 failure', () => {
    expect(d(1)).toMatchObject({ admit: false, reason: 'numbers', numbers: 1 });
  });
  it('refuses outside 1880–1930 and when the year is unknown', () => {
    expect(d(0, { year: 1879 })).toMatchObject({ admit: false, reason: 'year' });
    expect(d(0, { year: 1931 })).toMatchObject({ admit: false, reason: 'year' });
    expect(d(0, { year: null })).toMatchObject({ admit: false, reason: 'year' });
    expect(d(0, { year: 1880 }).admit).toBe(true);
    expect(d(0, { year: 1930 }).admit).toBe(true);
  });
  it('writes the Archive text on a recitation-refused page whatever the year or numbers', () => {
    expect(d(1, { year: 1850, page: { ocr: { recitation_count: 2 } } })).toMatchObject({ admit: true, admitted_by: 'recitation_fallback', numbers: 1 });
  });
  it('refuses the wrong script under either route', () => {
    const greek = 'ΟΝ ΤῊ ΟΑΥ̓Ε ΟΕ ΤΗΕ ΜΟΟΝ ΑΝΔ ΤΗΕ ΣΤΑΡΣ';
    expect(d(0, { text: greek })).toMatchObject({ admit: false, reason: 'script' });
    expect(d(0, { text: greek, page: { ocr: { recitation_blocked: true } } })).toMatchObject({ admit: false, reason: 'script' });
  });
  it('leaves other languages to the book-level gate (only English was measured)', () => {
    expect(d(1, { language: 'French' })).toMatchObject({ admit: true, admitted_by: 'language_not_gated' });
  });
  it('is a frozen rule', () => {
    expect(IA_ARCHIVE_COHORT).toMatchObject({ yearMin: 1880, yearMax: 1930, minLatinShare: 0.9, language: 'English' });
    expect(Object.isFrozen(IA_ARCHIVE_COHORT)).toBe(true);
  });
});
