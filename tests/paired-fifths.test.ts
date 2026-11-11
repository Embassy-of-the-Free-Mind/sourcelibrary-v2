// PRIOR ART: none — git grep "fifth" over tests/ found no test of a page draw; the #7866 draw had none.
import { describe, expect, it } from 'vitest';
import { PAIRED_SKIP_PAGE_TYPES, pairedFifths, pairedReadingOrder, type DrawPage } from '../src/lib/paired-fifths';
import * as scripts from '../scripts/lib/paired-fifths.mjs';
import { SKIP_TYPES } from '../scripts/eval/confidence-7866/lib.mjs';
import { pageVerdict, pairVerdicts, parseBatch, batchPrompt, METHOD } from '../scripts/eval/paired-fifths-check.mjs';
import { createHash } from 'node:crypto';
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

describe('paired-fifths-check v2: one Opus call per facing pair (P5, #8478/#8518)', () => {
  const A = { id: 'pa', ocr: { data: 'a' }, translation: { data: 'A' } }, B = { id: 'pb', ocr: { data: 'b' }, translation: { data: 'B' } };
  const ok = { accept: true, fidelity: 5, en_accept: true, defects: [] };
  const judged = (pages: unknown[], defects: unknown[] = []) => ({ pages, breaks: [{ break: 'p01/p02', join: defects.length ? 'defect' : 'clean', defects }] });

  it('is method version 2 (the registry line must match)', () => expect(METHOD.version).toBe('2'));
  it('an English misleads defect is serious on the translation stage even at fidelity 5 (the page_defect control)', () => {
    const v = pageVerdict(A, { ...ok, en_accept: false, defects: [{ layer: 'english', class: 'T2', severity: 'misleads', what: '"not" added' }] }, []);
    expect(v).toMatchObject({ outcome: 'serious', page_verdict: 'caveat' });
    expect(v.errors).toEqual([{ stage: 'translation', class: 'T2', problem: '"not" added' }]);
  });
  it('a transcription misleads defect still counts only at fidelity <= 3, as v1', () => {
    const d = [{ layer: 'transcription', severity: 'misleads', what: 'w' }];
    expect(pageVerdict(A, { ...ok, fidelity: 4, defects: d }, [])).toMatchObject({ outcome: 'minor', page_verdict: 'show' });
    expect(pageVerdict(A, { ...ok, fidelity: 3, defects: d }, []).errors[0].stage).toBe('ocr');
  });
  it('English not accepted with no serious defect is minor, not clean', () => {
    expect(pageVerdict(A, { ...ok, en_accept: false }, [])).toMatchObject({ outcome: 'minor', page_verdict: 'show' });
  });
  it('pairVerdicts gives each break defect to the page it names, material ones only', () => {
    const [va, vb] = pairVerdicts(A, B, judged([ok, ok], [
      { kind: 'carry_over', layer: 'english', page: 'B', quote: 'q', material: true },
      { kind: 'duplicated', layer: 'transcription', page: 'A', quote: 'r', material: false },
    ]));
    expect(va).toMatchObject({ page_id: 'pa', outcome: 'clean', page_verdict: 'show' });
    expect(vb).toMatchObject({ page_id: 'pb', outcome: 'serious', page_verdict: 'caveat' });
    expect(vb.errors[0]).toMatchObject({ stage: 'translation', kind: 'carry_over' });
  });
  it('pairVerdicts follows the page names when the judge lists them out of order', () => {
    const bad = { ...ok, fidelity: 2, page: 'p02' };
    const [va, vb] = pairVerdicts(A, B, judged([bad, { ...ok, page: 'p01' }]));
    expect(va.page_verdict).toBe('show');
    expect(vb.page_verdict).toBe('fix');
  });
  it('a wrong-leaf break or an I1 page defect is a fix (the wrong-leaf control)', () => {
    expect(pairVerdicts(A, B, judged([ok, ok], [{ kind: 'wrong_leaf', layer: 'transcription', page: 'B', quote: 'q', material: true }]))[1]).toMatchObject({ page_verdict: 'fix', wrong_page: true });
    expect(pageVerdict(A, { ...ok, defects: [{ layer: 'transcription', class: 'I1', severity: 'wrong_text', what: 'other leaf' }] }, [])).toMatchObject({ page_verdict: 'fix', wrong_page: true });
  });
  it('drops an empty quote or class the judge returned, which would make the whole book_checks row be refused (#8518)', () => {
    const v = pageVerdict(A, { ...ok, fidelity: 2, defects: [{ layer: 'transcription', class: '', quote: '', severity: 'wrong_text', what: 'w' }] }, []);
    expect(v.defects).toEqual([{ layer: 'transcription', severity: 'wrong_text', what: 'w' }]);
    expect(v.errors[0]).not.toHaveProperty('class');
  });
  it('parseBatch takes one entry per page and per break, and refuses anything else', () => {
    const good = JSON.stringify({ opened: ['p01.jpg', 'p02.jpg'], ...judged([ok, ok]) });
    expect(parseBatch(`text before ${good}`, 2)?.pages).toHaveLength(2);
    expect(parseBatch(JSON.stringify(judged([ok])), 2)).toBeNull();
    expect(parseBatch(JSON.stringify(judged([ok, { ...ok, fidelity: 9 }])), 2)).toBeNull();
    expect(parseBatch('no json', 2)).toBeNull();
  });
  it('the pair prompt is the one #8478 validated: changing it is a method version bump', () => {
    const p = batchPrompt('Latin', [{ page_number: 3, ocr: 'Lorem ipsum', tr: 'The text' }, { page_number: 4, ocr: 'dolor', tr: '' }]);
    expect(p).toContain('Open both images with Read before you answer: ./p01.jpg, ./p02.jpg');
    expect(p).toContain('PART 2, EACH BREAK between the two pages of a pair (p01/p02)');
    expect(p).toContain('ENGLISH:\n<<<\n(none)\n>>>');
    // Byte-identical to callshape-8478 batchPrompt for this input (checked 2026-11-10). If the route-judge questions or
    // the join rules change, this fails: re-validate on the #8478 controls and bump METHOD.version and the method doc.
    expect(createHash('sha256').update(p).digest('hex').slice(0, 16)).toBe('419dfb07113c9be5');
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
