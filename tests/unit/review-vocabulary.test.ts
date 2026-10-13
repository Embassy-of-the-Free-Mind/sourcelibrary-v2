/**
 * The shared review vocabulary (#6203 repair 2): kinds, exposure, and rates as k of n books.
 * "Invented" was one word for six kinds, quoted from samples that mixed hidden books with served ones.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import * as v from '../../scripts/lib/review-vocabulary.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { TAXONOMY_CLASSES, parseFailureClasses, failureClassProblems, recordProblems } from '../../scripts/lib/quality-gate.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { pageFindings } from '../../scripts/eval/spot-check/check-rows.mjs';

describe('kinds', () => {
  it('names the kinds the audit asked for, once each', () => {
    expect(v.KINDS).toEqual(['confabulation', 'recitation', 'wrong_leaf', 'carry_over', 'show_through', 'illegible_fill', 'misread', 'mistranslation', 'omission', 'layout', 'added_gloss', 'other']);
    expect(v.INVENTING_KINDS).toEqual(['confabulation', 'recitation', 'wrong_leaf', 'carry_over', 'show_through', 'illegible_fill']);
  });
  it('every taxonomy class has a default kind, and no class is mapped that the taxonomy does not have', () => {
    expect(Object.keys(v.CLASS_KIND).sort()).toEqual([...TAXONOMY_CLASSES].sort());
    for (const k of Object.values(v.CLASS_KIND)) expect(v.KINDS).toContain(k);
  });
  it('the classes once all called "invented" land on different kinds', () => {
    expect(['O1', 'O3', 'I1', 'I4', 'T5', 'T7', 'T10'].map(v.kindOfClass)).toEqual(['confabulation', 'recitation', 'wrong_leaf', 'carry_over', 'carry_over', 'illegible_fill', 'added_gloss']);
    expect(v.kindOfClass('O6/O7')).toBe('misread');
    expect(v.kindOfClass('ocr-unsettled')).toBeNull();
  });
  it("a reviewer's own kind wins over the class default; an unknown kind falls back", () => {
    expect(v.kindOfFinding({ class: 'O1', kind: 'show_through' })).toBe('show_through');
    expect(v.kindOfFinding({ class: 'O1', kind: 'invented' })).toBe('confabulation');
    expect(v.kindOfFinding({ problem: 'no class' })).toBeNull();
  });
});

describe('exposure', () => {
  const live = { visible: true, pages_count: 200, language: 'Latin' };
  it('reads served / withheld / no_english / hidden off the book and page', () => {
    expect(v.exposureOf({ book: live, page: { translation: { data: 'In the beginning' } } })).toBe('served');
    expect(v.exposureOf({ book: live, page: { translation_withheld: { reason: 'x' }, ocr: { data: 'In principio' } } })).toBe('withheld');
    expect(v.exposureOf({ book: live, page: { ocr: { data: 'In principio' }, translation: { data: '  ' } } })).toBe('no_english');
    expect(v.exposureOf({ book: { ...live, visible: false }, page: { translation: { data: 'x' } } })).toBe('hidden');
    expect(v.exposureOf({ book: { visible: true, pages_count: 0 }, page: {} })).toBe('hidden');
    expect(v.exposureOf({})).toBe('hidden');
  });
  it('an English-language book serves its transcription', () => {
    expect(v.exposureOf({ book: { ...live, language: 'English' }, page: { ocr: { data: 'Of the nature of things' } } })).toBe('served');
  });
  it('a check must give one exposure per page read', () => {
    expect(v.exposureProblems([{ page_number: 1, exposure: 'served' }], [1])).toEqual([]);
    expect(v.exposureProblems([{ page_number: 1, exposure: 'served' }], [1, 2]).join()).toMatch(/exposure for page 2/);
    expect(v.exposureProblems([{ page_number: 1, exposure: 'public' }], [1]).join()).toMatch(/served \| withheld/);
    expect(v.exposureProblems(undefined, [1]).join()).toMatch(/must be a list/);
  });
});

describe('k of n books', () => {
  const row = (book: string, page: number, exposure: string, kinds: string[] = []) => ({ book_id: book, page_number: page, exposure, serious: kinds.length > 0, kinds });
  it('counts a book once however many of its pages were read', () => {
    const rows = [row('a', 1, 'served', ['misread']), row('a', 2, 'served', ['misread']), row('a', 3, 'served', ['misread']), row('b', 9, 'served')];
    const r = v.kOfNBooks(rows);
    expect(r.books).toBe(2);
    expect(r.dropped_pages).toBe(2);
    expect(r.headline.any_serious).toMatchObject({ k: 1, n: 2 });
  });
  it('the page kept for a book does not depend on what was found on it', () => {
    const clean = [1, 2, 3].map((p) => row('a', p, 'served'));
    const picked = v.onePagePerBook(clean, 7)[0].page_number;
    for (const bad of [1, 2, 3]) {
      const rows = [1, 2, 3].map((p) => row('a', p, 'served', p === bad ? ['confabulation'] : []));
      expect(v.onePagePerBook(rows, 7)[0].page_number).toBe(picked);
    }
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => v.onePagePerBook(clean, s)[0].page_number)).size).toBeGreaterThan(1);
  });
  it('the headline is served text only; hidden and withheld pages are reported apart', () => {
    const rows = [
      ...Array.from({ length: 38 }, (_, i) => row(`s${i}`, 1, 'served')), row('s38', 1, 'served', ['misread']), row('s39', 1, 'served', ['recitation', 'misread']),
      row('h1', 1, 'hidden', ['confabulation']), row('h2', 1, 'hidden', ['confabulation']), row('w1', 1, 'withheld', ['wrong_leaf']), row('n1', 1, 'no_english'),
    ];
    const r = v.kOfNBooks(rows);
    expect(r.headline.n).toBe(40);
    expect(r.headline.any_serious).toMatchObject({ k: 2, n: 40, rate: 0.05 });
    expect(r.headline.inventing).toMatchObject({ k: 1, n: 40 });
    expect(r.headline.by_kind.confabulation.k).toBe(0);          // both confabulations are in hidden books
    expect(r.by_exposure.hidden.by_kind.confabulation).toMatchObject({ k: 2, n: 2 });
    expect(r.all.inventing.k).toBe(4);                           // the number a pooled quotation would have used
    const [lo, hi] = r.headline.any_serious.ci;
    expect(lo).toBeCloseTo(0.0138, 3);                           // Wilson 95% for 2 of 40
    expect(hi).toBeCloseTo(0.1650, 3);
  });
  it('states a rate as k of n with its interval, never a bare percentage', () => {
    const r = v.kOfNBooks([row('a', 1, 'served', ['misread']), row('b', 1, 'served'), row('c', 1, 'served'), row('d', 1, 'hidden', ['wrong_leaf'])]);
    expect(v.formatKOfN(r.headline.any_serious)).toBe('1 of 3 books (33%, 95% CI 6–79%)');
    expect(v.formatKOfN({ k: 0, n: 0 })).toBe('no books read');
    const md = v.kOfNMarkdown(r, { what: 'random books', reader: 'opus' }).join('\n');
    expect(md).toContain('opus: **Served text, random books: a serious error on 1 of 3 books');
    expect(md).toContain('text not on the leaf on 0 of 3 books');
    expect(md).toContain('Not in the headline, hidden: serious on 1 of 1 books');
    expect(md).toContain('wrong leaf 1');
  });
  it('a row with no recorded exposure is its own group, never counted as served', () => {
    const r = v.kOfNBooks([row('a', 1, 'unrecorded', ['misread']), row('b', 1, undefined as unknown as string)]);
    expect(r.headline.n).toBe(0);
    expect(r.by_exposure.unrecorded.n).toBe(2);
  });
});

describe('wired into the writers', () => {
  it('the gate takes a kind per failure class, and refuses one outside the vocabulary', () => {
    expect(parseFailureClasses('O6:3,O1:2:recitation')).toEqual([{ code: 'O6', pages: 3 }, { code: 'O1', pages: 2, kind: 'recitation' }]);
    expect(failureClassProblems([{ code: 'O1', kind: 'invented' }]).join()).toMatch(/'invented' is not a kind/);
    expect(failureClassProblems([{ code: 'O1', kind: 'show_through' }])).toEqual([]);
  });
  it('a gate verdict must say who could see each sampled page', () => {
    const rec = { step: 'translate', verdict: 'GO', by: 'Derek', sample_ids: [{ book_id: 'b1', page_numbers: [1, 2] }] };
    expect(recordProblems(rec).join()).toMatch(/sample b1: exposure must be a list/);
    expect(recordProblems({ ...rec, sample_ids: [{ book_id: 'b1', page_numbers: [1, 2], exposure: [{ page_number: 1, exposure: 'served' }, { page_number: 2, exposure: 'hidden' }] }] })).toEqual([]);
  });
  it('spot-check page findings carry the kind', () => {
    const f = pageFindings([{ page_number: 4, right_page: 'yes', ocr_errors: [{ severity: 'serious', class: 'O3', problem: 'the Vulgate, not this leaf' }], tr_errors: [{ severity: 'serious', class: 'T8', kind: 'omission', problem: 'x' }] }]);
    expect(f[0].errors.map((e: { kind: string }) => e.kind)).toEqual(['recitation', 'omission']);
  });
});
