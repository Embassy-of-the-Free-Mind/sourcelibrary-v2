/**
 * Intra-block page drift (#5021): a block translation that finishes page N's last sentence
 * with page N+1's opening words (scripts/lib/block-drift.mjs), and the parser reject in both
 * block lanes that sends those two pages back to single-page translation.
 *
 * The fixtures are the real boundaries from the #4681 shadow run (EXPERIMENTS.md 2026-09-24):
 * production's three drifted boundaries, the batch lane drifting on one of them, and the
 * lane's CORRECT renderings of the same boundaries as negative controls — the same source
 * page, translated two ways, one of which must be flagged and the other not. The lane's
 * verse-boundary drift (Saffo 107→108) is a documented miss, pinned so a change that starts
 * catching it is noticed rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  detectBlockDrift, continuationFragment, dropDriftedPages, duplicatedAcrossBoundary, PAGE_BOUNDARY_RULE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/block-drift.mjs';
import {
  parseBlockResponse, blockPrompt,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-batch-seam.mjs';

type Case = { name: string; expectDrift: boolean; note: string; ocrPrev: string; ocrNext: string; trPrev: string; trNext: string };
const CASES: Case[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/block-drift/known-boundaries.json'), 'utf8'));

describe('detectBlockDrift on the #5021 boundaries', () => {
  it('has both positives and negatives to judge (the fixture is not vacuous)', () => {
    expect(CASES.filter(c => c.expectDrift).length).toBeGreaterThanOrEqual(2);
    expect(CASES.filter(c => !c.expectDrift).length).toBeGreaterThanOrEqual(4);
  });
  for (const c of CASES) {
    it(`${c.expectDrift ? 'flags' : 'passes'} ${c.name} — ${c.note}`, () => {
      expect(detectBlockDrift(c).drift).toBe(c.expectDrift);
    });
  }
});

const DUP: Case[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/block-drift/duplicated-boundary.json'), 'utf8'));

describe('duplicatedAcrossBoundary — N+1\'s opening on BOTH pages', () => {
  it(`flags ${DUP[0].name}`, () => {
    expect(duplicatedAcrossBoundary(DUP[0].trPrev, DUP[0].trNext)?.len).toBeGreaterThanOrEqual(150);
  });
  for (const c of CASES.filter(x => x.name.startsWith('production'))) {
    it(`does not call the MOVED case ${c.name} a duplicate (the clause is on one page only)`, () => {
      expect(duplicatedAcrossBoundary(c.trPrev, c.trNext)).toBeNull();
    });
  }
  it('drops both pages of a duplicated boundary', () => {
    const pages = [{ page_number: 19, ocr: { data: DUP[0].ocrPrev } }, { page_number: 20, ocr: { data: DUP[0].ocrNext } }];
    const m = new Map([[19, DUP[0].trPrev], [20, DUP[0].trNext]]);
    expect(dropDriftedPages(pages, m).drifted.map((d: any) => d.kind)).toEqual(['duplicated']);
    expect(m.size).toBe(0);
  });
});

describe('continuationFragment', () => {
  it('returns the clause a page opens with, past the page number', () => {
    expect(continuationFragment('19\n\nlicht; bei ihr fühle ich nicht nur mich selbst, ich fühle zugleich auch das Gefühl eines andern Wesens.\n\nEine reine Verbindung.'))
      .toBe('licht; bei ihr fühle ich nicht nur mich selbst, ich fühle zugleich auch das Gefühl eines andern Wesens.');
  });
  it('makes no claim on a page that opens on a sentence', () => {
    expect(continuationFragment('Eine reine, restlose Verbindung der subjektiven mit der objektiven Vorstellung.')).toBeNull();
  });
  it('makes no claim on a hyphen-completed word alone', () => {
    expect(continuationFragment('lich. Eine reine, restlose Verbindung der subjektiven Vorstellung.')).toBeNull();
  });
  it('makes no claim on scanner debris that happens to start lowercase', () => {
    expect(continuationFragment('f P Eine strengere Betonung des rein ästhetischen Verhaltens müsste nun einsetzen.')).toBeNull();
    expect(continuationFragment('va INDI GEO dARI data — Dedicatoria nel libro qui.')).toBeNull();
  });
  it('makes no claim in a caseless script', () => {
    expect(continuationFragment('وقال الشيخ رحمه الله تعالى في كتابه هذا الكلام الطويل.')).toBeNull();
  });
});

describe('the parser reject', () => {
  const drifted = CASES.find(c => c.expectDrift && c.name.startsWith('production'))!;
  const clean = CASES.find(c => !c.expectDrift && c.name.includes('Formgefühl pp. 30'))!;
  const pages = [
    { page_number: 30, ocr: { data: drifted.ocrPrev } },
    { page_number: 31, ocr: { data: drifted.ocrNext } },
  ];

  it('drops BOTH pages of a drifted boundary so they fall back to single-page', () => {
    const m = new Map([[30, drifted.trPrev], [31, drifted.trNext]]);
    const { drifted: found } = dropDriftedPages(pages, m);
    expect(found.map((d: any) => `${d.prev}→${d.next}`)).toEqual(['30→31']);
    expect(m.size).toBe(0);
  });

  it('keeps a clean block whole', () => {
    const m = new Map([[30, clean.trPrev], [31, clean.trNext]]);
    expect(dropDriftedPages(pages, m).drifted).toEqual([]);
    expect(m.size).toBe(2);
  });

  it('parseBlockResponse applies it and reports the boundary', () => {
    let seen: any[] = [];
    const out = parseBlockResponse(
      `<translation page="30">${drifted.trPrev}</translation>\n<translation page="31">${drifted.trNext}</translation>`,
      pages, { onDrift: (d: any[]) => { seen = d; } });
    expect(out.has(30)).toBe(false);
    expect(out.has(31)).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('parseBlockResponse keeps the clean rendering of the same boundary', () => {
    const out = parseBlockResponse(
      `<translation page="30">${clean.trPrev}</translation>\n<translation page="31">${clean.trNext}</translation>`, pages);
    expect([...out.keys()]).toEqual([30, 31]);
  });
});

describe('the block prompt carries the page-boundary rule', () => {
  it('in the batch lane', () => {
    const prompts = { translation: { text: 'Translate {language}.', version: 1, id: 'p', name: 't' }, english: { text: 'Modernize.', version: 1, id: 'e', name: 'e' } };
    const book = { id: 'b', title: 'T', language: 'German' };
    const pages = [1, 2].map(n => ({ page_number: n, ocr: { data: 'Text '.repeat(60) } }));
    const { prompt } = blockPrompt({ prompts, book, pages });
    expect(prompt).toContain(PAGE_BOUNDARY_RULE);
  });
  it('in the realtime worker (source check — the worker runs main() on import)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/workers/translate-worker.mjs'), 'utf8');
    expect(src).toMatch(/prompt \+= PAGE_BOUNDARY_RULE;/);
    expect(src).toMatch(/dropDriftedPages\(pages, translations\)/);
  });
});
