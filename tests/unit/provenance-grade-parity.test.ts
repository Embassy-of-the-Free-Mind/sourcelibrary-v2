import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mjs from '../../scripts/audit/provenance-grades.mjs';
import * as mjsWp from '../../scripts/lib/write-provenance.mjs';
import * as ts from '../../src/lib/provenance-grade';
import { inferHistoricalGeneration as tsInfer } from '../../src/lib/write-provenance';

/**
 * The dataset export grades pages on read with src/lib/provenance-grade.ts, the weekly summary with
 * scripts/audit/provenance-grades.mjs (sourcelibrary-v3 #201). If the two drift, a licensee's row
 * says one grade and the summary counted another. Every fixture is a real page subdocument and the
 * real batch_jobs / gemini_usage rows that name them, copied from bookstore on 2026-11-13 for PR #210
 * (tests/fixtures/provenance-grades-201.json) — nothing here is hand-written.
 */
type Field = 'ocr' | 'translation';
type Fx = { pages: { _id: string; id: string; book_id: string; field: Field; sub: Record<string, unknown> | null }[]; batch_jobs: Record<string, any>[]; gemini_usage: Record<string, any>[] };
const fx: Fx = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/provenance-grades-201.json'), 'utf8'));

const jobs = new Map<string, any>();
for (const j of fx.batch_jobs) for (const k of [j.id, j.job_name, j.gemini_job_name, String(j._id)]) if (k) jobs.set(k, j);
const usageByJob = new Map<string, any[]>();
for (const u of fx.gemini_usage) if (u.batch_job_id) (usageByJob.get(u.batch_job_id) ?? usageByJob.set(u.batch_job_id, []).get(u.batch_job_id)!).push(u);
const recs = { jobs, usage: fx.gemini_usage, usageByJob };

