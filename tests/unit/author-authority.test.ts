import { describe, it, expect } from 'vitest';
import { normaliseAuthorQuery } from '@/lib/author-authority';

describe('normaliseAuthorQuery', () => {
  it('returns empty for the empty string', () => {
    expect(normaliseAuthorQuery('')).toBe('');
  });

  it('strips standalone "s.n." style bracketed markers', () => {
    expect(normaliseAuthorQuery('[s.n.]')).toBe('');
    expect(normaliseAuthorQuery('[s. n.]')).toBe('');
    expect(normaliseAuthorQuery('[sine nomine]')).toBe('');
    expect(normaliseAuthorQuery('[n.n.]')).toBe('');
    expect(normaliseAuthorQuery('Anonymous')).toBe('');
  });

  it('strips trailing date ranges (Last, First, 1556-1613 → Last, First)', () => {
    expect(normaliseAuthorQuery('Boccalini, Traiano, 1556-1613'))
      .toBe('Boccalini, Traiano');
  });

  it('strips parenthesised dates ("Author (1556-1613)" → "Author")', () => {
    expect(normaliseAuthorQuery('Author (1556-1613)')).toBe('Author');
    expect(normaliseAuthorQuery('Author (1556-)')).toBe('Author');
  });

  it('strips circa/floruit date markers', () => {
    expect(normaliseAuthorQuery('Some Author, c. 1500-1560')).toBe('Some Author');
    expect(normaliseAuthorQuery('Some Author, fl. 1600')).toBe('Some Author');
  });

  it('strips obvious title prefixes (Dr., Tr., Mr., Rev.)', () => {
    expect(normaliseAuthorQuery('Tr. Bokkalini')).toBe('Bokkalini');
    expect(normaliseAuthorQuery('Dr. C. G. Jung')).toBe('C. G. Jung');
    expect(normaliseAuthorQuery('Rev. John Smith')).toBe('John Smith');
  });

  it('preserves abbreviated first names that look like part of the name', () => {
    // Joh. is the canonical title-page form for "Johannes" in many 17th-c
    // imprints. We must not strip it.
    expect(normaliseAuthorQuery('Joh. Valentin Andreae'))
      .toBe('Joh. Valentin Andreae');
  });

  it('preserves diacritics for VIAF (handles ö/oe equivalence internally)', () => {
    expect(normaliseAuthorQuery('Johann Müller')).toBe('Johann Müller');
    expect(normaliseAuthorQuery('Böhme, Jakob')).toBe('Böhme, Jakob');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseAuthorQuery('  Boccalini ,   Traiano  '))
      .toBe('Boccalini ,   Traiano'.replace(/\s+/g, ' ').trim());
  });

  it('strips trailing punctuation', () => {
    expect(normaliseAuthorQuery('Author Name,')).toBe('Author Name');
    expect(normaliseAuthorQuery('Author Name.')).toBe('Author Name');
  });
});
