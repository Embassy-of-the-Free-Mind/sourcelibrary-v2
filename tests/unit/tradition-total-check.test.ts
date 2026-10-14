// @ts-expect-error plain .mjs script helper
import { checkTraditionTotals } from '../../scripts/lib/tradition-total-check.mjs';

const zh = /Chinese/;
const books = (n: number, language: string) => Array.from({ length: n }, () => ({ language }));
const T = [
  { id: 'chinese-buddhist', languages: zh },
  { id: 'chinese-classics', languages: zh },
  { id: 'latin', scope: 'collections: hermetica, alchemy' },
];

describe('checkTraditionTotals', () => {
  it('throws on the #6528 case: 170 shown against ~13,000 Chinese books', () => {
    const counts = { 'chinese-buddhist': { books: 172 }, 'chinese-classics': { books: 170, set_names: 'kanripo' }, latin: { books: 5 } };
    expect(() => checkTraditionTotals(T, counts, books(13000, 'Chinese'))).toThrow(/chinese-buddhist \+ chinese-classics.*13000/);
  });
  it('passes a full row and records the ratio', () => {
    const counts = { 'chinese-buddhist': { books: 172 }, 'chinese-classics': { books: 13142 }, latin: { books: 5 } };
    const r = checkTraditionTotals(T, counts, books(13400, 'Chinese'));
    expect(r['chinese-classics'].direct_language_books).toBe(13400);
    expect(r['chinese-classics'].coverage_of_language).toBeGreaterThan(0.99);
    expect(r.latin.scope).toMatch(/hermetica/);
  });
  it('--allow-partial bypasses a row deliberately', () => {
    const counts = { 'chinese-buddhist': { books: 1 }, 'chinese-classics': { books: 1 }, latin: { books: 5 } };
    expect(() => checkTraditionTotals(T, counts, books(100, 'Chinese'), { allowPartial: ['chinese-buddhist', 'chinese-classics'] })).not.toThrow();
  });
  it('requires a scope on a row that is not a whole language', () => {
    expect(() => checkTraditionTotals([{ id: 'sufi' }], { sufi: { books: 1 } }, [])).toThrow(/sufi/);
  });
});
