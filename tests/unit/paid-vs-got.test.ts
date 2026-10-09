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

// ─────────────────────────────────────────── 8. Gemini side (#6276)
// @ts-expect-error — .mjs without types
import * as G from '../../scripts/lib/gemini-batch-ledger.mjs';

/** A stub @google/genai client: batches.list returns a Pager-like object (first `.page`, async iterable). */
function listClient(jobs: Array<Record<string, unknown>> | Error) {
  return {
    batches: {
      list: async () => {
        if (jobs instanceof Error) throw jobs;
        return { page: jobs.slice(0, 100), async *[Symbol.asyncIterator]() { for (const j of jobs) yield j; } };
      },
    },
  };
}
const iso = (h: number) => ago(h).toISOString();
const job = (name: string, state: string, createdH: number, endedH: number | null = null, displayName = '') =>
  ({ name, state, createTime: iso(createdH), ...(endedH != null ? { endTime: iso(endedH) } : {}), displayName });
const rec = (o: Record<string, unknown>) => ({ store: 'batch_jobs', status: 'x', collected: false, open: false, pages: 5, ...o });

describe('Gemini-side ledger: the three classes fire, and a clean listing passes', () => {
  const listing = new Map([
    ['batches/collected', job('batches/collected', 'JOB_STATE_SUCCEEDED', 10, 9)],
    ['batches/inflight', job('batches/inflight', 'JOB_STATE_SUCCEEDED', 2, 1)],
    ['batches/cancelled-row', job('batches/cancelled-row', 'JOB_STATE_SUCCEEDED', 10, 9)],
    ['batches/stale-open', job('batches/stale-open', 'JOB_STATE_SUCCEEDED', 10, 9)],
    ['batches/nobody', job('batches/nobody', 'JOB_STATE_SUCCEEDED', 10, 9)],
    ['batches/running-failed', job('batches/running-failed', 'JOB_STATE_RUNNING', 3)],
    ['batches/running-ok', job('batches/running-ok', 'JOB_STATE_RUNNING', 3)],
    ['batches/dead', job('batches/dead', 'JOB_STATE_CANCELLED', 3, 2)],
    ['batches/old-cancelled', job('batches/old-cancelled', 'JOB_STATE_SUCCEEDED', 300, 299)],
  ]);
  const records = new Map([
    ['batches/collected', [rec({ status: 'saved', collected: true })]],
    ['batches/inflight', [rec({ status: 'processing', open: true })]],
    ['batches/cancelled-row', [rec({ status: 'cancelled' })]],
    ['batches/stale-open', [rec({ status: 'pending', open: true })]],
    ['batches/running-failed', [rec({ status: 'failed' })]],
    ['batches/running-ok', [rec({ status: 'processing', open: true })]],
    ['batches/dead', [rec({ status: 'failed' })]],
    ['batches/old-cancelled', [rec({ status: 'cancelled' })]],
  ]);

  it('classifies each shape (positive control)', () => {
    const r = G.classifyLedger({ jobs: listing, records, now: NOW });
    const by = Object.fromEntries(r.findings.map((f: { name: string; class: string }) => [f.name, f.class]));
    expect(by).toEqual({
      'batches/cancelled-row': 'succeeded_uncollected',
      'batches/stale-open': 'succeeded_uncollected', // open, but 9 h since Gemini finished > 3 h grace
      'batches/nobody': 'unknown_to_db',
      'batches/running-failed': 'terminal_while_alive',
      'batches/old-cancelled': 'succeeded_uncollected', // 299 h old: still a finding (#6333)
    });
    expect(r.counts.succeeded_uncollected).toMatchObject({ jobs: 3, pages: 15 });
    expect(r.ok_counts).toMatchObject({ collected: 1, in_flight: 1, alive_tracked: 1, dead: 1 });
  });

  // #6333: a finding used to drop to WARN 48 h after Gemini ended the job, so an unfixed loss
  // stopped paging without anyone having collected or discarded it.
  it('FAILs the verdict on every finding, however old', () => {
    const r = G.classifyLedger({ jobs: listing, records, now: NOW });
    const v = L.verdict({ collection: { fail: 0, warn: 0 }, gemini: { counts: r.counts } });
    expect(v.status).toBe('FAIL');
    expect(v.fails.join('\n')).toMatch(/3 batch job\(s\): Gemini SUCCEEDED, our record never collected it/);
    expect(v.warns).toEqual([]);
  });

  it('an old finding alone is still a FAIL, and a discard record clears it', () => {
    const old = new Map([['batches/old-cancelled', listing.get('batches/old-cancelled')!]]);
    const r = G.classifyLedger({ jobs: old, records, now: NOW });
    expect(L.verdict({ collection: { fail: 0, warn: 0 }, gemini: { counts: r.counts } }).status).toBe('FAIL');
    const discarded = new Map([['batches/old-cancelled', [G.recordFromBatchJob({ id: 'd1', status: 'superseded', discard: { reason: 'stopped experiment' } })]]]);
    const r2 = G.classifyLedger({ jobs: old, records: discarded, now: NOW });
    expect(r2.findings).toEqual([]);
    expect(r2.ok_counts.discarded).toBe(1);
  });

  it('a clean listing passes (negative control)', () => {
    const clean = new Map([...listing].filter(([n]) => ['batches/collected', 'batches/inflight', 'batches/running-ok', 'batches/dead'].includes(n)));
    const r = G.classifyLedger({ jobs: clean, records, now: NOW });
    expect(r.findings).toEqual([]);
    expect(L.verdict({ collection: { fail: 0, warn: 0 }, gemini: { counts: r.counts } }).status).toBe('PASS');
  });

  it('a re-submission whose twin was collected is waste, not a loss', () => {
    const jobs = new Map([['batches/twin', job('batches/twin', 'JOB_STATE_SUCCEEDED', 10, 9)]]);
    const r = G.classifyLedger({ jobs, records: new Map([['batches/twin', [rec({ twin: true, twin_collected: true })]]]), now: NOW });
    expect(r.findings).toEqual([]);
    expect(r.ok_counts.twin_collected).toBe(1);
    expect(G.twinIdsFromDisplayName('reocr-69b51e9547b06ecd58193b99-wEr2ZM0fGXRw5cYSUxEOZ')).toEqual({ batchJobId: 'wEr2ZM0fGXRw5cYSUxEOZ' });
    expect(G.twinIdsFromDisplayName('tbc-69dfee86ce6bb8619e07f683-tbc_muxg64bm_rfbv65-r41')).toEqual({ runId: 'tbc_muxg64bm_rfbv65' });
  });

  it('the every-run positive control fires all three classes against a real-shaped listing', () => {
    expect(G.ledgerPositiveControl({ jobs: listing, records, now: NOW })).toEqual({
      ok: true, succeeded_uncollected: 'fired', unknown_to_db: 'fired', terminal_while_alive: 'fired',
    });
  });

  it('a chained round struck on the job’s own Gemini state was never read; other strikes were', () => {
    const wanted = new Set(['batches/a', 'batches/b', 'batches/c']);
    const recs = G.recordsFromRun({ id: 'tbc_1', phase: 'round_ready', rounds: [
      { job: 'batches/a', outcome: 'strike', reason: 'job JOB_STATE_CANCELLED', pages: 8 },
      { job: 'batches/b', outcome: 'strike', reason: 'block parsed 0/8 (finish STOP)', pages: 8 },
      { job: 'batches/c', outcome: 'done', collected_at: NOW, pages: 8 },
    ] }, wanted);
    expect(Object.fromEntries(recs.map((r: { name: string; collected: boolean }) => [r.name, r.collected]))).toEqual({ 'batches/a': false, 'batches/b': true, 'batches/c': true });
  });
});

