/**
 * Batch usage metering guards (issue #3452).
 *
 * The bug: a batch job wrote a gemini_usage row at SUBMIT time — before the job
 * had run, so input_tokens/output_tokens/cost_usd were 0 by construction — and
 * nothing ever closed it out. batch-collector inserted a SECOND row with the
 * real numbers, so the meter read $0.00 across ~376K pages of batch OCR while
 * simultaneously double-counting calls and pages for batches that completed.
 *
 * These tests exercise behaviour, not source shape: the reconciler is driven
 * against a stubbed Supabase and asserted on the HTTP verb + filter it issues,
 * and the resolution table is called with real batch_jobs shapes. A change that
 * reverts to "insert a second row", or that resumes counting only saved pages,
 * fails here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The logger reads SUPABASE_SERVICE_ROLE_KEY once at module load, so this has
// to be set before the import below — vi.hoisted runs ahead of imports.
vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'; });

import {
  completeBatchUsage,
  sumBatchResponseUsage,
  PLACEHOLDER_STATUSES,
} from '../../scripts/workers/lib/supabase-usage-logger.mjs';
import { resolvePlaceholder, indexJobsByEveryKey } from '../../scripts/maintenance/reconcile-batch-usage.mjs';

type Call = { url: string; init: RequestInit };

/** Stub Supabase REST; PATCH returns `patched` rows, POST always succeeds. */
function stubSupabase(patched: unknown[]) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = init.method === 'PATCH' ? JSON.stringify(patched) : '';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('completeBatchUsage', () => {
  const params = {
    type: 'ocr',
    mode: 'batch',
    model: 'gemini-3-flash-preview',
    book_id: 'book-1',
    page_count: 40,
    input_tokens: 113961,
    output_tokens: 25727,
    status: 'success',
    batch_job_id: 'batch-abc',
  };

  it('closes the submit-time placeholder instead of inserting a second row', async () => {
    const calls = stubSupabase([{ id: 'gu_1' }]);

    const result = await completeBatchUsage(params);

    expect(result).toBe('updated');
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(init.method).toBe('PATCH');
    // Scoped to this batch AND to placeholder statuses only — never overwrite a
    // row that already holds a real, collected figure.
    expect(url).toContain('batch_job_id=eq.batch-abc');
    for (const status of PLACEHOLDER_STATUSES) expect(url).toContain(status);
    const patch = JSON.parse(String(init.body));
    expect(patch.input_tokens).toBe(113961);
    expect(patch.cost_usd).toBeGreaterThan(0);
    expect(patch.completed_at).toBeTruthy();
  });

  it('matches both placeholder spellings, since two writers disagree', () => {
    // 'submitted' from the Hetzner orchestrator, 'pending' from gemini-logger.ts.
    // logBatchResult() looked only for 'pending' and so never matched the rows
    // that actually existed — the reason the backfill "existed" but never ran.
    expect(PLACEHOLDER_STATUSES).toContain('submitted');
    expect(PLACEHOLDER_STATUSES).toContain('pending');
  });

  it('falls back to inserting when no placeholder exists, so spend is never dropped', async () => {
    const calls = stubSupabase([]); // PATCH matched nothing

    const result = await completeBatchUsage(params);

    expect(result).toBe('inserted');
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[1].init.method).toBe('POST');
    const inserted = JSON.parse(String(calls[1].init.body));
    expect(inserted.input_tokens).toBe(113961);
    expect(inserted.cost_usd).toBeGreaterThan(0);
  });

  it('does not manufacture a zero row when the caller only wanted to close one', async () => {
    const calls = stubSupabase([]);

    const result = await completeBatchUsage({ ...params, input_tokens: 0, output_tokens: 0, cost_usd: 0, status: 'failed', insertIfMissing: false });

    expect(result).toBe('skipped');
    expect(calls.filter(c => c.init.method === 'POST')).toHaveLength(0);
  });

  it('refuses to run without a batch_job_id — an unkeyed patch would rewrite the table', async () => {
    stubSupabase([{ id: 'gu_1' }]);
    await expect(completeBatchUsage({ ...params, batch_job_id: undefined })).rejects.toThrow(/batch_job_id/);
  });
});

