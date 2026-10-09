import { describe, it, expect } from 'vitest';
import { diversify, defaultDiversity, parseDiversityParam, traditionFamily, traditionSpread, TRADITION_LABELS, type BookFacets } from '@/lib/search/diversity';

// The re-rank the concept lanes share (#3514, #3895). What it must never do:
// drop a row, or trade a clearly better match for variety.

type Row = { book_id: string; score: number };
const row = (book_id: string, score: number): Row => ({ book_id, score });
const facets = new Map<string, BookFacets>([
  ['lat1', { tradition: ['Renaissance & Early Modern Europe'], work_id: 'w-lat1', author: 'Ficino' }],
  ['lat2', { tradition: ['Renaissance & Early Modern Europe'], work_id: 'w-lat2', author: 'Ficino' }],
  ['lat3', { tradition: ['Renaissance & Early Modern Europe'], work_id: 'w-lat3', author: 'Agrippa' }],
  ['lat4', { tradition: ['Renaissance & Early Modern Europe'], work_id: 'w-lat4', author: 'Fludd' }],
  ['kab', { tradition: ['Renaissance & Early Modern Europe', 'Kabbalistic & Hasidic'], work_id: 'w-kab', author: 'Reuchlin' }],
  ['sufi', { tradition: ['Persian'], work_id: 'w-sufi', author: 'Hujwiri' }],
  ['zh', { tradition: ['Chinese'], work_id: 'w-zh', author: 'Laozi' }],
  ['none', {}],
]);
const opts = { bookId: (r: Row) => r.book_id, facets };
const ids = (rows: Row[]) => rows.map((r) => r.book_id);

describe('traditionFamily', () => {
  it('counts a book under its specific label, not its European period', () => {
    expect(traditionFamily(['Renaissance & Early Modern Europe', 'Kabbalistic & Hasidic'])).toBe('jewish');
    expect(traditionFamily(['Kabbalistic & Hasidic', 'Renaissance & Early Modern Europe'])).toBe('jewish');
    expect(traditionFamily(['Renaissance & Early Modern Europe'])).toBe('early-modern-europe');
  });
  it('is null for no label or a label outside the closed list', () => {
    expect(traditionFamily([])).toBeNull();
    expect(traditionFamily(undefined)).toBeNull();
    expect(traditionFamily(['Atlantean'])).toBeNull();
  });
  it('the vocabulary is the 31 map labels', () => {
    expect(TRADITION_LABELS).toHaveLength(31);
    expect(new Set(TRADITION_LABELS).size).toBe(31);
  });
});

