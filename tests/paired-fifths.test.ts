// PRIOR ART: none — git grep "fifth" over tests/ found no test of a page draw; the #7866 draw had none.
import { describe, expect, it } from 'vitest';
import { PAIRED_SKIP_PAGE_TYPES, pairedFifths, pairedReadingOrder, type DrawPage } from '../src/lib/paired-fifths';
import * as scripts from '../scripts/lib/paired-fifths.mjs';
import { SKIP_TYPES } from '../scripts/eval/confidence-7866/lib.mjs';
import { pageVerdict } from '../scripts/eval/paired-fifths-check.mjs';
import { joinPrompt } from '../scripts/eval/paired-fifths-8405/run.mjs';

describe('paired-fifths-check page mapping (#8405)', () => {
  const page = { id: 'p1', ocr: { data: 'x' }, translation: { data: 'y' } };
  const clean = { accept: true, fidelity: 5, defects: [] };
  // recordPageVerdicts refuses a row unless a serious page, and only a serious page, has a finding.
  const consistent = (v: { outcome: string; errors: unknown[]; wrong_page?: boolean }) => (v.outcome === 'serious') === (v.errors.length > 0 || v.wrong_page === true);

  it('a clean page with a clean break shows', () => {
    const v = pageVerdict(page, clean, []);
    expect(v).toMatchObject({ outcome: 'clean', page_verdict: 'show' });
    expect(consistent(v)).toBe(true);
  });
  it('a carry-over at the break makes a clean page serious, a caveat, on the English stage', () => {
    const v = pageVerdict(page, clean, [{ kind: 'carry_over', layer: 'english', page: 'B', quote: 'q', material: true }]);
    expect(v).toMatchObject({ outcome: 'serious', page_verdict: 'caveat' });
    expect(v.errors[0]).toMatchObject({ stage: 'translation', kind: 'carry_over' });
    expect(consistent(v)).toBe(true);
  });
  it('a wrong-leaf break is a fix and marks the page wrong_page', () => {
    const v = pageVerdict(page, clean, [{ kind: 'wrong_leaf', layer: 'transcription', page: 'A', quote: 'q', material: true }]);
    expect(v).toMatchObject({ page_verdict: 'fix', wrong_page: true });
    expect(consistent(v)).toBe(true);
  });
  it('fidelity 3 is serious, 2 is a fix, 4 is minor', () => {
    const d = [{ severity: 'misleads', what: 'w', class: 'O6' }];
    expect(pageVerdict(page, { accept: false, fidelity: 3, defects: d }, [])).toMatchObject({ outcome: 'serious', page_verdict: 'caveat' });
    expect(pageVerdict(page, { accept: false, fidelity: 2, defects: d }, [])).toMatchObject({ page_verdict: 'fix' });
    expect(pageVerdict(page, { accept: true, fidelity: 4, defects: [] }, [])).toMatchObject({ outcome: 'minor', page_verdict: 'show' });
  });
  it('join prompt v2 adds the sentence-across-the-break rule; v1 is the study prompt unchanged', () => {
    const a = { ocr: 'a', tr: 'a' }, b = { ocr: 'b', tr: 'b' };
    expect(joinPrompt('Latin', a, b)).not.toContain('translators finish a sentence');
    expect(joinPrompt('Latin', a, b, { version: 2 })).toContain('translators finish a sentence');
  });
});

const book = (n: number, ineligible: number[] = []): DrawPage[] =>
  Array.from({ length: n }, (_, i) => ({ page_number: i + 1, eligible: !ineligible.includes(i + 1) }));

describe('pairedFifths (#8405)', () => {
  it('draws 5 adjacent pairs, one anchored in each fifth, 10 distinct pages', () => {
    const pairs = pairedFifths(book(200), 'book-a');
    expect(pairs).toHaveLength(5);
    pairs.forEach((p, k) => {
      expect(p.fifth).toBe(k + 1);
      expect(p.second - p.first).toBe(1);
      expect(p.anchor).toBeGreaterThan(k * 40);
      expect(p.anchor).toBeLessThanOrEqual((k + 1) * 40);
    });
    expect(new Set(pairedReadingOrder(pairs)).size).toBe(10);
  });

  it('is deterministic by book id and differs between books', () => {
    const pages = book(300);
    expect(pairedFifths(pages, 'x')).toEqual(pairedFifths(pages, 'x'));
    expect(pairedFifths(pages, 'x')).not.toEqual(pairedFifths(pages, 'y'));
  });

  it('never pairs with an ineligible page, and falls back to the previous page', () => {
    // Every even page ineligible: no two eligible pages are adjacent, so no pair exists.
    const even = Array.from({ length: 50 }, (_, i) => 2 * i + 2);
    expect(pairedFifths(book(100, even), 's')).toHaveLength(0);
    // Pages 1-18 and 21 ineligible: in the first fifth only 19 and 20 can pair, and 20's next is out, so (19, 20).
    const first = pairedFifths(book(100, [...Array.from({ length: 18 }, (_, i) => i + 1), 21]), 's')[0];
    expect([first.first, first.second]).toEqual([19, 20]);
  });

  it('gives a short book fewer pairs rather than reusing pages', () => {
    const order = pairedReadingOrder(pairedFifths(book(6), 'short'));
    expect(new Set(order).size).toBe(order.length);
    expect(order.length).toBeLessThanOrEqual(6);
  });

  it('the scripts copy draws exactly the same pages', () => {
    const cases: Array<[number, string, number[]]> = [[200, 'a', []], [37, 'b', [3, 4, 9, 20]], [1000, 'c', [100, 101, 102]], [7, 'd', [2]]];
    for (const [n, seed, holes] of cases) {
      const pages = book(n, holes);
      expect(scripts.pairedFifths(pages, seed)).toEqual(pairedFifths(pages, seed));
    }
  });

  it('skips the same page types as the #7866 draw', () => {
    expect([...PAIRED_SKIP_PAGE_TYPES]).toEqual(SKIP_TYPES);
  });

  it('pairsFromAnchors keeps the old anchors and adds a neighbour', () => {
    const pairs = scripts.pairsFromAnchors(book(100, [21]), [5, 20, 50, 70, 100]);
    expect(pairs.map((p: { anchor: number }) => p.anchor)).toEqual([5, 20, 50, 70, 100]);
    expect(pairs[0]).toMatchObject({ first: 5, second: 6 });
    expect(pairs[1]).toMatchObject({ first: 19, second: 20 }); // 21 ineligible → previous
    expect(pairs[4]).toMatchObject({ first: 99, second: 100 }); // last page → previous
  });
});