describe('Gemini-side listing: every key, aliases walked once, no silent truncation', () => {
  it('a key that cannot be listed makes the run UNKNOWN', async () => {
    const r = await G.listAllBatches([listClient([job('batches/x', 'JOB_STATE_SUCCEEDED', 1, 1)]), listClient(new Error('403 PERMISSION_DENIED'))], { keys: ['a', 'b'] });
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0]).toMatch(/key 1 .* could not be listed/);
    expect(r.jobs.size).toBe(1);
  });

  it('keys of one project are walked once; distinct projects each walked to the end', async () => {
    const p1 = [job('batches/p1a', 'JOB_STATE_SUCCEEDED', 1, 1), job('batches/p1b', 'JOB_STATE_SUCCEEDED', 2, 2)];
    const p2 = [job('batches/p2a', 'JOB_STATE_RUNNING', 1)];
    const r = await G.listAllBatches([listClient(p1), listClient(p2), listClient(p1)], { keys: ['a', 'b', 'c'] });
    expect(r.unknown).toEqual([]);
    expect([...r.jobs.keys()].sort()).toEqual(['batches/p1a', 'batches/p1b', 'batches/p2a']);
    expect(r.perKey.map((k: { stop: string }) => k.stop)).toEqual(['end', 'end', 'alias of key 0']);
  });

  it('a windowed walk stops at the window, and is UNKNOWN if the listing is not newest-first', async () => {
    const ordered = [job('batches/new', 'JOB_STATE_SUCCEEDED', 1, 1), job('batches/mid', 'JOB_STATE_SUCCEEDED', 50, 49), job('batches/old', 'JOB_STATE_SUCCEEDED', 100, 99)];
    const w = await G.listAllBatches([listClient(ordered)], { sinceMs: ago(72).getTime() });
    expect([...w.jobs.keys()]).toEqual(['batches/new', 'batches/mid']);
    expect(w.unknown).toEqual([]);
    expect(w.perKey[0].stop).toBe('window');
    const shuffled = [ordered[1], ordered[0], ordered[2]];
    const bad = await G.listAllBatches([listClient(shuffled)], { sinceMs: ago(72).getTime() });
    expect(bad.unknown[0]).toMatch(/not newest-first/);
  });
});