describe('sumBatchResponseUsage', () => {
  const resp = (prompt: number, candidates: number, extra: Record<string, unknown> = {}) => ({
    ...extra,
    response: { usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: candidates } },
  });

  it('counts responses we discard — Gemini bills the prompt regardless', () => {
    // A job where every page was RECITATION-blocked used to record $0.00.
    const blocked = {
      response: {
        candidates: [{ finishReason: 'RECITATION' }],
        usageMetadata: { promptTokenCount: 2500, candidatesTokenCount: 0 },
      },
    };
    expect(sumBatchResponseUsage([blocked, blocked])).toEqual({ inputTokens: 5000, outputTokens: 0 });
  });

  it('counts one response once, however many pages it covers', () => {
    // Multi-page mode: one request carries N images and ONE usageMetadata.
    // Attributing it per parsed page multiplied the cost by N.
    expect(sumBatchResponseUsage([resp(10000, 4000)])).toEqual({ inputTokens: 10000, outputTokens: 4000 });
  });

  it('tolerates missing usage metadata and empty input', () => {
    expect(sumBatchResponseUsage([{ error: 'boom' }, {}, resp(5, 5)])).toEqual({ inputTokens: 5, outputTokens: 5 });
    expect(sumBatchResponseUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('resolvePlaceholder', () => {
  const row = { id: 'gu_1', batch_job_id: 'b1', model: 'gemini-3-flash-preview', status: 'submitted' };

  it('fills tokens and cost from a collected batch job', () => {
    const job = { status: 'saved', model: 'gemini-3-flash-preview', input_tokens: 113961, output_tokens: 25727, cost_usd: 0.067081, page_count: 40, completed_pages: 35 };
    const { action, patch } = resolvePlaceholder(row, job, false);
    expect(action).toBe('filled');
    expect(patch).toMatchObject({ status: 'success', input_tokens: 113961, cost_usd: 0.067081, page_count: 40 });
  });

  it('reports a job whose every page failed as failed, not success', () => {
    // The collector hardcoded status: 'success' on the usage row even when the
    // batch saved zero pages.
    const job = { status: 'saved', completed_pages: 0, failed_pages: 40, input_tokens: 0, output_tokens: 0, error: 'All 40 pages blocked by RECITATION filter' };
    const { patch } = resolvePlaceholder(row, job, false);
    expect(patch?.status).toBe('failed');
    expect(patch?.error_message).toMatch(/RECITATION/);
  });

  it('marks the placeholder duplicate when the collector already logged the spend', () => {
    const job = { status: 'saved', input_tokens: 78288, output_tokens: 21787, completed_pages: 24 };
    const { action, patch } = resolvePlaceholder(row, job, true);
    expect(action).toBe('duplicate');
    expect(patch?.status).toBe('duplicate');
    // Must NOT copy the tokens across — that is the double-count.
    expect(patch).not.toHaveProperty('input_tokens');
  });

  it('leaves in-flight batches alone', () => {
    for (const status of ['pending', 'processing']) {
      expect(resolvePlaceholder(row, { status }, false).patch).toBeNull();
    }
  });

  it('closes out jobs that died without producing results', () => {
    for (const status of ['failed', 'cancelled', 'archived_failed', 'expired']) {
      const { patch } = resolvePlaceholder(row, { status, error: 'Ghost: named in DB but 404 on all Gemini keys' }, false);
      expect(patch?.status).toBe('failed');
      expect(patch?.cost_usd).toBe(0);
    }
  });

  it('records a superseded job as superseded rather than as zero spend', () => {
    // The job DID run and WAS billed; we discarded the output without reading
    // the tokens. Saying "failed, $0" would be a different lie.
    const { patch } = resolvePlaceholder(row, { status: 'superseded' }, false);
    expect(patch?.status).toBe('superseded');
    expect(patch).not.toHaveProperty('cost_usd');
  });

  it('marks an unresolvable placeholder unknown, not zero-spend', () => {
    // With no batch_jobs record we cannot say whether the batch ran. 'failed,
    // $0.00' would be a confident wrong answer — the failure this issue is about.
    const { action, patch } = resolvePlaceholder(row, null, false);
    expect(action).toBe('orphan');
    expect(patch?.status).toBe('unknown');
    expect(patch).not.toHaveProperty('cost_usd');
    expect(patch?.error_message).toMatch(/unmeasurable/);
  });

});

describe('indexJobsByEveryKey', () => {
  it('resolves a batch_job_id that is a Gemini job name, not a batch_jobs id', () => {
    // /api/books/[id]/batch-ocr-async stored "batches/v7zl…" in batch_job_id.
    // Joining on batch_jobs.id alone called 562 of the first 1,000 live
    // placeholders orphans — a wrong answer that looked like missing data.
    const job = { id: 'abc123', job_name: 'batches/v7zl68t5jej8g8rpovsr3wpg0y6zxpaou8ew', status: 'saved' };
    const map = indexJobsByEveryKey([job]);
    expect(map.get('abc123')).toBe(job);
    expect(map.get('batches/v7zl68t5jej8g8rpovsr3wpg0y6zxpaou8ew')).toBe(job);
  });

  it('skips absent keys rather than mapping undefined', () => {
    const map = indexJobsByEveryKey([{ id: 'only-id' }]);
    expect(map.size).toBe(1);
    expect(map.has(undefined as never)).toBe(false);
  });
});
