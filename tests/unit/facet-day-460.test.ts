/**
 * The daily pipeline mail by facet (v3#460): classification inside a lane, the state word, a facet's week, the
 * corpus report's split, and the rendered mail. Numbers are the 2026-11-16 corpus report's, trimmed.
 */
import { describe, it, expect } from 'vitest';
import { ocrKind, translationKind, stateOf, facetRow, facetsOf, snapshotSeries, doneSeries, queueOf, subjectOf, formatText, formatHtml, kilo } from '../../scripts/lib/facet-day.mjs';
import { splitPerDay } from '../../scripts/maintenance/pipeline-now-push.mjs';
import { RULE_LABEL } from '../../scripts/lib/stale-routes.mjs';

describe('classification', () => {
  it('splits OCR writes by the job inside the lane', () => {
    expect(ocrKind('agy-flash-ocr', 'agy-first-read-7701')).toBe('first_read');
    expect(ocrKind('agy-flash-ocr', 'gpu-agy-first-read-euro-6871')).toBe('first_read');
    expect(ocrKind('agy-flash-ocr', 'agy-reread-lite-7853')).toBe('reread');
    expect(ocrKind('agy-flash-ocr', 'agy-correct-lite-7558')).toBe('reread');
    expect(ocrKind('claude-opus-ocr', null)).toBe('reread');
    expect(ocrKind('paddle-zh', 'paddle-zh-2026-10')).toBe('gpu_draft');
    expect(ocrKind('agy-flash-ocr', 'route-judge-6740-eval')).toBe('other');
    expect(ocrKind('volunteer-correction', null)).toBe('other');
  });
  it('splits translation writes: seam repairs and hand fixes apart', () => {
    expect(translationKind('agy-flash-translate', 'scripts/batch/cli-translate.mjs')).toBe('translate');
    expect(translationKind('ai', 'scripts/lib/seam-pass.mjs')).toBe('seam');
    expect(translationKind('ai', 'seam-repair-6742')).toBe('seam');
    expect(translationKind('ai', 'scripts/maintenance/apply-by-eye-page-text.mjs')).toBe('other');
  });
});

describe('state', () => {
  it('moving / slow / stopped / idle / not measured', () => {
    expect(stateOf(80, 100)).toBe('moving');
    expect(stateOf(40, 100)).toBe('slow');
    expect(stateOf(0, 100)).toBe('stopped');
    expect(stateOf(0, 0)).toBe('idle');
    expect(stateOf(null, 100)).toBe('not measured');
    expect(stateOf(5, null)).toBe('moving');
  });
  it('a day missing from a write count is zero; missing from a snapshot it is not measured', () => {
    const series = { '2026-11-14': { pages: 10 }, '2026-11-15': { pages: 10 } };
    expect(facetRow({ key: 'a', label: 'a', unit: 'pages', series, day: '2026-11-16' }).state).toBe('stopped');
    expect(facetRow({ key: 'a', label: 'a', unit: 'pages', series, day: '2026-11-16', absentIsZero: false }).state).toBe('not measured');
    expect(facetRow({ key: 'a', label: 'a', unit: 'pages', series: null, day: '2026-11-16' }).state).toBe('not measured');
  });
  it('averages only the days the source holds, and not before its start', () => {
    const series = { '2026-11-10': { pages: 1000 }, '2026-11-11': { pages: 100 }, '2026-11-12': { pages: 100 }, '2026-11-16': { pages: 60 } };
    const f = facetRow({ key: 'a', label: 'a', unit: 'pages', series, day: '2026-11-16', partialBefore: '2026-11-11' });
    expect(f.days).toBe(2);
    expect(f.avg.pages).toBe(100);
    expect(f.state).toBe('moving');
  });
});

describe('corpus split (pipeline-now-push perDay)', () => {
  it('keeps the lane × model rows and adds lane × job with distinct books', () => {
    const g = (lane: string, model: string, sub: string | null, pages: number, books: string[]) => ({ _id: { day: '2026-11-16', lane, model, sub }, pages, books });
    const { rows, work } = splitPerDay([
      g('agy-flash-ocr', 'gemini-3.8-flash-low', 'agy-first-read-7701', 78168, ['a', 'b']),
      g('agy-flash-ocr', 'gemini-3.8-flash-low', 'agy-reread-lite-7853', 905, ['c']),
      g('agy-flash-ocr', 'claude-opus-5-5-low', 'agy-first-read-7701', 3, ['b']),
    ]);
    expect(rows).toEqual([
      { day: '2026-11-16', lane: 'agy-flash-ocr', model: 'gemini-3.8-flash-low', pages: 79073 },
      { day: '2026-11-16', lane: 'agy-flash-ocr', model: 'claude-opus-5-5-low', pages: 3 },
    ]);
    expect(work).toEqual([
      { day: '2026-11-16', lane: 'agy-flash-ocr', sub: 'agy-first-read-7701', pages: 78171, books: 2 },
      { day: '2026-11-16', lane: 'agy-flash-ocr', sub: 'agy-reread-lite-7853', pages: 905, books: 1 },
    ]);
  });
});

