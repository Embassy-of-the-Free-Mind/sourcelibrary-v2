/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * leaf-order-sharpen (scripts/lib/leaf-order-sharpen.mjs, #5059): what each printed page-number
 * break IS. The books are synthetic (seeded pseudo-Latin, one distinct page per scan) so that
 * each one holds exactly ONE defect; the shapes are the ones the 2026-10-13 hand-reads found —
 * a noisier second OCR under the walk's Dice 0.9, a section photographed twice, a catchword cut
 * short at the foot ("Aspe-" | "Aspera componi"), a word broken at the foot that the head never
 * finishes. Every positive has its negative beside it.
 */
import { describe, it, expect } from 'vitest';
import {
  sharpenBook, seamText, SHARP_DUP_DICE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/leaf-order-sharpen.mjs';
import {
  pageNumberBreaks, duplicateScan, DUP_MIN_DICE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';

const VOCAB = ('materia forma spiritus corpus anima ignis aqua terra aer sal sulphur mercurius lapis opus natura ars tempus locus motus causa ' +
  'ratio sensus lumen tenebra calor frigus humor siccitas virtus potentia actus finis principium medium ordo numerus pondus mensura metallum ' +
  'aurum argentum plumbum stannum ferrum cuprum vitrum vas fornax cinis fumus vapor ros pluvia semen radix flos fructus arbor herba').split(' ');

/** `n` words of seeded prose: distinct per seed, so no two scans resemble each other by accident. */
function prose(seed: number, n = 90): string[] {
  let a = (seed * 2654435761) >>> 0;
  const out: string[] = [];
  for (let i = 0; i < n; i++) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; out.push(VOCAB[a % VOCAB.length]); }
  return out;
}
const page = (p: number, num: number | null, words: string[], extra: any = {}) =>
  ({ p, ocr: `${num == null ? '' : `<page-num>${num}</page-num>\n`}${words.join(' ')}.`, type: 'text', ...extra });

/** A clean book: scan p carries printed number p + offset and its own text. */
const book = (n: number, offset = 10) => Array.from({ length: n }, (_, i) => page(i + 1, i + 1 + offset, prose(i + 1), { leaf: i }));

/** The listed row a walk would have produced for the break between scans `from` and `to`. */
function listed(pages: any[], from: number, to: number) {
  const b = pageNumberBreaks(pages).breaks.find((x: any) => x.from === from && x.to === to);
  if (!b) throw new Error(`fixture has no break at ${from}->${to}`);
  return { book: 'b', visible: true, from, to, fromValue: b.fromValue, toValue: b.toValue, shape: b.shape, d: b.d, numbering: b.numbering, corroborated: false };
}
const one = (pages: any[], from: number, to: number) => sharpenBook(pages, [listed(pages, from, to)])[0];

describe('a copy the walk\'s Dice 0.9 missed', () => {
  // scan 13 is scan 12 photographed again and read worse: every twelfth word misread
  const noisy = (w: string[]) => w.map((x, i) => (i % 12 === 4 ? x.slice(0, -1) + 'x' : x));
  const pages = book(24);
  pages.splice(12, 0, page(0, 22, noisy(prose(12)), { leaf: 99 }));
  pages.forEach((r, i) => { r.p = i + 1; });

  it('the fixture sits between the two thresholds', () => {
    const d = duplicateScan(pages[11].ocr, pages[12].ocr);
    expect(d.dice).toBeGreaterThanOrEqual(SHARP_DUP_DICE);
    expect(d.dice).toBeLessThan(DUP_MIN_DICE);
  });
  it('is a duplicate, with the copy and its original named', () => {
    expect(one(pages, 12, 13)).toMatchObject({ verdict: 'duplicate', why: 'near', page: 13, copyOf: 12 });
  });
  it('a repeated NUMBER over different text is not a copy', () => {
    // the printer used 22 twice and carried on: scans 12 and 13 both say 22, the text differs
    const b = book(12);
    for (let k = 0; k < 12; k++) b.push(page(13 + k, 22 + k, prose(500 + k), { leaf: 12 + k }));
    const r = one(b, 12, 13);
    expect(r.verdict).toBe('unresolved');
    expect(r.dupJudged).toBe(true);
    expect(r.dice).toBeLessThan(0.3);
  });
  it('a copy several boundaries away explains nothing here', () => {
    // a jump of 2 after scan 12; scan 20 is a noisy copy of scan 19, eight scans further on
    const b = book(12);
    for (let k = 0; k < 14; k++) b.push(page(13 + k, 25 + k, prose(200 + k), { leaf: 12 + k }));
    b[19] = page(20, 32, noisy(prose(206)), { leaf: 19 });
    expect(duplicateScan(b[18].ocr, b[19].ocr).dice).toBeGreaterThanOrEqual(SHARP_DUP_DICE);
    expect(one(b, 12, 13).verdict).toBe('unresolved');
  });
});

describe('a section photographed twice (far copy)', () => {
  // scans 1–14 run 11–24, then 15–19 are scans 8–12 again (printed 18–22), then the book goes on
  const pages = book(14);
  for (let k = 0; k < 5; k++) pages.push(page(15 + k, 18 + k, prose(8 + k), { leaf: 14 + k }));
  for (let k = 0; k < 8; k++) pages.push(page(20 + k, 25 + k, prose(100 + k), { leaf: 19 + k }));

  it('the back-step is a duplicate of the earlier scan printed with the same number', () => {
    expect(one(pages, 14, 15)).toMatchObject({ verdict: 'duplicate', why: 'far', page: 15, copyOf: 8, dice: 1 });
  });
  it('a back-step onto different text stays unresolved', () => {
    const b = pages.map(r => ({ ...r }));
    for (let k = 0; k < 5; k++) b[14 + k] = page(15 + k, 18 + k, prose(700 + k), { leaf: 14 + k });
    expect(one(b, 14, 15).verdict).toBe('unresolved');
  });
});

describe('a jump between neighbouring scans', () => {
  /** scans 1–12 run 11–22, then the numbers jump by `skip` */
  const jumped = (skip: number, foot?: string, head?: string, leafGap = 0) => {
    const b = book(12);
    for (let k = 0; k < 10; k++) b.push(page(13 + k, 23 + skip + k, prose(200 + k), { leaf: 12 + leafGap + k }));
    if (foot) b[11].ocr = `<page-num>22</page-num>\n${prose(12).join(' ')} ${foot}`;
    if (head) b[12].ocr = `<page-num>${23 + skip}</page-num>\n${head} ${prose(200).join(' ')}.`;
    return b;
  };

  it('a word broken at the foot that the head does not finish: text is missing', () => {
    expect(one(jumped(2, 'Necati verò sunt Philippi, pater & filius: Decij dolo. Qui viuentibus adhuc Philip-', 'Gothis ) fecit, Populo Romano turpem & ignominiosam:'), 12, 13))
      .toMatchObject({ verdict: 'text-breaks', why: 'split-word-unfinished', sourceLeaves: 'consecutive' });
  });
  it('the same foot before a catchword cut short is a misnumbering, not a missing leaf', () => {
    expect(one(jumped(2, 'Si nostro hinc fiat corpore morbus, amat. Aspe-', 'Aspera componi, satiari austera requirunt,'), 12, 13))
      .toMatchObject({ verdict: 'misnumbered', why: 'catchword-fragment' });
    expect(one(jumped(21, 'veluti partium constipatione. Quin-', 'I. Quintò. Rursus, ex eadem fonte'), 12, 13))
      .toMatchObject({ verdict: 'misnumbered', why: 'catchword-fragment' });
  });
  it('a running head in capitals above the resumed word is not a break', () => {
    const r = one(jumped(2, 'il part de là pour se donner car-', 'INTRODUCTION. rière; et, recueillant les éléments épars'), 12, 13);
    expect(r.verdict).toBe('unresolved');
    expect(one(jumped(2, 'sur le Cosmopolite & Sen-', 'T A B L E divogius, 334 Démocrite apprend'), 12, 13).verdict).toBe('unresolved');
  });
  it('a sentence merely left open is NOT evidence either way', () => {
    const r = one(jumped(2, 'I would at least have forsaken', 'me had been vouchsafed'), 12, 13);
    expect(r).toMatchObject({ verdict: 'unresolved', sourceLeaves: 'consecutive' });
  });
  it('the source holds leaves between the two scans: the leaf was skipped on import', () => {
    expect(one(jumped(2, undefined, undefined, 2), 12, 13)).toMatchObject({ verdict: 'leaf-skipped', leafGap: 2, sourceLeaves: 'gap' });
  });
  it('no leaf index is no evidence: the row says nothing about the source', () => {
    const b = jumped(2).map(({ leaf: _leaf, ...r }: any) => r);
    const r = one(b, 12, 13);
    expect(r.verdict).toBe('unresolved');
    expect(r.sourceLeaves).toBeUndefined();
  });
  it('numbers too far apart to be one sequence are not judged', () => {
    expect(one(jumped(570), 12, 13).verdict).toBe('far-off');
  });
  it('seamText gives the reader the foot and the head as prose, tags stripped', () => {
    const s = seamText(jumped(2, 'ultima verba', 'Prima verba'), 12, 13, 40);
    expect(s.foot.endsWith('ultima verba')).toBe(true);
    expect(s.head.startsWith('Prima verba')).toBe(true);
    expect(s.foot + s.head).not.toMatch(/page-num|\d\d/);
  });
});

describe('a listed break that the stored text no longer shows', () => {
  it('is gone when the pair is in order now, and when a page of it left the book', () => {
    const clean = book(20);
    const stale = { book: 'b', visible: true, from: 12, to: 13, fromValue: 22, toValue: 25, shape: 'jump', d: 2, numbering: 'arabic', corroborated: false };
    expect(sharpenBook(clean, [stale])[0]).toMatchObject({ verdict: 'gone', why: 'no-longer-a-break' });
    expect(sharpenBook(clean, [{ ...stale, to: 99 }])[0]).toMatchObject({ verdict: 'gone', why: 'page-absent' });
  });
});

describe('text that cannot be compared is unjudged, never "no copy"', () => {
  it('pages too short for a Dice say dupJudged: false', () => {
    const b = Array.from({ length: 20 }, (_, i) => page(i + 1, i + 11 + (i >= 12 ? 2 : 0), prose(i + 1, 6), { leaf: i }));
    const r = one(b, 12, 13);
    expect(r.dupJudged).toBe(false);
    expect(r.verdict).toBe('unresolved');
    expect(r.dice).toBeUndefined();
  });
});
