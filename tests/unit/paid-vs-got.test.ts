/**
 * The daily paid-vs-got ledger (#5499) has to be able to FAIL, and must not flag what is fine.
 *
 * The script needs Mongo, Supabase and Google to run end to end, so its judgement lives in pure
 * functions and these tests drive them with the shapes measured on 2026-09-30/10-01: a pooled
 * Phase 2 job submitted twice 28 s apart (#5498), chained translate runs stamped as
 * `${jobName}#${runId}`, and the 48 h Gemini batch expiry the collection check guards.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs without types
import * as L from '../../scripts/audit/paid-vs-got.mjs';

const NOW = new Date('2026-10-01T06:10:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3600e3);

describe('collection check', () => {
  it('FAILs a named batch job past 40 h and WARNs past 24 h', () => {
    const r = L.collectionCheck({
      jobs: [
        { id: 'a', status: 'pending', job_name: 'batches/a', created_at: ago(41) },
        { id: 'b', status: 'processing', job_name: 'batches/b', created_at: ago(30) },
        { id: 'c', status: 'pending', job_name: 'batches/c', created_at: ago(2) },
      ],
      now: NOW,
    });
    expect(r.fail).toBe(1);
    expect(r.warn).toBe(1);
    expect(r.flagged.map((i: { id: string }) => i.id)).toEqual(['a', 'b']);
  });

  it('treats an unknown status as open, and a nameless job as a WARN that cannot expire', () => {
    const r = L.collectionCheck({
      jobs: [
        { id: 'odd', status: 'JOB_STATE_SOMETHING_NEW', job_name: 'batches/x', created_at: ago(45) },
        { id: 'nameless', status: 'pending', created_at: ago(45) },
      ],
      now: NOW,
    });
    const lv = Object.fromEntries(r.flagged.map((i: { id: string; level: string }) => [i.id, i.level]));
    expect(lv).toEqual({ odd: 'FAIL', nameless: 'WARN' });
  });

  it('ages a chained run by its in-flight round, not by the run', () => {
    const r = L.collectionCheck({
      runs: [
        // a long run whose CURRENT round went in an hour ago is fine
        { id: 'long', mode: 'chained', phase: 'round_submitted', created_at: ago(100), round: { job: { submitted_at: ago(1) } } },
        { id: 'stuck', mode: 'chained', phase: 'round_submitted', round: { job: { submitted_at: ago(42) } } },
        { id: 'idle', mode: 'chained', phase: 'round_ready', updated_at: ago(50) },
        { id: 'seam', phase: 'translate_submitted', translate_job: { submitted_at: ago(41) } },
        { id: 'done', mode: 'chained', phase: 'complete', updated_at: ago(500) },
      ],
      now: NOW,
    });
    const lv = Object.fromEntries(r.flagged.map((i: { id: string; level: string }) => [i.id, i.level]));
    expect(lv).toEqual({ stuck: 'FAIL', seam: 'FAIL', idle: 'WARN' });
  });

  it('positive control fires against real-shaped lists', () => {
    const p = L.positiveControl({ jobs: [{ id: 'x', status: 'saved', created_at: ago(3) }], runs: [], now: NOW });
    expect(p).toEqual({ ok: true, job: 'FAIL', run: 'FAIL' });
  });

  it('negative control flags nothing', () => {
    expect(L.negativeControl(NOW).ok).toBe(true);
  });
});

describe('waste', () => {
  const pool = Array.from({ length: 250 }, (_, i) => `p${i}`);
  const inDay = (j: { created_at: Date }) => j.created_at >= new Date('2026-09-30T00:00:00Z');

  it('finds the #5498 shape: same pool twice, 28 s apart, both saved', () => {
    const jobs = [
      { id: 'orig', type: 'ocr', status: 'saved', job_name: 'b/1', page_ids: pool, created_at: new Date('2026-09-30T01:50:13Z'), cost_usd: 0.19, output_tokens: 1 },
      { id: 'dup', type: 'ocr', status: 'saved', job_name: 'b/2', page_ids: [...pool].reverse(), created_at: new Date('2026-09-30T01:50:41Z'), cost_usd: 0.19, output_tokens: 1 },
      { id: 'forced', type: 'ocr', status: 'saved', job_name: 'b/3', page_ids: pool, force: true, created_at: new Date('2026-09-30T01:51:00Z'), cost_usd: 0.19, output_tokens: 1 },
      { id: 'quota', type: 'ocr', status: 'submit_failed', page_ids: pool, created_at: new Date('2026-09-30T01:52:00Z') },
    ];
    const d = L.duplicateSubmissions(jobs, { inDay });
    expect(d.map((x: { id: string }) => x.id)).toEqual(['dup']);
    expect(d[0]).toMatchObject({ original_id: 'orig', gap_s: 28, pages: 250, actual: true });

    const rep = L.pagesPaidTwice(jobs, { inDay });
    expect(rep.pages).toBe(250);
    expect([...rep.superseded]).toEqual(['orig']);
  });

  it('does not call a page paid twice when the earlier job never produced it', () => {
    const jobs = [
      { id: 'gemfail', type: 'ocr', status: 'failed', job_name: 'b/1', page_ids: ['a'], created_at: new Date('2026-09-30T01:00:00Z'), cost_usd: 0.01 },
      { id: 'retry', type: 'ocr', status: 'saved', job_name: 'b/2', page_ids: ['a'], created_at: new Date('2026-09-30T03:00:00Z'), cost_usd: 0.01, output_tokens: 5 },
    ];
    expect(L.pagesPaidTwice(jobs, { inDay }).pages).toBe(0);
  });

  it('joins chained translate rows on jobName#runId, and splits superseded and eval rows out', () => {
    const written = new Set([
      ...L.stampKeys({ batch_job_id: 'batches/J', job_id: 'tbc_1' }),
      ...L.stampKeys({ batch_job_id: 'ocrJob1' }),
    ]);
    const rows = [
      { batch_job_id: 'batches/J#tbc_1', type: 'translation', status: 'success', cost_usd: 0.02 },
      { batch_job_id: 'batches/J#tbc_2', type: 'translation', status: 'success', cost_usd: 0.03, endpoint: 'hetzner/translate-batch-chained' },
      { batch_job_id: 'ocrJob1', type: 'ocr', status: 'success', cost_usd: 0.2 },
      { batch_job_id: 'orig', type: 'ocr', status: 'success', cost_usd: 0.19 },
      { batch_job_id: 'batches/S#tbc_9', type: 'translation', status: 'success', cost_usd: 0.01, endpoint: 'eval/translate-batch-chained-shadow' },
      { batch_job_id: 'placeholder', type: 'ocr', status: 'submitted', cost_usd: 0.05 },
    ];
    const r = L.paidForNothing(rows, written, new Set(['orig']));
    expect(r.nothing.map((x: { batch_job_id: string }) => x.batch_job_id)).toEqual(['batches/J#tbc_2']);
    expect(r.superseded.map((x: { batch_job_id: string }) => x.batch_job_id)).toEqual(['orig']);
    expect(r.eval).toHaveLength(1);
  });

  it('separates real failed spend from a phantom submit estimate', () => {
    const f = L.failedWithCost([
      { status: 'failed', cost_usd: 0.0127, output_tokens: 16380 },
      { status: 'failed', cost_usd: 0.002 },
      { status: 'saved', cost_usd: 0.5, output_tokens: 9 },
    ]);
    expect(f).toMatchObject({ real: 1, phantom: 1 });
  });
});

describe('paid, headline and verdict', () => {
  it('counts only collected batch rows as paid, and an endpoint-less paid row as unattributed', () => {
    const p = L.foldPaid(
      [{ type: 'extract_images', cost_usd: 1, endpoint: 'hetzner/image-extract-worker' }, { type: 'summary', cost_usd: 1 }],
      [{ type: 'ocr', model: 'gemini-3.1-flash-lite', page_count: 20, status: 'success', cost_usd: 0.02, endpoint: 'x' },
       { type: 'ocr', status: 'submitted', cost_usd: 9, endpoint: 'x' }],
      [{ type: 'ocr', cost_usd: 0.04 }],
    );
    expect(p.lane.ocr.batch_usd).toBeCloseTo(0.02);
    expect(p.lane.ocr.batch_estimate_usd).toBeGreaterThan(0);
    expect(p.lane.ocr.in_flight_est_usd).toBeCloseTo(0.04);
    expect(p.metered_usd).toBeCloseTo(2.02);
    expect(p.unattributed_pct).toBeCloseTo(49.5, 0);
  });

  it('FAILs on each of the three conditions and only on them', () => {
    const clean = { fail: 0, warn: 0 };
    expect(L.verdict({ collection: clean, dupUsd: 0.38, unattributedPct: 0 }).status).toBe('PASS');
    expect(L.verdict({ collection: { fail: 0, warn: 2 }, dupUsd: 0, unattributedPct: 0 }).status).toBe('WARN');
    expect(L.verdict({ collection: { fail: 1, warn: 0 }, dupUsd: 0, unattributedPct: 0 }).status).toBe('FAIL');
    expect(L.verdict({ collection: clean, dupUsd: 5.58, unattributedPct: 0 }).status).toBe('FAIL');
    expect(L.verdict({ collection: clean, dupUsd: 0, unattributedPct: 5.1 }).status).toBe('FAIL');
  });

  it('prices per 1,000 Gemini-written pages and leaves page-less lanes blank', () => {
    const paid = L.foldPaid([], [{ type: 'ocr', status: 'success', cost_usd: 37.27, page_count: 1 }]);
    const h = L.headline({ paid, got: { ocr: { gemini_pages: 34155 }, translation: { gemini_pages: 0 } }, waste: { repeat_by_lane: { ocr: 0.38 }, nothing_by_lane: {} } });
    const ocr = h.find((x: { lane: string }) => x.lane === 'ocr');
    expect(ocr.per_1k_usd).toBeCloseTo(1.09, 2);
    expect(ocr.waste_pct).toBeCloseTo(1.02, 1);
    expect(h.find((x: { lane: string }) => x.lane === 'images').per_1k_usd).toBeNull();
  });
});