describe('TS twin = .mjs grader, on real page shapes', () => {
  it('same grade list and version', () => {
    expect([...ts.GRADES]).toEqual(mjs.GRADES);
    expect(ts.GRADER_VERSION).toBe(mjs.GRADER_VERSION);
  });

  it.each(fx.pages.map((p) => [p._id, p.field, p] as const))('gradeField %s %s', (_id, field, p) => {
    expect(ts.gradeField(field, p.sub)).toEqual(mjs.gradeField(field, p.sub));
    for (const has of [true, false]) expect(ts.gradeField(field, p.sub, { has })).toEqual(mjs.gradeField(field, p.sub, { has }));
    expect(ts.monthOf(p.sub)).toBe(mjs.monthOf(p.sub));
    const g = mjs.gradeField(field, p.sub);
    if (g) expect(ts.needsCorroboration(g)).toBe(mjs.needsCorroboration(g));
  });

  it.each(fx.pages.filter((p) => p.sub).map((p) => [p._id, p.field, p] as const))('corroborate %s %s', (_id, field, p) => {
    expect(ts.corroborate(field, p.sub, [p.id, p._id], recs)).toEqual(mjs.corroborate(field, p.sub, [p.id, p._id], recs));
  });

  it('inferHistoricalGeneration: same answer on every fixture and on a grid of sources × dates × code_version', () => {
    for (const p of fx.pages) expect(tsInfer(p.field, p.sub)).toEqual(mjsWp.inferHistoricalGeneration(p.field, p.sub));
    const sources = ['ai', 'batch_api', 'pipeline_preview', 'manual', undefined];
    const days = ['2026-02-18', '2026-02-19', '2026-03-21', '2026-03-22', '2026-05-31T23:59:59Z', '2026-06-01', '2026-08-08', '2026-08-09', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-14', '2026-09-15', '2026-09-28T16:20:59Z', '2026-09-28T16:21:00Z', 'not a date'];
    let n = 0;
    for (const field of ['ocr', 'translation'] as const) for (const source of sources) for (const updated_at of days) for (const code_version of [undefined, 'abc1234']) {
      const sub = { source, updated_at, code_version };
      expect(tsInfer(field, sub)).toEqual(mjsWp.inferHistoricalGeneration(field, sub));
      n++;
    }
    expect(n).toBe(2 * sources.length * days.length * 2);
  });
});

describe('what the export shows', () => {
  const pg = (id: string, field: Field) => fx.pages.find((x) => x._id === id && x.field === field)!;

  it('an inferred page corroborated by a gemini_usage row names that row', () => {
    const p = pg('6a4ae435f16f8258b8ade075', 'ocr');
    const g = ts.gradeField('ocr', p.sub)!;
    const e = ts.exportGrade(g, ts.corroborate('ocr', p.sub, [p.id, p._id], recs));
    expect(e).toMatchObject({ grade: 'inferred', basis: 'realtime-ocr-script', corroborated: true, corroborated_by: { record: 'gemini_usage(mongo)', id: 'gu_1783327234523_8xmtii' }, evidence_fields: ['source', 'updated_at'], grader: 'provenance-grade/1' });
    expect(e.month).toBe(String(p.sub!.updated_at).slice(0, 7));
  });

  it('a batch page is corroborated by its batch job, by id', () => {
    const p = pg('69ea0f4613a685002bb8dbe1', 'ocr');
    const e = ts.exportGrade(ts.gradeField('ocr', p.sub)!, ts.corroborate('ocr', p.sub, [p.id, p._id], recs));
    expect(e).toMatchObject({ grade: 'recorded_on_page', basis: 'model+prompt_version+batch_job_id', corroborated: true, corroborated_by: { record: 'batch_jobs', id: '3eChB13G83ycQN64tbhRD' } });
  });

  it('a grade not checked against the call log says null, not false', () => {
    const p = pg('6abeb8ee896ea18127c86797', 'ocr');
    const g = ts.gradeField('ocr', p.sub)!;
    expect(ts.needsCorroboration(g)).toBe(false);
    expect(ts.exportGrade(g, null)).toMatchObject({ grade: 'imported', corroborated: null, corroborated_by: null });
  });
});

describe('gradePages reads the call log per book, and agrees with the pure functions', () => {
  // A stand-in Db over the fixture rows. Each record carries the book of the page that names it
  // (the real relation: batch_jobs.book_id and gemini_usage.book_id are the page's book).
  const bookOfPage = new Map(fx.pages.map((p) => [p._id, p.book_id]));
  const bookOfJob = new Map(fx.pages.filter((p) => p.sub?.batch_job_id).map((p) => [String(p.sub!.batch_job_id), p.book_id]));
  const store: Record<string, any[]> = {
    batch_jobs: fx.batch_jobs.map((j) => ({ ...j, book_id: bookOfJob.get(j.id) })),
    gemini_usage: fx.gemini_usage.map((u) => ({ ...u, book_id: bookOfPage.get(u.page_ids?.[0]) })),
  };
  const queries: { coll: string; q: any }[] = [];
  const match = (q: any, r: any): boolean => {
    if (q.$or) return q.$or.some((b: any) => match(b, r));
    if (q.id?.$in) return q.id.$in.includes(r.id);
    if (q._id?.$in) return q._id.$in.map(String).includes(String(r._id));
    return q.book_id?.$in ? q.book_id.$in.includes(r.book_id) : q.book_id === r.book_id;
  };
  const dbOver = (st: Record<string, any[]>) => ({ collection: (coll: string) => ({ find: (q: any) => { queries.push({ coll, q }); return { toArray: async () => st[coll].filter((r) => match(q, r)) }; } }) }) as any;
  const db = dbOver(store);

  it('one batch_jobs query, gemini_usage once per book, same grades as gradeField + corroborate', async () => {
    const byPage = new Map<string, any>();
    for (const p of fx.pages) { const x = byPage.get(p._id) ?? byPage.set(p._id, { _id: p._id, id: p.id, book_id: p.book_id }).get(p._id); x[p.field] = p.sub; }
    const pages = [...byPage.values()];
    const has = (p: any, f: Field) => ts.hasText(f, p[f]);
    const { grades, books_read } = await ts.gradePages(db, pages, has, { jobIdLookup: true });
    expect(queries.filter((q) => q.coll === 'batch_jobs')).toHaveLength(1); // every job found by book: no id lookup
    expect(queries.filter((q) => q.coll === 'gemini_usage')).toHaveLength(books_read);
    expect(new Set(queries.filter((q) => q.coll === 'gemini_usage').map((q) => q.q.book_id)).size).toBe(books_read);
    let checked = 0;
    for (const p of pages) for (const f of ['ocr', 'translation'] as const) {
      const g = mjs.gradeField(f, p[f]);
      if (!g) { expect(grades.get(p)?.[f]).toBeUndefined(); continue; }
      const c = ts.needsCorroboration(g) ? mjs.corroborate(f, p[f], [p.id, p._id], recs) : null;
      expect(grades.get(p)?.[f]).toEqual(ts.exportGrade(g, c));
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('a batch job filed under ANOTHER book (one job, many books) is still found, by id', async () => {
    queries.length = 0;
    const p = fx.pages.find((x) => x._id === '69ea0f4613a685002bb8dbe1' && x.field === 'ocr')!;
    const page = { _id: p._id, id: p.id, book_id: p.book_id, ocr: p.sub };
    const elsewhere = { ...store, batch_jobs: store.batch_jobs.map((j) => (j.id === p.sub!.batch_job_id ? { ...j, book_id: '1c13e860-1807-4830-b8a4-93a865b81504' } : j)) };
    const { grades } = await ts.gradePages(dbOver(elsewhere), [page], (x: any, f: Field) => ts.hasText(f, x[f]), { jobIdLookup: true });
    const bq = queries.filter((q) => q.coll === 'batch_jobs');
    expect(bq).toHaveLength(2);
    expect(bq[1].q.$or[0]).toEqual({ id: { $in: [p.sub!.batch_job_id] } });
    expect(grades.get(page)?.ocr).toMatchObject({ grade: 'recorded_on_page', corroborated: true, corroborated_by: { record: 'batch_jobs', id: p.sub!.batch_job_id } });

    // without batch_jobs_id_idx the id lookup does not run, and the page says "not checked", not "false"
    queries.length = 0;
    const { grades: g2 } = await ts.gradePages(dbOver(elsewhere), [page], (x: any, f: Field) => ts.hasText(f, x[f]), { jobIdLookup: false });
    expect(queries.filter((q) => q.coll === 'batch_jobs')).toHaveLength(1);
    expect(g2.get(page)?.ocr).toMatchObject({ grade: 'recorded_on_page', corroborated: null, corroborated_by: null });
  });

  it('skipCallLog grades without reading anything and leaves corroborated null', async () => {
    queries.length = 0;
    const p = fx.pages.find((x) => x._id === '6a4ae435f16f8258b8ade075')!;
    const page = { _id: p._id, id: p.id, book_id: p.book_id, ocr: p.sub };
    const { grades } = await ts.gradePages(db, [page], (x: any, f: Field) => ts.hasText(f, x[f]), { skipCallLog: true });
    expect(queries).toHaveLength(0);
    expect(grades.get(page)?.ocr).toMatchObject({ grade: 'inferred', corroborated: null });
  });
});
