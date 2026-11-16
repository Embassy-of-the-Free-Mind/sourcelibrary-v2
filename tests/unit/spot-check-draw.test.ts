/**
 * The fortnightly spot check's draw (#5914, scripts/eval/spot-check/lib.mjs).
 *
 * A fortnight's rate is only comparable to the last if the draw is the same instrument each time: the same
 * seed over the same frame gives the same books and pages, whatever order Mongo returned the frame in; the
 * unit is the BOOK (one run of 3 consecutive translated pages per book, never two runs from one book — pages
 * in a book are one observation); and a book with no such run is skipped, not padded with loose pages.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  drawSample, pickRun, bookOrder, seedFromDate, structureCounts, printedToNum, packetTranslation, servedResults,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/spot-check/lib.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { makeRng } from '../../scripts/eval/lib/paired-stats.mjs';

type Pick = { id: string; start: number; pages: number[] };

const frame = Array.from({ length: 500 }, (_, i) => `book${String(i).padStart(4, '0')}`);
// Every book has translated pages 1..40 except every 7th, which has only scattered pages (no run of 3).
const translated = (id: string): number[] => (Number(id.slice(4)) % 7 === 0 ? [1, 3, 5, 9, 12] : Array.from({ length: 40 }, (_, i) => i + 1));

describe('spot-check draw', () => {
  it('is deterministic: same seed and frame → same books and runs', async () => {
    const a = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    const b = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    expect(b).toEqual(a);
  });

  it('does not depend on the order the frame arrives in', async () => {
    const shuffled = [...frame].reverse();
    const a = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    const b = await drawSample({ frame: shuffled, n: 10, seed: 20261019, translatedFor: translated });
    expect(b).toEqual(a);
  });

  it('a different seed draws a different sample', async () => {
    const a = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    const b = await drawSample({ frame, n: 10, seed: 20261102, translatedFor: translated });
    expect(b.picks.map((p: Pick) => p.id)).not.toEqual(a.picks.map((p: Pick) => p.id));
  });

  it('one run per book: n distinct books, each with exactly 3 consecutive translated pages', async () => {
    for (const seed of [1, 2, 3, 20261006, 20261019]) {
      const { picks, rejected } = await drawSample({ frame, n: 10, seed, translatedFor: translated });
      expect(picks).toHaveLength(10);
      expect(new Set(picks.map((p: Pick) => p.id)).size).toBe(10);
      for (const p of picks) {
        expect(p.pages).toEqual([p.start, p.start + 1, p.start + 2]);
        const ok = new Set(translated(p.id));
        expect(p.pages.every((n: number) => ok.has(n))).toBe(true);
      }
      // books without a run are skipped and recorded, never drawn
      for (const id of rejected) expect(Number(id.slice(4)) % 7).toBe(0);
      expect(picks.some((p: Pick) => Number(p.id.slice(4)) % 7 === 0)).toBe(false);
    }
  });

  it('is uniform per book, not per page', async () => {
    // Half the frame has 1,000 translated pages, half has 3. A page-weighted draw would pick the big books
    // ~99.7% of the time; a book-uniform one picks them about half the time.
    const big = (id: string) => Number(id.slice(4)) % 2 === 0;
    const pagesOf = (id: string) => Array.from({ length: big(id) ? 1000 : 3 }, (_, i) => i + 1);
    let bigCount = 0, total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { picks } = await drawSample({ frame, n: 10, seed, translatedFor: pagesOf });
      for (const p of picks) { total++; if (big(p.id)) bigCount++; }
    }
    expect(bigCount / total).toBeGreaterThan(0.44);
    expect(bigCount / total).toBeLessThan(0.56);
  });

  it('bookOrder never repeats a book, and dedupes the frame', () => {
    const order = [...bookOrder([...frame, ...frame.slice(0, 50)], makeRng(7))];
    expect(order).toHaveLength(frame.length);
    expect(new Set(order).size).toBe(frame.length);
  });

  it('pickRun returns null when no 3 consecutive pages exist', () => {
    expect(pickRun([1, 2, 4, 5, 7], makeRng(1))).toBeNull();
    expect(pickRun([4, 5, 6], makeRng(1))).toBe(4);
  });

  it('seedFromDate', () => {
    expect(seedFromDate('2026-10-19')).toBe(20261019);
    expect(() => seedFromDate('19 Oct')).toThrow();
  });
});

describe('structure counts', () => {
  it('counts printed-number backsteps, repeats and duplicate records', () => {
    const pg = (n: number, printed?: string, tr = 'x') => ({ page_number: n, ocr: { data: printed ? `<page-num>${printed}</page-num> text` : 'text' }, translation: { data: tr } });
    const s = structureCounts([pg(1, '1'), pg(2, '2'), pg(3, '2'), pg(4, '1'), pg(4, undefined, ''), pg(5, '५')]);
    expect(s.page_records).toBe(6);
    expect(s.duplicate_records).toBe(1);
    expect(s.pages_translated).toBe(5);
    expect(s.with_printed_number).toBe(5);
    expect(s.printed_backsteps).toBe(1);
    expect(s.printed_repeats).toBe(2);
    expect(printedToNum('三')).toBe(3);
    expect(printedToNum('xii')).toBeNull();
  });
});

// v3#154: on an English leaf of an English edition the reader is served the transcription, so the stored
// translation there is neither handed to a reviewer nor scored. Round 7 counted 7 serious findings in such text.
describe('text the reader is not served', () => {
  const stored = { ocr: { data: 'Of the nature of things' }, translation: { data: 'On how things are', model: 'm', source: 's' } };
  const trError = { source: 'Esdras', english: 'Ezra', problem: 'name changed', severity: 'serious', class: 'T8' };
  const ocrError = { ocr: 'tbe', image: 'the', problem: 'misread', severity: 'serious', class: 'O6' };
  const results = [
    { book_id: 'english', on_sight_defect: true, pages: [
      { page_number: 1, ocr_score: 5, tr_score: 2, right_page: 'yes', ocr_errors: [], tr_errors: [trError, { ...trError, severity: 'minor' }], other: [] },
      { page_number: 2, ocr_score: 3, tr_score: 2, right_page: 'yes', ocr_errors: [ocrError], tr_errors: [trError], other: [] },
      { page_number: 3, ocr_score: 5, tr_score: 5, right_page: 'yes', ocr_errors: [], tr_errors: [], other: [] }] },
    { book_id: 'latin', on_sight_defect: false, pages: [
      { page_number: 7, ocr_score: 5, tr_score: 2, right_page: 'yes', ocr_errors: [], tr_errors: [trError], other: [] }] },
  ];
  const notServedAt = { english: { 1: 'rewrite_not_served', 2: 'rewrite_not_served', 3: 'rewrite_not_served' }, latin: { 7: 'served' } };

  it('the packet leaves the stored translation out of a rewrite_not_served page, and says why', () => {
    const p = packetTranslation(stored, 'rewrite_not_served');
    expect(p).toMatchObject({ translation: '', translation_model: null, translation_source: null });
    expect(p.translation_note).toMatch(/served the transcription/);
    // Negative control: any other exposure gets the stored text as before, and no note.
    expect(packetTranslation(stored, 'served')).toEqual({ translation: 'On how things are', translation_model: 'm', translation_source: 's' });
  });

  it('servedResults drops findings in the stored rewrite and keeps those in the transcription', () => {
    const { results: scored, notServed } = servedResults(results, notServedAt);
    expect(notServed).toEqual({ pages: 2, books: 1, findings: 3, serious: 2 });
    const [english, latin] = scored;
    expect(english.pages.map((p: { tr_errors: unknown[] }) => p.tr_errors.length)).toEqual([0, 0, 0]);
    expect(english.pages[1].ocr_errors).toEqual([ocrError]);            // the transcription is served: its error stays
    expect(english.pages[0].tr_errors_not_served).toHaveLength(2);      // kept beside, not deleted
    expect(latin).toBe(results[1]);                                     // a served translation is untouched
    expect(results[0].pages[0].tr_errors).toHaveLength(2);              // the input is not changed
  });

  it('negative control: with no rewrite_not_served page in the draw log, nothing is dropped', () => {
    const served = { english: { 1: 'served', 2: 'served', 3: 'served' }, latin: { 7: 'served' } };
    for (const exposure of [served, {}, undefined]) {
      const r = servedResults(results, exposure);
      expect(r.results).toEqual(results);
      expect(r.notServed).toEqual({ pages: 0, books: 0, findings: 0, serious: 0 });
    }
  });

  // score.mjs end to end, on a fixture run directory.
  const score = (exposure: unknown) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spot-score-'));
    const dir = path.join(root, '2026-11-13');
    fs.mkdirSync(dir);
    const sample = results.map((r, i) => ({ slot: i + 1, book_id: r.book_id, pages: r.pages.map((p) => ({ page_number: p.page_number })) }));
    fs.writeFileSync(path.join(dir, 'sample.json'), JSON.stringify(sample));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results));
    fs.writeFileSync(path.join(dir, 'draw-log.json'), JSON.stringify({ frame: 'public', exposure }));
    const r = spawnSync('node', [path.resolve(__dirname, '../../scripts/eval/spot-check/score.mjs'), '--date', '2026-11-13', '--root', root], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return { report: JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')), md: fs.readFileSync(path.join(dir, 'report.md'), 'utf8') };
  };

  it('score.mjs: an English-original book with a differing stored translation scores as not served', () => {
    const { report, md } = score(notServedAt);
    // 4 pages. Served findings: the OCR error on english p.2 and the translation error on latin p.7.
    expect(report.fortnight).toMatchObject({ pages: 4, pages_with_serious: 2, serious_errors: 2 });
    expect(report.not_served).toEqual({ pages: 2, books: 1, findings: 3, serious: 2 });
    expect(report.typed.by_exposure.served.n).toBe(2);                  // the English book is still a served book
    expect(report.typed.by_exposure.rewrite_not_served.n).toBe(0);
    expect(md).toMatch(/Not counted above: 3 findings \(2 serious\) on 2 pages of 1 books/);
  });

  it('score.mjs negative control: the same results drawn as served count every finding', () => {
    const served = { english: { 1: 'served', 2: 'served', 3: 'served' }, latin: { 7: 'served' } };
    const { report, md } = score(served);
    expect(report.fortnight).toMatchObject({ pages: 4, pages_with_serious: 3, serious_errors: 4 });
    expect(report.not_served).toEqual({ pages: 0, books: 0, findings: 0, serious: 0 });
    expect(md).not.toMatch(/Not counted above/);
  });
});
