import { describe, it, expect } from 'vitest';
import { displayPublished, citationYear, citationYearOrNd } from '@/lib/publication-date';

// Values below are REAL `books.published` strings from the production corpus
// (counts as of 2026-07-21, visible books only) — see #3310.
describe('displayPublished', () => {
  it('passes a clean year through', () => {
    expect(displayPublished('1573')).toBe('1573');
    expect(displayPublished('1450')).toBe('1450');
  });

  it('strips Wikidata QuickStatements noise (1,467 visible books)', () => {
    expect(displayPublished('1573date QS:P571,+1573-00-00T00:00:00Z/9')).toBe('1573');
    expect(displayPublished('1624date QS:P571,+1624-00-00T00:00:00Z/9')).toBe('1624');
    expect(displayPublished('15th centurydate QS:P,+1450-00-00T00:00:00Z/7')).toBe('15th century');
    expect(
      displayPublished('between 1860 and 1890date QS:P,+1850-00-00T00:00:00Z/7,P1319,+1860-00-00T00:00:00Z/9'),
    ).toBe('between 1860 and 1890');
    expect(displayPublished('circa 1700date QS:P,+1700-00-00T00:00:00Z/9,P1480,Q5727902')).toBe('circa 1700');
  });

  it('drops non-answers rather than printing them (703 "Unknown" + 704 empty)', () => {
    for (const v of ['Unknown', 'unknown', 'Unknown date', '', '   ', 'n.d.', 'N.D.', 'undated',
                     '[date of publication not identified]', 'no date', null, undefined]) {
      expect(displayPublished(v)).toBeNull();
    }
  });

  it('keeps hedged but informative values', () => {
    expect(displayPublished('15th century')).toBe('15th century');
    expect(displayPublished('[19th century]')).toBe('[19th century]');
    expect(displayPublished('1500–1825')).toBe('1500–1825');
    expect(displayPublished('Ur III / Old Babylonian (c. 2100–1600 BCE)'))
      .toBe('Ur III / Old Babylonian (c. 2100–1600 BCE)');
    expect(displayPublished('En 1547')).toBe('En 1547');
  });

  it('collapses stray whitespace', () => {
    expect(displayPublished('  1573  ')).toBe('1573');
    expect(displayPublished('15th   century')).toBe('15th century');
  });
});

describe('citationYear', () => {
  it('asserts a bare year only', () => {
    expect(citationYear('1573')).toBe('1573');
    expect(citationYear('980')).toBe('980');
    expect(citationYear('1573date QS:P571,+1573-00-00T00:00:00Z/9')).toBe('1573');
  });

  it('accepts bracketed cataloguer conjecture', () => {
    expect(citationYear('[1620]')).toBe('1620');
  });

  it('REFUSES to flatten a century or range into a false precision', () => {
    // The whole point: these are real knowledge, but not publication dates.
    expect(citationYear('15th century')).toBeNull();
    expect(citationYear('[19th century]')).toBeNull();
    expect(citationYear('circa 1700')).toBeNull();
    expect(citationYear('between 1650 and 1700')).toBeNull();
    expect(citationYear('1500–1825')).toBeNull();
    expect(citationYear('Ur III / Old Babylonian (c. 2100–1600 BCE)')).toBeNull();
  });

  it('emits nothing for non-answers', () => {
    expect(citationYear('Unknown')).toBeNull();
    expect(citationYear('')).toBeNull();
    expect(citationYear(null)).toBeNull();
  });

  it('never leaks QuickStatements syntax into a citation field', () => {
    for (const v of ['1573date QS:P571,+1573-00-00T00:00:00Z/9',
                     'between circa 1733 and circa 1734date QS:P,+1733-00-00T00:00:00Z/8']) {
      expect(citationYear(v) ?? '').not.toMatch(/QS:/);
      expect(displayPublished(v) ?? '').not.toMatch(/QS:/);
    }
  });
});

describe('citationYearOrNd', () => {
  it('uses the scholarly no-date convention', () => {
    expect(citationYearOrNd('1573')).toBe('1573');
    expect(citationYearOrNd('Unknown')).toBe('n.d.');
    expect(citationYearOrNd('15th century')).toBe('n.d.');
    expect(citationYearOrNd(null)).toBe('n.d.');
  });
});