describe('Gemini-side ledger: usage rows metered one per book', () => {
  // The #6276 false page: 22 `ep-plain`/`ep-prefix` jobs were collected to disk and their usage
  // rows closed, but the rows are keyed `<display name>:<book id>` and matched nothing.
  const usage = [
    { batch_job_id: 'ep-plain-0-abc:6a3cb8513dce6cfad748d3b7', status: 'success', output_tokens: 0, page_count: 40 },
    { batch_job_id: 'ep-prefix-0-abc:6a3cb8513dce6cfad748d3b7', status: 'submitted', output_tokens: 0, page_count: 40 },
  ];
  const inRange = (q: { $gte: string; $lt: string }, id: string) => id >= q.$gte && id < q.$lt;
  const fakeDb = (seen: unknown[]) => ({
    collection: (name: string) => ({
      find: (q: { $or?: { batch_job_id?: { $gte: string; $lt: string } }[] }) => ({
        toArray: async () => {
          if (name !== 'gemini_usage' || !q.$or) return [];
          seen.push(q);
          return usage.filter((u) => q.$or!.some((c) => c.batch_job_id && inRange(c.batch_job_id, u.batch_job_id)));
        },
      }),
    }),
  });
  const jobs = new Map([
    ['batches/read', job('batches/read', 'JOB_STATE_SUCCEEDED', 10, 9, 'ep-plain-0-abc')],
    ['batches/unread', job('batches/unread', 'JOB_STATE_SUCCEEDED', 10, 9, 'ep-prefix-0-abc')],
    ['batches/nobody', job('batches/nobody', 'JOB_STATE_SUCCEEDED', 10, 9, 'ep-plain-0-ab')],
    ['batches/unsafe', job('batches/unsafe', 'JOB_STATE_SUCCEEDED', 10, 9, 'eval/x y*')],
  ]);

  it('a closed per-book row makes the job collected; a placeholder does not; a shorter name does not borrow it', async () => {
    const seen: unknown[] = [];
    const records = await G.readLedgerRecords(fakeDb(seen), jobs);
    const { findings } = G.classifyLedger({ jobs, records, now: NOW });
    const cls = Object.fromEntries(findings.map((f: { name: string; class: string }) => [f.name, f.class]));
    expect(cls).toEqual({ 'batches/unread': 'succeeded_uncollected', 'batches/nobody': 'unknown_to_db', 'batches/unsafe': 'unknown_to_db' });
    expect(JSON.stringify(seen)).not.toContain('eval/x');
  });

  it('the Supabase reader asks for `<display name>:*` and maps the row back to its job', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(decodeURIComponent(url));
      const hit = /like\.ep-plain-0-abc:\*/.test(decodeURIComponent(url));
      return { ok: true, status: 200, json: async () => (hit ? [usage[0]] : []) };
    };
    const reader = G.makeSupabaseUsageReader({ url: 'https://x', key: 'k', fetchImpl });
    const rows = await reader(['batches/read'], ['batches/read'], G.perBookPrefixes([...jobs.values()]));
    expect(rows).toHaveLength(1);
    expect(urls.some((u) => u.includes('eval/x'))).toBe(false);
    const byKey = new Map([['ep-plain-0-abc', 'batches/read']]);
    expect(G.jobForUsageId(rows[0].batch_job_id, byKey)).toBe('batches/read');
    expect(G.jobForUsageId('ep-plain-0-abcd:6a3c', byKey)).toBeUndefined();
  });
});

