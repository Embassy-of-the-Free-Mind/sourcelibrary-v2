/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * Leaf-alignment signals (scripts/lib/leaf-alignment.mjs, #7866). The positives are shaped on the two books contained on
 * #7866: 6a4cb635… (one opening's text on pp. 2, 8, 12, 14; full text on 48 KB images whose neighbours weigh 700 KB) and
 * 69af4864… (bulk_jp2 images three leaves off their text). The negatives pin the false-alarm shapes met on 2026-11-01:
 * a herbal whose plates alternate with their description, and a liturgical refrain repeated on every page.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore -- plain .mjs
import { proseOf, shingles, repeats, inkMismatch, offsetScan, offsetByWriter, bookSignals, strongRepeat, imageOff, confirmed, letterShare } from '../../scripts/lib/leaf-alignment.mjs';

const LOREM = 'Tanta huius quod suam proxime metam constitutum videmus seculi rerum gestarum magnitudo est ut nemo facile omnia complecti possit';
// Letter-only pseudo-words (the fold keeps letters only), distinct per seed and position.
const word = (x: number) => Array.from({ length: 4 }, (_, k) => 'bcdfghklmnprstxz'[(x >> (k * 4)) & 15]).join('');
const words = (seed: number, n = 120) => Array.from({ length: n }, (_, i) => word((seed * 7919 + i * 104729) % 65521)).join(' ');
const page = (p: number, prose: string, extra: any = {}) => ({ p, prose, bodyLen: prose.length, blank: !prose, illus: false, type: 'text', bytes: null, src: null, w: null, h: null, ...extra });

describe('proseOf', () => {
  it('reads a blank-page note and a blank page-type as blank', () => {
    expect(proseOf('<page-type>text</page-type>\n[This page is blank.]').blank).toBe(true);
    expect(proseOf('<page-type>blank</page-type>\n').blank).toBe(true);
    expect(proseOf(`<page-type>text</page-type>\n${LOREM}`).blank).toBe(false);
  });
});

describe('repeats', () => {
  it('finds one opening repeated on non-adjacent pages (6a4cb635… shape)', () => {
    const rows = Array.from({ length: 22 }, (_, i) => page(i + 1, [2, 8, 12, 14].includes(i + 1) ? `${LOREM} ${words(999)}` : words(i + 1)));
    const r = repeats(rows);
    expect(r.judged).toBe(true);
    expect(r.pairs.map((x: any) => `${x.a}-${x.b}`)).toEqual(['2-8', '2-12', '2-14', '8-12', '8-14', '12-14']);
  });
  it('drops a refrain that sits on more than a quarter of the pages', () => {
    const refrain = words(4242, 40);
    const rows = Array.from({ length: 20 }, (_, i) => page(i + 1, `${words(i + 1, 80)} ${refrain}`));
    expect(repeats(rows).pairs).toEqual([]);
  });
  it('shingles an unsegmented script by letters', () => {
    expect(shingles('辣椒處處有之江西湖南黔蜀種以爲蔬其種尖圓大小不一有柿子筆管朝天諸名蔬譜本草皆未晰').size).toBeGreaterThan(10);
  });
});

describe('inkMismatch', () => {
  it('flags full text on a near-blank image, by the writer median', () => {
    const rows = Array.from({ length: 20 }, (_, i) => page(i + 1, words(i, 100), { bytes: i + 1 === 2 ? 48337 : 695000, w: 2000, h: 3500 }));
    const r = inkMismatch(rows);
    expect(r.textOnBlank.map((x: any) => x.p)).toEqual([2]);
  });
  it('ignores scanner noise on a blank leaf (6ab2477c… p.212)', () => {
    const noise = '" ‘ 4 ‘ ‘ « bes -— « rr. irk +h r = 7 an ms ae aa : Salle Pat aod ) ; w Py is i . om) a, ; pe . ‘tS é 4 \\ \' > ras | , r ; ; 5 e \' : pike. + : 3 r'.repeat(3);
    expect(letterShare(noise)).toBeLessThan(0.7);
    const rows = Array.from({ length: 20 }, (_, i) => page(i + 1, i === 1 ? noise : words(i, 100), { bytes: i === 1 ? 40000 : 695000, w: 2000, h: 3500 }));
    expect(inkMismatch(rows).textOnBlank).toEqual([]);
  });
  it('is unjudged with no stored bytes', () => {
    expect(inkMismatch([page(1, words(1))]).judged).toBe(false);
  });
});

describe('offsetScan', () => {
  // Text lengths with blank leaves and short chapter ends; image weight follows the text it shows.
  const lens = Array.from({ length: 120 }, (_, i) => (i % 17 === 0 ? 0 : i % 11 === 0 ? 150 : 1800 + ((i * 37) % 600)));
  const imgFor = (len: number) => 200000 + len * 300;
  it('peaks at 0 on an aligned book', () => {
    const rows = lens.map((L, i) => ({ ...page(i + 1, L ? 'x' : ''), bodyLen: L, blank: !L, bytes: imgFor(L), w: 2000, h: 3000 }));
    const r = offsetScan(rows);
    expect(r.judged).toBe(true);
    expect(r.best).toBe(0);
    expect(r.shifted).toBe(false);
  });
  it('finds images three leaves after their text (69af4864… shape)', () => {
    const rows = lens.map((L, i) => ({ ...page(i + 1, L ? 'x' : ''), bodyLen: L, blank: !L, bytes: imgFor(lens[i - 3] ?? 1800), w: 2000, h: 3000, src: 'bulk_jp2' }));
    const r = offsetScan(rows);
    expect(r.best).toBe(3);
    expect(r.shifted).toBe(true);
    expect(offsetByWriter(rows).bulk_jp2.best).toBe(3);
  });
  it('leaves illustrated pages out (a herbal: plate, then its text)', () => {
    const rows = Array.from({ length: 120 }, (_, i) => {
      const plate = i % 2 === 0;
      return { ...page(i + 1, 'x'), bodyLen: plate ? 20 : 900 + ((i * 53) % 400), illus: plate, bytes: plate ? 650000 : 300000 + ((i * 53) % 400) * 300, w: 1900, h: 3000 };
    });
    expect(offsetScan(rows).shifted).toBe(false);
  });
  it('abstains on a short book', () => {
    expect(offsetScan([page(1, 'x', { bytes: 1, w: 1, h: 1 })]).judged).toBe(false);
  });
});

describe('bookSignals', () => {
  it('scores nothing on a clean book', () => {
    const rows = Array.from({ length: 40 }, (_, i) => page(i + 1, words(i + 1), { bytes: 700000 + (i % 3) * 1000, w: 2000, h: 3000 }));
    expect(bookSignals(rows).score).toBe(0);
  });
});

describe('confirmation rules', () => {
  const pair = (o: any) => ({ a: 2, b: 12, gap: 10, contain: 0.95, nA: 120, nB: 118, front: false, ...o });
  it('confirms the whole text on two different images', () => {
    expect(strongRepeat(pair({}), 30)).toBe(true);
  });
  it('refuses the shapes found by eye: a title repeated by its wrapper, a leaf re-shot in a spread or under a card', () => {
    expect(strongRepeat(pair({ front: true }), 30)).toBe(false);          // wrapper and title page
    expect(strongRepeat(pair({ nA: 22, nB: 60 }), 31)).toBe(false);       // the single page inside a spread
    expect(strongRepeat(pair({ nA: 34, nB: 117 }), 30)).toBe(false);      // lines visible above a calibration card
    expect(strongRepeat(pair({}), 8)).toBe(false);                         // the same image twice: a repeat capture
  });
  it('counts a growing shift (k differs page to page) and not a single off page', () => {
    expect(imageOff({ offset: [{ k: -6 }, { k: -4 }, { k: 'undecided' }] })).toHaveLength(2);
    expect(confirmed({ offset: [{ k: -6 }, { k: -4 }], blankConfirmed: [], repeat: [] }, null)?.[0]).toMatch(/-6\/-4 leaves off/);
    expect(confirmed({ offset: [{ k: -2 }, { k: 'undecided' }, { k: 'undecided' }], blankConfirmed: [], repeat: [] }, null)).toBeNull();
    expect(confirmed({ offset: [{ k: 0 }, { k: 0 }, { k: 0 }], blankConfirmed: [], repeat: [] }, null)).toBeNull();
  });
});