describe('diversify', () => {
  const list = [row('lat1', 0.80), row('lat2', 0.79), row('lat3', 0.78), row('lat4', 0.77), row('sufi', 0.76), row('zh', 0.75), row('kab', 0.74)];

  it('off returns the order it was given', () => {
    expect(ids(diversify(list, { ...opts, mode: 'off' }))).toEqual(ids(list));
  });

  it('holds a screen to two rows per tradition family and keeps every row', () => {
    const out = diversify(list, { ...opts, mode: 'tradition', window: 5 });
    expect(ids(out).slice(0, 5)).toEqual(['lat1', 'lat2', 'sufi', 'zh', 'kab']);
    expect(ids(out).sort()).toEqual(ids(list).sort());
    // The next screen starts its own count.
    expect(ids(out).slice(5)).toEqual(['lat3', 'lat4']);
  });

  it('never caps a book with no tradition label', () => {
    const rows = [row('none', 0.9), row('none', 0.89), row('none', 0.88)];
    const out = diversify(rows, { ...opts, mode: 'tradition', perWork: 10 });
    expect(out).toEqual(rows);
  });

  it('caps passages per work', () => {
    const rows = [row('zh', 0.9), row('zh', 0.89), row('zh', 0.88), row('sufi', 0.5)];
    const out = diversify(rows, { ...opts, mode: 'tradition', perTradition: 10, window: 3 });
    expect(ids(out)).toEqual(['zh', 'zh', 'sufi', 'zh']);
  });

  it('author mode: one row per author and per work on a screen', () => {
    const out = diversify(list, { ...opts, mode: 'author', window: 4 });
    expect(ids(out).slice(0, 4)).toEqual(['lat1', 'lat3', 'lat4', 'sufi']);
  });

  it('a clearly better row is not passed over: the margin', () => {
    const rows = [row('lat1', 0.80), row('lat2', 0.79), row('lat3', 0.78), row('sufi', 0.60), row('zh', 0.59)];
    const strict = diversify(rows, { ...opts, mode: 'tradition', score: (r) => r.score, margin: 0.03 });
    // lat3 is 0.18 nearer than the row that would replace it: it stays third.
    expect(ids(strict)).toEqual(['lat1', 'lat2', 'lat3', 'sufi', 'zh']);
    const close = [row('lat1', 0.80), row('lat2', 0.79), row('lat3', 0.78), row('sufi', 0.77), row('zh', 0.76), row('none', 0.5), row('none', 0.5), row('none', 0.5), row('none', 0.5), row('none', 0.5), row('none', 0.5)];
    const spread = diversify(close, { ...opts, mode: 'tradition', score: (r) => r.score, margin: 0.03, perWork: 10 });
    expect(ids(spread).slice(0, 4)).toEqual(['lat1', 'lat2', 'sufi', 'zh']);
  });

  it('extra caps hold in off mode too (the untranslated lane share)', () => {
    type L = Row & { lane: string };
    const rows: L[] = [1, 2, 3, 4, 5, 6].map((n) => ({ book_id: `b${n}`, score: 1 - n / 100, lane: n <= 4 ? 'original' : 'translated' }));
    const out = diversify(rows, { mode: 'off', bookId: (r) => r.book_id, facets: new Map(), window: 4, extra: [{ key: (r) => (r.lane === 'original' ? 'o' : null), cap: 2 }] });
    expect(out.map((r) => r.book_id)).toEqual(['b1', 'b2', 'b5', 'b6', 'b3', 'b4']);
  });

  it('when nothing else fits, the best remaining row takes the place', () => {
    const rows = [row('lat1', 0.9), row('lat2', 0.8), row('lat3', 0.7), row('lat4', 0.6)];
    expect(ids(diversify(rows, { ...opts, mode: 'tradition' }))).toEqual(['lat1', 'lat2', 'lat3', 'lat4']);
  });
});

describe('defaults and parsing', () => {
  it('a concept query is spread; a phrase, a dated or book-scoped query is not', () => {
    expect(defaultDiversity('prima materia')).toBe('tradition');
    expect(defaultDiversity('the soul is reborn in another body after death')).toBe('tradition');
    expect(defaultDiversity('"as above so below"')).toBe('off');
    expect(defaultDiversity('as above so below', { phrase: true })).toBe('off');
    expect(defaultDiversity('Agrippa De occulta philosophia 1533')).toBe('off');
    expect(defaultDiversity('emptiness', { bookScoped: true })).toBe('off');
    expect(defaultDiversity('ficino', { intent: 'navigational' })).toBe('off');
    expect(defaultDiversity('ficino on love', { intent: 'conceptual' })).toBe('tradition');
  });
  it('a query that names a person or its own tradition is not spread', () => {
    expect(defaultDiversity('Agrippa on natural magic and planetary correspondences')).toBe('off');
    expect(defaultDiversity('Sufi metaphysics of the unity of being and divine names')).toBe('off');
    expect(defaultDiversity('the green lion devouring the sun in alchemy')).toBe('off');
    expect(defaultDiversity('emptiness in buddhist thought')).toBe('off');
    // Capitalised concepts are not names, and neither is the first word.
    expect(defaultDiversity('how the many things come forth from the One')).toBe('tradition');
    expect(defaultDiversity('Light as the nature of the divine or of the mind')).toBe('tradition');
    expect(defaultDiversity("know yourself and you will know God's nature")).toBe('tradition');
    // Not fooled by a word that merely contains one ("romance", "channel").
    expect(defaultDiversity('romance and channel crossings')).toBe('tradition');
  });
  it('parses only the three modes', () => {
    expect(parseDiversityParam('Tradition')).toBe('tradition');
    expect(parseDiversityParam('author')).toBe('author');
    expect(parseDiversityParam('off')).toBe('off');
    expect(parseDiversityParam('mmr')).toBeNull();
    expect(parseDiversityParam(null)).toBeNull();
  });
  it('reports the spread by family', () => {
    expect(traditionSpread([row('lat1', 1), row('kab', 1), row('none', 1)], (r) => r.book_id, facets))
      .toEqual({ 'early-modern-europe': 1, jewish: 1, unlabelled: 1 });
  });
});