describe('Gemini-side ledger: a job whose every request failed is not paid work lost (#6333)', () => {
  const stats = (o: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ metadata: { state: 'BATCH_STATE_SUCCEEDED', displayName: 'x', ...o } }) });
  const fetchFor = (byName: Record<string, unknown>) => (async (url: string) => {
    const name = url.split('/v1beta/')[1];
    const v = byName[name];
    if (v === 404) return { ok: false, status: 404, json: async () => ({}) };
    if (v === undefined) throw new Error('network');
    return stats(v as Record<string, unknown>);
  }) as unknown as typeof fetch;
  const finding = (name: string, o: Record<string, unknown> = {}) => ({ name, class: 'succeeded_uncollected', actionable: true, pages: 0, key_index: 0, ...o });

  it('takes an all-cancelled job out of the findings and leaves a partly answered or unreadable one in', async () => {
    const res = { findings: [finding('batches/all-cancelled'), finding('batches/partial'), finding('batches/unreadable')], ok_counts: { empty: 0 } };
    const out = await G.settleFindings(res, ['k'], { fetchImpl: fetchFor({
      'batches/all-cancelled': { batchStats: { requestCount: '20000', failedRequestCount: '20000' } },
      'batches/partial': { batchStats: { requestCount: '17', successfulRequestCount: '15', failedRequestCount: '2' } },
    }) });
    expect(res.findings.map((f) => f.name)).toEqual(['batches/partial', 'batches/unreadable']);
    expect(res.ok_counts.empty).toBe(1);
    expect(out.empty).toEqual([{ name: 'batches/all-cancelled', display_name: undefined, requests: 20000 }]);
    expect(res.findings[0]).toMatchObject({ pages: 17, requests_ok: 15 });
  });

  it('never calls a job empty on a missing tally or a state other than SUCCEEDED', () => {
    expect(G.isEmptyJob({ has_stats: false, state: 'JOB_STATE_SUCCEEDED', requests: 0, ok: 0, failed: 0 })).toBe(false);
    expect(G.isEmptyJob({ has_stats: true, state: 'JOB_STATE_RUNNING', requests: 5, ok: 0, failed: 5 })).toBe(false);
    expect(G.isEmptyJob({ has_stats: true, state: 'JOB_STATE_SUCCEEDED', requests: 5, ok: 0, failed: 4 })).toBe(false); // one still unaccounted for
    expect(G.isEmptyJob({ has_stats: true, state: 'JOB_STATE_SUCCEEDED', requests: 5, ok: 0, failed: 5 })).toBe(true);
    expect(G.isEmptyJob(null)).toBe(false);
  });

  it('carries a finding forward once its job has left the listing window', async () => {
    const prev = [
      { name: 'batches/still-there', class: 'unknown_to_db', display_name: 'tattva-6184-2', created: iso(100), ended: iso(99), key_index: 0 },
      { name: 'batches/aged-out', class: 'succeeded_uncollected', display_name: 'ep-plain-0', created: iso(100), ended: iso(99), key_index: 0 },
      { name: 'batches/unaskable', class: 'unknown_to_db', display_name: 'probe', created: iso(100), ended: iso(99), key_index: 0 },
      { name: 'batches/in-window', class: 'unknown_to_db', created: iso(10), ended: iso(9), key_index: 0 },
      { name: 'batches/ancient', class: 'unknown_to_db', created: iso(24 * 60), ended: iso(24 * 60), key_index: 0 },
    ];
    const jobs = new Map<string, Record<string, unknown>>([['batches/in-window', job('batches/in-window', 'JOB_STATE_SUCCEEDED', 10, 9)]]);
    const n = await G.carryForwardFindings(prev, jobs, ['k'], { now: NOW, fetchImpl: fetchFor({
      'batches/still-there': { displayName: 'tattva-6184-2', createTime: iso(100), endTime: iso(99) }, 'batches/aged-out': 404,
    }) });
    expect(n).toBe(3);
    expect(jobs.get('batches/still-there')).toMatchObject({ state: 'JOB_STATE_SUCCEEDED', carried: true });
    expect(jobs.get('batches/aged-out')).toMatchObject({ carried: true, output_gone: true });
    expect(jobs.get('batches/unaskable')).toMatchObject({ carried: true });
    expect(jobs.has('batches/ancient')).toBe(false);
    // Carried jobs are classified like any other: still findings with no record, clear with one.
    const r = G.classifyLedger({ jobs, records: new Map([['batches/aged-out', [rec({ status: 'superseded', discarded: true })]]]), now: NOW });
    expect(r.findings.map((f: { name: string }) => f.name).sort()).toEqual(['batches/in-window', 'batches/still-there', 'batches/unaskable']);
    expect(r.findings.find((f: { name: string }) => f.name === 'batches/still-there')).toMatchObject({ carried: true });
  });

  it('finds a lane row written before the job was created, by the display name it gave the job', async () => {
    const jobs = new Map([['batches/orphan', job('batches/orphan', 'JOB_STATE_SUCCEEDED', 10, 9, 'enrich-index-muy4a57p-qf1e')]]);
    const db = { collection: (name: string) => ({ find: (q: Record<string, { $in?: string[] }>) => ({ toArray: async () =>
      (name === 'enrich_batch_jobs' && q._id?.$in?.includes('enrich-index-muy4a57p-qf1e') ? [{ _id: 'enrich-index-muy4a57p-qf1e', gemini_name: null, status: 'submitting' }] : []) }) }) };
    const records = await G.readLedgerRecords(db, jobs);
    expect(records.get('batches/orphan')).toMatchObject([{ store: 'enrich_batch_jobs', status: 'submitting', collected: false, open: false }]);
    const r = G.classifyLedger({ jobs, records, now: NOW });
    expect(r.findings[0]).toMatchObject({ class: 'succeeded_uncollected', records: ['enrich_batch_jobs:submitting'] });
  });
});
