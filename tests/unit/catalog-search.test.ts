import { describe, it, expect } from 'vitest';
import { synonymsFor, textUsesName } from '@/lib/catalog/synonyms';
import { readRequest } from '@/lib/catalog/read-request';
import {
  parseCatalogFilters, writeCatalogFilters, parseCatalogState, writeCatalogState,
  type CatalogFilters, type CatalogState,
} from '@/lib/catalog/filters';

const vocab = {
  languages: ['Latin', 'German', 'Greek', 'English', 'Hebrew and Aramaic in Hebrew script'],
  categories: [
    { value: 'alchemy', label: 'Alchemy' },
    { value: 'medicine', label: 'Medicine & Healing' },
    { value: 'natural-philosophy', label: 'Natural Philosophy' },
    { value: 'paracelsian', label: 'Paracelsian' },
    { value: 'neoplatonism', label: 'Neoplatonism' },
    { value: 'jewish-kabbalah', label: 'Jewish Kabbalah' },
  ],
};

describe('synonymsFor', () => {
  it('adds the other names for a subject', () => {
    const s = synonymsFor('plague');
    expect(s).toContain('pestis');
    expect(s).toContain('black death');
    expect(s).not.toContain('plague');
  });

  it('keeps the rest of the query around each name', () => {
    expect(synonymsFor('plague remedies')).toContain('pestis remedies');
  });

  it('prefers the longest name, so natural magic is not read as magic', () => {
    expect(synonymsFor('natural magic')).toEqual(['magia naturalis', 'magie naturelle']);
  });

  it('matches whole words only', () => {
    // "pest" is a plague name; "Budapest" and "tempest" are not about plague.
    expect(synonymsFor('budapest')).toEqual([]);
    expect(synonymsFor('the tempest')).toEqual([]);
  });

  it('reads accents and apostrophes either way', () => {
    expect(synonymsFor('Philosopher’s Stone')).toContain('lapis philosophorum');
  });

  it('returns nothing for a word with no group', () => {
    expect(synonymsFor('Paracelsus')).toEqual([]);
  });
});

describe('textUsesName', () => {
  it('accepts a title that really uses the other name', () => {
    expect(textUsesName('Consilium de peste', 'peste')).toBe(true);
    expect(textUsesName('De pestis regimine', 'pestis remedies', 'plague remedies')).toBe(true);
  });

  it('rejects text that only brushes past it', () => {
    expect(textUsesName('Should black bile be evacuated', 'black death')).toBe(false);
    expect(textUsesName('A Midsummer tempest', 'pest')).toBe(false);
  });
});

describe('readRequest', () => {
  it('reads language, date and topic', () => {
    const r = readRequest('Latin books on plague remedies printed before 1600', vocab);
    expect(r.languages).toEqual(['Latin']);
    expect(r.yearMax).toBe(1600);
    expect(r.yearMin).toBeUndefined();
    expect(r.topic).toBe('plague remedies');
  });

  it('reads centuries in words and numbers', () => {
    expect(readRequest('emblem books from the seventeenth century', vocab)).toMatchObject({ yearMin: 1600, yearMax: 1699 });
    expect(readRequest('17th century', vocab)).toMatchObject({ yearMin: 1600, yearMax: 1699 });
    expect(readRequest('Greek 1500s', vocab)).toMatchObject({ languages: ['Greek'], yearMin: 1500, yearMax: 1599 });
  });

  it('reads a range', () => {
    expect(readRequest('between 1550 and 1650', vocab)).toMatchObject({ yearMin: 1550, yearMax: 1650 });
  });

  it('reads translation status', () => {
    expect(readRequest('anything by Ficino that has been translated', vocab)).toMatchObject({ hasTranslation: true, authorQuery: 'Ficino', topic: '' });
    expect(readRequest('first translations on astrology', vocab).firstTranslation).toBe(true);
  });

  it('reads a subject by its label and by a word that starts like it', () => {
    expect(readRequest('Latin alchemy', vocab, { stems: false })).toMatchObject({ languages: ['Latin'], category: 'alchemy', topic: '' });
    expect(readRequest('alchemical emblems', vocab)).toMatchObject({ category: 'alchemy', topic: 'emblems' });
    expect(readRequest('cabala', vocab).category).toBe('jewish-kabbalah');
  });

  it('never takes a name for a subject', () => {
    expect(readRequest('Paracelsus', vocab).category).toBeUndefined();
    expect(readRequest('Paracelsus', vocab).topic).toBe('paracelsus');
    const byName = readRequest('books by Paracelsus', vocab);
    expect(byName.authorQuery).toBe('Paracelsus');
    expect(byName.category).toBeUndefined();
  });

  it('drops filler words and punctuation from the topic', () => {
    expect(readRequest('printers at their presses', vocab).topic).toBe('printers presses');
    expect(readRequest('mushrooms, poisonous and edible', vocab).topic).toBe('mushrooms poisonous edible');
  });

  it('does not stem in the search bar', () => {
    expect(readRequest('alchemical', vocab, { stems: false }).category).toBeUndefined();
  });

  it('matches a language label with punctuation in it', () => {
    expect(readRequest('Hebrew and Aramaic in Hebrew script', vocab).languages).toEqual(['Hebrew and Aramaic in Hebrew script']);
  });
});

