import { describe, it, expect } from 'vitest';
import {
  generateBookSlug,
  appendSlugSuffix,
  bookUrl,
  authorSlug,
  authorUrl,
} from '@/lib/slugify';

describe('generateBookSlug', () => {
  it('creates slug from title and author last name', () => {
    expect(generateBookSlug('Atalanta Fugiens', 'Michael Maier'))
      .toBe('atalanta-fugiens-maier');
  });

  it('prefers displayTitle over title', () => {
    expect(generateBookSlug('Atalanta Fugiens', 'Michael Maier', 'Atalanta Fleeing'))
      .toBe('atalanta-fleeing-maier');
  });

  it('handles "Last, First" author format', () => {
    expect(generateBookSlug('Some Title', 'Maier, Michael'))
      .toBe('some-title-maier');
  });

  it('strips diacritics', () => {
    expect(generateBookSlug('Über die Natur', 'Johann Müller'))
      .toBe('uber-die-natur-muller');
  });

  it('handles Unknown author', () => {
    expect(generateBookSlug('Corpus Hermeticum', 'Unknown'))
      .toBe('corpus-hermeticum');
  });

  /**
   * Latin letters NFD cannot decompose (æ, œ, ß, ø, þ, ð, ł, đ, ſ) were DELETED by the
   * `[^a-z0-9]` strip rather than transliterated — `Ægyptiaca` became `gyptiaca`. Two
   * properties matter: the letter survives at all, and it does not SPLIT the word it
   * sits inside (a run of stripped characters collapses to one hyphen).
   */
  it('transliterates æ rather than deleting it (Kircher, Oedipus Ægyptiacus)', () => {
    expect(generateBookSlug('Ægyptiaca', 'Athanasius Kircher')).toBe('aegyptiaca-kircher');
    expect(generateBookSlug('De priori iustitiæ christianæ parte, quæ', 'Jean Calvin'))
      .toBe('de-priori-iustitiae-christianae-parte-quae-calvin');
  });

  it('does not split a word around the letter (ß was breaking Straßburg in two)', () => {
    expect(generateBookSlug('Straßburg', 'Johann Grüninger')).toBe('strassburg-gruninger');
  });

  it('handles œ, þ/ð, ł, đ', () => {
    expect(generateBookSlug('Œuvres complètes', 'Blaise Pascal')).toBe('oeuvres-completes-pascal');
    expect(generateBookSlug('Þriðja bók', 'Snorri Sturluson')).toBe('thridja-bok-sturluson');
    expect(generateBookSlug('Łukasz', 'Jan Kowalski')).toBe('lukasz-kowalski');
    expect(generateBookSlug('Đại Việt', 'Ngo Si Lien')).toBe('dai-viet-lien');
  });

  it('transliterates the long s used throughout early-modern printing', () => {
    expect(generateBookSlug('Ars ſignorum', 'George Dalgarno')).toBe('ars-signorum-dalgarno');
  });

  it('leaves ASCII and combining-diacritic slugs byte-identical', () => {
    // Guard on the far larger set of already-published URLs: this change must be
    // forward-only for new imports, never a rewrite of live slugs.
    expect(generateBookSlug('Atalanta Fugiens', 'Michael Maier')).toBe('atalanta-fugiens-maier');
    expect(generateBookSlug('Über die Natur', 'Johann Müller')).toBe('uber-die-natur-muller');
    expect(generateBookSlug('Kāmasūtra of Vātsyāyana', 'Vātsyāyana'))
      .toBe('kamasutra-of-vatsyayana-vatsyayana');
  });

  it('still degrades a wholly non-Latin title to the author segment', () => {
    // Deliberate documented behaviour — not something this map should change.
    expect(generateBookSlug('Τμῆμα πρῶτον', 'Markos Mousouros')).toBe('mousouros');
  });

  it('handles Anonymous author (keeps it in slug unlike Unknown)', () => {
    // extractLastName returns 'anonymous' (lowercased), but only 'unknown' is stripped
    expect(generateBookSlug('Some Text', 'Anonymous'))
      .toBe('some-text-anonymous');
  });

  it('truncates long titles at word boundary', () => {
    const longTitle = 'A Very Long Title That Goes On And On And On And On And On Forever And Ever';
    const slug = generateBookSlug(longTitle, 'Author');
    expect(slug.length).toBeLessThanOrEqual(85); // 60 title + hyphen + 20 author
  });

  it('handles empty title gracefully', () => {
    const slug = generateBookSlug('', 'Some Author');
    expect(slug).toBeTruthy();
  });
});

describe('appendSlugSuffix', () => {
  it('appends numeric suffix', () => {
    expect(appendSlugSuffix('atalanta-fugiens-maier', 2))
      .toBe('atalanta-fugiens-maier-2');
  });
});

describe('bookUrl', () => {
  it('uses slug when available', () => {
    expect(bookUrl({ slug: 'atalanta-fugiens-maier', id: 'abc123' }))
      .toBe('/book/atalanta-fugiens-maier');
  });

  it('falls back to id when no slug', () => {
    expect(bookUrl({ id: 'abc123' }))
      .toBe('/book/abc123');
  });

  it('falls back to id when slug is empty', () => {
    expect(bookUrl({ slug: '', id: 'abc123' }))
      .toBe('/book/abc123');
  });
});

describe('authorSlug', () => {
  it('slugifies author name', () => {
    expect(authorSlug('Michael Maier')).toBe('michael-maier');
  });

  it('strips diacritics', () => {
    expect(authorSlug('Heinrich Khunrath')).toBe('heinrich-khunrath');
    expect(authorSlug('René Descartes')).toBe('rene-descartes');
  });
});

describe('authorUrl', () => {
  it('returns URL for known author', () => {
    expect(authorUrl('Michael Maier')).toBe('/author/michael-maier');
  });

  it('returns null for Unknown', () => {
    expect(authorUrl('Unknown')).toBeNull();
  });

  it('returns null for Anonymous', () => {
    expect(authorUrl('Anonymous')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(authorUrl('')).toBeNull();
  });
});