const corpus = {
  since: '2026-11-11T00:00:00.000Z',
  ocr_work_per_day: [
    { day: '2026-11-15', lane: 'agy-flash-ocr', sub: 'agy-first-read-7701', pages: 40000, books: 900 },
    { day: '2026-11-16', lane: 'agy-flash-ocr', sub: 'agy-first-read-7701', pages: 78168, books: 2114 },
    { day: '2026-11-16', lane: 'paddle-zh', sub: 'paddle-zh-2026-10', pages: 54413, books: 366 },
    { day: '2026-11-15', lane: 'paddle-zh', sub: 'paddle-zh-2026-10', pages: 41854, books: 300 },
    { day: '2026-11-15', lane: 'agy-flash-ocr', sub: 'agy-reread-lite-7853', pages: 20000, books: 400 },
    { day: '2026-11-16', lane: 'agy-flash-ocr', sub: 'agy-reread-lite-7853', pages: 905, books: 23 },
  ],
  translated_work_per_day: [
    { day: '2026-11-15', lane: 'agy-flash-translate', sub: 'scripts/batch/cli-translate.mjs', pages: 17669, books: 200 },
    { day: '2026-11-16', lane: 'agy-flash-translate', sub: 'scripts/batch/cli-translate.mjs', pages: 52589, books: 484 },
    { day: '2026-11-16', lane: 'ai', sub: 'scripts/lib/seam-pass.mjs', pages: 3607, books: 93 },
  ],
  handoffs_per_day: [{ day: '2026-11-15', ft_search: 2902 }, { day: '2026-11-16', ft_search: 0 }],
};
const snapshots = [
  { timestamp: '2026-11-17T04:19:17Z', stages: [{ stage: 'archived', status: 'ok', delta: 146539 }, { stage: 'summaries', status: 'ok', delta: 12 }] },
  { timestamp: '2026-11-16T04:20:23Z', stages: [{ stage: 'archived', status: 'ok', delta: 153199 }, { stage: 'summaries', status: 'ok', delta: 27 }] },
];
const done = (day: string, books: number) => ({ day, steps: [{ step: 'done', live: { books, pages: 1 } }, { step: 'ocr', live: { books: 5622, pages: 1246353 } }] });
const nextDaily = [done('2026-11-17', 1543), done('2026-11-16', 1533), done('2026-11-15', 1500)];

describe('facetsOf', () => {
  const facets = facetsOf({ corpus, snapshots, nextDaily, checks: null, imports: null }, '2026-11-16');
  const by = Object.fromEntries(facets.map((f: { key: string }) => [f.key, f]));
  it('measures each facet from its own source', () => {
    expect(by.ocr_first.y).toEqual({ pages: 78168, books: 2114 });
    expect(by.ocr_first.who[0]).toEqual({ name: 'agy-first-read-7701', pages: 78168 });
    expect(by.ocr_gpu.state).toBe('moving');
    expect(by.ocr_reread.state).toBe('slow');
    expect(by.translate.y.pages).toBe(52589);
    expect(by.seam.y.pages).toBe(3607);
    expect(by.ft.state).toBe('stopped');
    expect(by.archive.y.pages).toBe(146539);
    expect(by.enrich.y.books).toBe(12);
    expect(by.done.y.books).toBe(10);
    expect(by.qa.state).toBe('not measured');
    expect(by.import.state).toBe('not measured');
  });
  it('snapshot deltas are the day before the snapshot; done is report to report', () => {
    expect(snapshotSeries(snapshots, 'archived', 'pages')['2026-11-16']).toEqual({ pages: 146539 });
    expect(doneSeries(nextDaily)).toEqual({ '2026-11-15': { books: 33 }, '2026-11-16': { books: 10 } });
  });
  it('a corpus report from before v3#460 still gives pages, by lane, and says what it lacks', () => {
    const old = { since: corpus.since, ocr_per_day: [{ day: '2026-11-16', lane: 'agy-flash-ocr', model: 'm', pages: 79979 }] };
    const f = facetsOf({ corpus: old }, '2026-11-16').find((x: { key: string }) => x.key === 'ocr_first');
    expect(f.y).toEqual({ pages: 79979, books: null });
    expect(f.note).toContain('after v3#460');
  });
  it('renders a subject with no alarm words for a normal day, and the text and HTML', () => {
    const stale = [{ cell: 'latin-lite/print', rule: 'thin', why: '835K pages waiting on 20/30 judged pages', pages_waiting: 835238 }];
    const subject = subjectOf({ day: '2026-11-16', facets, stale });
    expect(subject).toBe('[PIPELINE] 11-16: OCR 133K pages, translated 53K · 1 stopped · 1 stale route');
    const view = { day: '2026-11-16', facets, queue: queueOf(nextDaily), stale, staleLabel: RULE_LABEL, alerts: [], retired: ['ocr_throughput'] };
    const text = formatText(view);
    expect(text).toContain('OCR: first reads: MOVING');
    expect(text).toContain('78K pages · 2,114 books (1-day avg 40K pages)');
    expect(text).toContain('latin-lite/print: 835K pages waiting');
    expect(text).toContain('ocr 5,622 books / 1.25M pages');
    const html = formatHtml(view);
    expect(html).toContain('<code>latin-lite/print</code>');
    expect(html).not.toContain('<table');
    expect(kilo(1246353)).toBe('1.25M');
  });
});