describe('catalogue wire format', () => {
  const full: CatalogFilters = {
    q: 'plague', also: ['pestis', 'black death'], title: 'tractatus', author: 'Fludd', not: 'utriusque',
    languages: ['Latin', 'Hebrew and Aramaic in Hebrew script'], category: 'alchemy', collection: 'mycology',
    yearMin: -500, yearMax: 1699, hasTranslation: true, firstTranslation: true, ids: ['a1', 'b2'],
  };

  it('round-trips every filter', () => {
    expect(parseCatalogFilters(writeCatalogFilters(full))).toEqual(full);
  });

  it('repeats multi-value fields instead of joining them', () => {
    const sp = writeCatalogFilters(full);
    expect(sp.getAll('language')).toEqual(['Latin', 'Hebrew and Aramaic in Hebrew script']);
    expect(sp.getAll('also')).toEqual(['pestis', 'black death']);
  });

  it('uses the names /api/catalog/browse has always read', () => {
    const sp = writeCatalogFilters({ languages: ['Latin'], yearMin: 1600, yearMax: 1650, hasTranslation: true, firstTranslation: true });
    expect(sp.toString()).toBe('language=Latin&year_min=1600&year_max=1650&has_translation=1&first_translation=1');
  });

  it('round-trips the page state and drops defaults', () => {
    const { ids: _ids, ...rest } = full;
    const s: CatalogState = { ...rest, sort: 'relevance', view: 'list', page: 3, ask: 'plague in Latin', topic: 'plague' };
    expect(parseCatalogState(writeCatalogState(s))).toEqual(s);
    expect(writeCatalogState({ sort: 'popular', view: 'grid', page: 1 }).toString()).toBe('');
  });

  it('ignores an unknown sort and a nonsense year', () => {
    const s = parseCatalogState(new URLSearchParams('sort=drop&year_min=abc'));
    expect(s.sort).toBe('popular');
    expect(s.yearMin).toBeUndefined();
  });
});

describe('default order', () => {
  it('is most relevant for a search link and most read without words, and survives a round trip', () => {
    expect(parseCatalogState(new URLSearchParams('q=alchemy')).sort).toBe('relevance');
    expect(parseCatalogState(new URLSearchParams('language=Latin')).sort).toBe('popular');
    const chosen = parseCatalogState(new URLSearchParams('q=alchemy&sort=popular'));
    expect(chosen.sort).toBe('popular');
    expect(parseCatalogState(writeCatalogState(chosen)).sort).toBe('popular');
    expect(writeCatalogState(parseCatalogState(new URLSearchParams('q=alchemy'))).toString()).toBe('q=alchemy');
  });
});

describe('text filters', () => {
  it('drop characters the filter syntax cannot take, keeping phrases and apostrophes', () => {
    const q = (v: string) => parseCatalogFilters(new URLSearchParams({ q: v })).q;
    expect(q('"')).toBeUndefined();
    expect(q('\\')).toBeUndefined();
    expect(q('%')).toBeUndefined();
    expect(q('%%_')).toBeUndefined();
    expect(q('"venus humanitas"')).toBe('"venus humanitas"');
    expect(q("l'alchimie")).toBe("l'alchimie");
    expect(q('dragon"')).toBe('dragon');
  });
});
