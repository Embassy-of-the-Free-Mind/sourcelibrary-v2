/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * Page-integrity detectors (scripts/lib/page-integrity.mjs): catchword continuity, printed
 * page-number sequence, duplicate scans, truncated and echoed translations.
 *
 * Every fixture is a real page from the local mirror or the #4681 batch run, chosen during the
 * 2026-09-24 hand-read: the positive controls the walk must light up, and — for each detector —
 * the false-positive SHAPES the hand-read found, pinned as negatives so a loosening is noticed.
 * The synthetic page-number sequences carry printed values copied from real books.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  catchwordBoundary, parseCatchword, pageNumberBreaks, parsePageNum, duplicateScan,
  truncationRatio, echoedSource, sourceLanguageCount, tokenMatches, readingLength, ocrReasoningLeak,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';

import {
  extremeForLanguage, TRUNC_NORM_FLAG,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/audit/page-integrity.mjs';

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/page-integrity', name), 'utf8'));
const CW = fx('catchwords.json').cases as any[];
const PN = fx('page-numbers.json').cases as any[];
const DUP = fx('duplicate-scans.json').cases as any[];
const TR = fx('translations.json');

describe('catchword continuity', () => {
  it('reads the catchword out of <meta>, and refuses a CJK fore-edge title', () => {
    expect(parseCatchword('<meta>catchword: QUEM; red library stamp</meta>')).toMatchObject({ judged: true, tokens: ['quem'] });
    expect(parseCatchword('<meta>catchword: Deli-</meta>')).toMatchObject({ judged: true, partial: true });
    expect(parseCatchword('<meta>catchword: 書藝四</meta>')).toEqual({ judged: false, why: 'cjk-fore-edge' });
    expect(parseCatchword('<meta>none</meta>')).toBeNull();
  });
  it('matches through long-s and one misread Fraktur letter, not through a different word', () => {
    expect(tokenMatches('fic', 'sic')).toBe(true);
    expect(tokenMatches('scin', 'sein')).toBe(true);
    expect(tokenMatches('testan', 'testantur')).toBe(true);
    expect(tokenMatches('nam', 'nimm')).toBe(false);
  });
  it('has positives, negatives and an unjudged case (the fixture is not vacuous)', () => {
    expect(CW.filter(c => c.expect.ok === true).length).toBeGreaterThanOrEqual(1);
    expect(CW.filter(c => c.expect.ok === false).length).toBeGreaterThanOrEqual(1);
    expect(CW.filter(c => c.expect.judged === false).length).toBeGreaterThanOrEqual(1);
  });
  for (const c of CW) {
    it(c.name, () => {
      expect(catchwordBoundary(c.pages, c.i)).toMatchObject(c.expect);
    });
  }
});

describe('printed page-number sequence', () => {
  it('parses arabic, roman, folio sides, spreads and native digits', () => {
    expect(parsePageNum('<page-num>189</page-num>')).toMatchObject({ kind: 'arabic', value: 189 });
    expect(parsePageNum('<page-num>xxvi</page-num>')).toMatchObject({ kind: 'roman', value: 26 });
    expect(parsePageNum('<page-num>12v</page-num>')).toMatchObject({ kind: 'folio', value: 25 });
    expect(parsePageNum('<page-num>13, 14</page-num>')).toMatchObject({ kind: 'arabic', value: 13, span: 2 });
    expect(parsePageNum('<page-num>२२</page-num>')).toMatchObject({ kind: 'arabic', value: 22 });
    expect(parsePageNum('no tag')).toBeNull();
  });
  for (const c of PN) {
    it(c.name, () => {
      const r = pageNumberBreaks(c.pages);
      if (c.includes) {
        for (const e of c.expect) expect(r.breaks).toContainEqual(expect.objectContaining(e));
        expect(r.breaks.filter((b: any) => b.shape === 'misnumbered' && b.fromValue === 139)).toEqual([]);
      } else {
        expect(r.breaks.length).toBe(c.expect.length);
        c.expect.forEach((e: any, k: number) => expect(r.breaks[k]).toMatchObject(e));
      }
      if (c.outliers != null) expect(r.outliers.length).toBe(c.outliers);
      if (c.irregular) expect(Object.values(r.kinds).some((k: any) => k.why === 'irregular')).toBe(true);
    });
  }
});

describe('duplicate scans', () => {
  for (const c of DUP) {
    it(`${c.expect ? 'flags' : 'passes'} ${c.name}`, () => {
      const d = duplicateScan(c.a.ocr, c.b.ocr);
      expect(d.judged).toBe(true);
      expect(d.dup).toBe(c.expect);
    });
  }
  it('refuses to judge a short page', () => {
    expect(duplicateScan('<page-type>text</page-type>\nshort', 'short')).toEqual({ judged: false, why: 'short' });
  });
});

describe('truncated translations', () => {
  const FLAG = 0.5;
  for (const c of TR.truncation) {
    it(`${c.expect} — ${c.name}`, () => {
      const t = truncationRatio(c.page);
      if (c.expect === 'unjudged') { expect(t).toEqual({ judged: false, why: c.why }); return; }
      expect(t.judged).toBe(true);
      const norm = t.ratio / TR.median[c.lang];
      expect(norm < FLAG).toBe(c.expect === 'flag');
    });
  }
  it('measures reading length, not markup: entities, LaTeX commands and [unclear] count for nothing', () => {
    expect(readingLength('&lambda;&omicron;&gamma;')).toBe(3);
    expect(readingLength('$\\overline{\\pi\\delta}$')).toBe(0);
    expect(readingLength('[unclear] [unclear] Bocasse')).toBe(7);
    expect(readingLength('| | | 12 |')).toBe(2);
  });
  it('recognises leaked model reasoning, and not ordinary text', () => {
    expect(ocrReasoningLeak('thought The user wants a transcription of a historical manuscript page')).toBe(true);
    expect(ocrReasoningLeak('<language>Latin</language>\nQuemadmodum in Palatio rotundo')).toBe(false);
    // the hand-read's false shape: English prose whose first line starts with the word
    expect(ocrReasoningLeak('thought by examination of the structure of a proposition.')).toBe(false);
    expect(ocrReasoningLeak('164  ST. AMBROSE.\nthought that he was restored to us')).toBe(false);
  });
  it('counts the languages the OCR tag names, ignoring parentheticals', () => {
    expect(sourceLanguageCount('<language>Greek, Latin</language>')).toBe(2);
    expect(sourceLanguageCount('<language>Latin (with Greek)</language>')).toBe(1);
  });
});

describe('truncation needs an extreme ratio where a language varies widely', () => {
  const R = TR.languageRule;
  for (const c of R.cases) {
    it(`${c.expect} — ${c.name}`, () => {
      const ratio = c.ratio ?? truncationRatio(c.page).ratio;
      const med = R.detail[c.lang].median;
      const flagged = ratio / med < TRUNC_NORM_FLAG && extremeForLanguage(ratio, c.lang, R.detail);
      expect(flagged).toBe(c.expect === 'flag');
    });
  }
});

describe('echoed source', () => {
  it('has positives and negatives', () => {
    expect(TR.echo.filter((c: any) => c.expect).length).toBeGreaterThanOrEqual(2);
    expect(TR.echo.filter((c: any) => !c.expect).length).toBeGreaterThanOrEqual(4);
  });
  for (const c of TR.echo) {
    it(`${c.expect ? 'flags' : 'passes'} ${c.name}`, () => {
      const e = echoedSource({ ocr: c.page.ocr, tr: c.page.tr, lang: c.lang });
      expect(e.judged).toBe(true);
      expect(e.echo).toBe(c.expect);
      if (c.wholePage != null) expect(e.wholePage).toBe(c.wholePage);
    });
  }
  it('never judges an English source (a modernisation shares text by design)', () => {
    expect(echoedSource({ ocr: 'x', tr: 'y', lang: 'english' })).toEqual({ judged: false, why: 'english-source' });
  });
});
