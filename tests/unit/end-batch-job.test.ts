/**
 * endBatchJob() is the one way to mark a batch_jobs row cancelled/failed/expired (#6276).
 * These drive every branch against a recording fake `batch_jobs` and stub Gemini clients
 * shaped like @google/genai's (batches.get → { state, dest } or a thrown ApiError).
 *
 * The incidents behind each refusal: #4889 (a job absent from a listing was failed while
 * RUNNING), #6238 (an emergency stop cancelled submitted rows with no question asked), and the
 * 263 SUCCEEDED OCR jobs Gemini still held on 2026-10-08 that our rows called `cancelled`.
 */
import { describe, it, expect } from 'vitest';
import {
  endBatchJob, endNamelessBatchJobs, markRecovered, meterRecovered, decideEnd, normalizeGeminiState, ROUTE_TO_COLLECTION_STATUS,
  discardBatchJob, decideDiscard, DISCARDED_STATUS,
} from '../../scripts/lib/end-batch-job.mjs';

class ApiErrorStub extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function client(known: Record<string, { state: string; dest?: object }>, err?: () => Error) {
  const gets: string[] = [];
  return {
    gets,
    batches: {
      get: async ({ name }: { name: string }) => {
        gets.push(name);
        if (known[name]) return { name, ...known[name] };
        throw err ? err() : new ApiErrorStub(404, `NOT_FOUND: ${name}`);
      },
    },
  };
}

type Call = { op: string; filter: Record<string, unknown>; set: Record<string, unknown> };
function fakeDb() {
  const calls: Call[] = [];
  const coll = {
    updateOne: async (filter: Record<string, unknown>, u: { $set: Record<string, unknown> }) => { calls.push({ op: 'updateOne', filter, set: u.$set }); return { modifiedCount: 1 }; },
    updateMany: async (filter: Record<string, unknown>, u: { $set: Record<string, unknown> }) => { calls.push({ op: 'updateMany', filter, set: u.$set }); return { modifiedCount: 3 }; },
  };
  return { db: { collection: (n: string) => { expect(n).toBe('batch_jobs'); return coll; } }, calls };
}

const named = (over: Record<string, unknown> = {}) => ({ _id: 'r1', id: 'j1', status: 'processing', job_name: 'batches/abc', ...over });
const base = { reason: 'test', by: 'tests/end-batch-job' };

describe('a named row is ended only on Gemini’s word', () => {
  it('REFUSES when nobody asked Gemini, and records the refusal', async () => {
    const { db, calls } = fakeDb();
    const r = await endBatchJob(db, named(), { ...base, status: 'cancelled' });
    expect(r.action).toBe('refused');
    expect(calls).toHaveLength(1);
    expect(calls[0].set.status).toBeUndefined();
    expect((calls[0].set.last_end_refused as { why: string }).why).toMatch(/not asked/);
  });

  it('REFUSES a job Gemini says is RUNNING or PENDING (the #4889 shape)', async () => {
    for (const state of ['JOB_STATE_RUNNING', 'JOB_STATE_PENDING', 'JOB_STATE_SOMETHING_NEW']) {
      const { db, calls } = fakeDb();
      const k = client({ 'batches/abc': { state } });
      const r = await endBatchJob(db, named(), { ...base, status: 'failed', clients: [k], keys: ['k0'] });
      expect(r.action).toBe('refused');
      expect(k.gets).toEqual(['batches/abc']);
      expect(calls.every((c) => c.set.status === undefined)).toBe(true);
    }
  });

  it('ROUTES a SUCCEEDED job to collection instead of ending it', async () => {
    const { db, calls } = fakeDb();
    const k = client({ 'batches/abc': { state: 'JOB_STATE_SUCCEEDED', dest: { fileName: 'files/batch-abc' } } });
    const r = await endBatchJob(db, named({ status: 'cancelled' }), { ...base, status: 'cancelled', clients: [k], keys: ['k0'] });
    expect(r.action).toBe('routed_to_collection');
    expect(calls[0].set.status).toBe(ROUTE_TO_COLLECTION_STATUS);
    expect(calls[0].set.gemini_state).toBe('JOB_STATE_SUCCEEDED');
  });

  it('leaves the status of a SUCCEEDED row that is already collectable alone', async () => {
    const { db, calls } = fakeDb();
    const r = await endBatchJob(db, named({ status: 'processing' }), { ...base, status: 'failed', gemini: { verdict: 'exists', state: 'JOB_STATE_SUCCEEDED' }, keyCount: 1 });
    expect(r.action).toBe('routed_to_collection');
    expect('status' in calls[0].set).toBe(false);
  });

  it('WRITES a job Gemini says FAILED / CANCELLED / EXPIRED (REST spelling too)', async () => {
    for (const state of ['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED', 'BATCH_STATE_CANCELLED']) {
      const { db, calls } = fakeDb();
      const r = await endBatchJob(db, named(), { ...base, status: 'failed', gemini: { verdict: 'exists', state }, set: { error: 'x' } });
      expect(r.action).toBe('written');
      expect(calls[0].set).toMatchObject({ status: 'failed', error: 'x', ended_by: base.by, end_reason: base.reason, gemini_state: normalizeGeminiState(state) });
      expect(calls[0].filter).toMatchObject({ _id: 'r1' });
    }
  });

  it('WRITES a ghost only when EVERY key said 404', async () => {
    const { db, calls } = fakeDb();
    const keys = [client({}), client({})];
    const r = await endBatchJob(db, named(), { ...base, status: 'failed', clients: keys, keys: ['a', 'b'] });
    expect(r.action).toBe('written');
    expect(keys[0].gets).toEqual(['batches/abc']);
    expect(keys[1].gets).toEqual(['batches/abc']);
    expect(calls[0].set.status).toBe('failed');
  });

  it('REFUSES a ghost when one key errored rather than 404ed', async () => {
    const { db } = fakeDb();
    const keys = [client({}), client({}, () => new ApiErrorStub(503, 'UNAVAILABLE'))];
    const r = await endBatchJob(db, named(), { ...base, status: 'failed', clients: keys, keys: ['a', 'b'] });
    expect(r.action).toBe('refused');
  });

  it('REFUSES a caller-supplied 404 that did not cover every key', async () => {
    const d = decideEnd(named(), { status: 'failed', gemini: { verdict: 'not_found', attempts: [{ result: 'not_found' }] }, keyCount: 3 });
    expect(d.action).toBe('refuse');
    expect(decideEnd(named(), { status: 'failed', gemini: { verdict: 'not_found', attempts: [{ result: 'not_found' }] } }).action).toBe('refuse');
  });

  it('a row whose output was already collected may be ended without asking', () => {
    expect(decideEnd(named({ results_collected: true }), { status: 'failed' }).action).toBe('write');
  });
});

describe('markRecovered closes a recovered row without touching its status', () => {
  const held = { result_sha256: 'a'.repeat(64), result_bytes: 1234, gemini_job: 'batches/abc' };
  const succeeded = { verdict: 'exists', state: 'JOB_STATE_SUCCEEDED' };

  it('MARKS a SUCCEEDED job whose result is held: results_collected + recovery, no status', async () => {
    const { db, calls } = fakeDb();
    const r = await markRecovered(db, named({ status: 'cancelled' }), { gemini: succeeded, by: 't', recovery: held });
    expect(r.action).toBe('marked');
    expect(calls).toHaveLength(1);
    expect(calls[0].set.results_collected).toBe(true);
    expect(calls[0].set.status).toBeUndefined();
    expect(calls[0].filter.results_collected).toEqual({ $ne: true });
  });

  it('REFUSES without Gemini’s SUCCEEDED, without the held result, or on an already-collected row', async () => {
    const cases: [Record<string, unknown>, unknown, Record<string, unknown>][] = [
      [named(), null, held],
      [named(), { verdict: 'exists', state: 'JOB_STATE_CANCELLED' }, held],
      [named(), { verdict: 'not_found', attempts: [] }, held],
      [named(), succeeded, { result_sha256: 'x', result_bytes: 1 }],
      [named(), succeeded, { result_sha256: 'a'.repeat(64), result_bytes: 0 }],
      [named({ results_collected: true }), succeeded, held],
      [named({ job_name: null }), succeeded, held],
    ];
    for (const [job, gemini, recovery] of cases) {
      const { db, calls } = fakeDb();
      const r = await markRecovered(db, job, { gemini, by: 't', recovery });
      expect(r.action).toBe('refused');
      expect(calls).toHaveLength(0);
    }
  });

  it('throws if a status is smuggled into the recovery record', async () => {
    const { db } = fakeDb();
    await expect(markRecovered(db, named(), { gemini: succeeded, by: 't', recovery: { ...held, status: 'saved' } })).rejects.toThrow(/status/);
  });
});

describe('meterRecovered closes out the usage row from the responses (#4599)', () => {
  const ok = (p: number, c: number, t = 0) => ({ response: { usageMetadata: { promptTokenCount: p, candidatesTokenCount: c, thoughtsTokenCount: t } } });
  const err = { error: { code: 13, message: 'INTERNAL' } };
  const job = named({ status: 'cancelled', type: 'ocr', model: 'gemini-3.1-flash-lite', book_id: 'b1', page_count: 3, created_at: new Date('2026-09-15T00:00:00Z') });
  const recorder = () => { const calls: Record<string, unknown>[] = []; return { calls, complete: async (p: Record<string, unknown>) => { calls.push(p); return 'updated'; } }; };

  it('CLOSES the placeholder with tokens summed per response; an errored line adds 0 and is counted', async () => {
    const { calls, complete } = recorder();
    const r = await meterRecovered(job, [ok(100, 40, 10), err, ok(200, 60)], { existing: [{ status: 'submitted', input_tokens: 0, output_tokens: 0 }], complete });
    expect(r.action).toBe('closed');
    expect(r.errored).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ batch_job_id: 'j1', mode: 'batch', input_tokens: 300, output_tokens: 110, status: 'success', page_count: 3, insertIfMissing: true });
    expect(calls[0].error_message).toMatch(/1\/3 responses were per-request errors/);
    expect(calls[0].timestamp).toBe('2026-09-15T00:00:00.000Z'); // an insert lands on the job's day, not today's dial
  });

  it('is idempotent: a row already closed with these tokens is SKIPPED, and a dry run writes nothing', async () => {
    const { calls, complete } = recorder();
    const existing = [{ status: 'success', input_tokens: 300, output_tokens: 110 }];
    expect((await meterRecovered(job, [ok(100, 40, 10), ok(200, 60)], { existing, complete })).action).toBe('skipped');
    expect((await meterRecovered(job, [err], { existing: [{ status: 'failed', input_tokens: 0, output_tokens: 0 }], complete })).action).toBe('skipped');
    expect((await meterRecovered(job, [ok(1, 1)], { existing: [], complete, dryRun: true })).action).toBe('closed');
    expect(calls).toHaveLength(0);
  });

  it('a zero close-out (the waived shape) is overwritten; another reading or two rows is REFUSED', async () => {
    const { calls, complete } = recorder();
    expect((await meterRecovered(job, [ok(5, 5)], { existing: [{ status: 'failed', input_tokens: 0, output_tokens: 0 }], complete })).action).toBe('closed');
    expect((await meterRecovered(job, [ok(5, 5)], { existing: [{ status: 'success', input_tokens: 9, output_tokens: 9 }], complete })).action).toBe('refused');
    expect((await meterRecovered(job, [ok(5, 5)], { existing: [{ status: 'submitted' }, { status: 'submitted' }], complete })).action).toBe('refused');
    expect(calls).toHaveLength(1);
  });

  it('all-error job: closes a placeholder to $0 failed, but inserts no new $0 row', async () => {
    const { calls, complete } = recorder();
    expect((await meterRecovered(job, [err, err], { existing: [], complete })).action).toBe('skipped');
    const r = await meterRecovered(job, [err, err], { existing: [{ status: 'submitted', input_tokens: 0, output_tokens: 0 }], complete });
    expect(r.action).toBe('closed');
    expect(calls[0]).toMatchObject({ input_tokens: 0, output_tokens: 0, status: 'failed', insertIfMissing: false });
  });
});

describe('nameless rows and argument checks', () => {
  it('a nameless row is written, and only while it is still nameless', async () => {
    const { db, calls } = fakeDb();
    const r = await endBatchJob(db, { _id: 'n1', status: 'pending' }, { ...base, status: 'cancelled' });
    expect(r.action).toBe('written');
    expect(JSON.stringify(calls[0].filter.$and)).toContain('job_name');
    expect(JSON.stringify(calls[0].filter.$and)).toContain('gemini_job_name');
  });

  it('endNamelessBatchJobs ANDs the no-name clauses onto any filter, keeping the caller’s own $and', async () => {
    const { db, calls } = fakeDb();
    await endNamelessBatchJobs(db, { status: 'pending', $and: [{ x: 1 }] }, { ...base, status: 'failed' });
    const and = calls[0].filter.$and as object[];
    expect(and).toHaveLength(3);
    expect(and[0]).toEqual({ x: 1 });
    expect(calls[0].set).toMatchObject({ status: 'failed', ended_by: base.by });
  });

  it('refuses non-terminal statuses, a status smuggled in `set`, and a missing reason', async () => {
    const { db } = fakeDb();
    await expect(endBatchJob(db, named(), { ...base, status: 'saved' })).rejects.toThrow(/not a terminal-loss status/);
    await expect(endBatchJob(db, named(), { ...base, status: 'failed', set: { status: 'failed' } })).rejects.toThrow(/opts.status/);
    await expect(endBatchJob(db, named(), { status: 'failed', by: 'x' })).rejects.toThrow(/reason and by/);
    await expect(endNamelessBatchJobs(db, {}, { ...base, status: 'pending' })).rejects.toThrow(/terminal-loss/);
  });
});

// #6333: until discardBatchJob() there was no way to record "finished, looked at, not written":
// a stopped experiment or a superseded re-submission stayed a loss finding until it aged out.
describe('discardBatchJob: a finished job is ended on purpose, or not at all', () => {
  const held = { path: '/data/scratch/sl/batch-recover-6333/results/abc.jsonl', sha256: 'a'.repeat(64), bytes: 9052 };
  const succeeded = { verdict: 'exists', state: 'BATCH_STATE_SUCCEEDED', requests: 2, ok: 1 };
  const opts = { name: 'batches/abc', displayName: 'eval/pareto-6182 G36', reason: 'stopped experiment', by: 'tests', issue: 6293 };
  function db(rows: Record<string, unknown>[]) {
    const writes: Array<{ filter: Record<string, unknown>; update: Record<string, Record<string, unknown>>; opts?: unknown }> = [];
    return { writes, db: { collection: (n: string) => { expect(n).toBe('batch_jobs'); return {
      find: () => ({ toArray: async () => rows }),
      updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>, o?: { upsert?: boolean }) => { writes.push({ filter, update, opts: o }); return { modifiedCount: o?.upsert ? 0 : 1, upsertedCount: o?.upsert ? 1 : 0 }; },
    }; } } };
  }

  it('REFUSES without a reason, without Gemini’s word, on a live job, and on a key that could not answer', () => {
    expect(decideDiscard(null, { reason: ' ', gemini: succeeded, result: held })).toMatchObject({ action: 'refuse', why: 'no reason given' });
    expect(decideDiscard(null, { reason: 'x', gemini: null, result: held }).action).toBe('refuse');
    expect(decideDiscard(null, { reason: 'x', gemini: { verdict: 'exists', state: 'JOB_STATE_RUNNING' }, result: held }).action).toBe('refuse');
    expect(decideDiscard(null, { reason: 'x', gemini: { verdict: 'unmeasurable' }, result: held }).action).toBe('refuse');
  });

  it('REFUSES paid output it does not hold: a discard records where the bytes are', () => {
    expect(decideDiscard(null, { reason: 'x', gemini: succeeded, result: null })).toMatchObject({ action: 'refuse' });
    expect(decideDiscard(null, { reason: 'x', gemini: succeeded, result: { ...held, sha256: 'nope' } }).action).toBe('refuse');
    expect(decideDiscard(null, { reason: 'x', gemini: succeeded, result: held }).action).toBe('discard');
  });

  it('needs no saved result when nothing was paid: every request failed, or the job is dead', () => {
    expect(decideDiscard(null, { reason: 'x', gemini: { verdict: 'exists', state: 'JOB_STATE_SUCCEEDED', requests: 20000, ok: 0 } })).toMatchObject({ action: 'discard' });
    expect(decideDiscard(null, { reason: 'x', gemini: { verdict: 'exists', state: 'JOB_STATE_CANCELLED' } }).action).toBe('discard');
  });

  it('REFUSES a row the collector still owns, and one already collected', () => {
    expect(decideDiscard({ status: 'processing' }, { reason: 'x', gemini: succeeded, result: held }).why).toMatch(/collector still owns/);
    expect(decideDiscard({ status: 'saved' }, { reason: 'x', gemini: succeeded, result: held }).why).toMatch(/already collected/);
    expect(decideDiscard({ status: 'cancelled', results_collected: true }, { reason: 'x', gemini: succeeded, result: held }).why).toMatch(/already collected/);
  });

  it('writes the discard on the job’s own row, filtered on the status it decided on', async () => {
    const f = db([{ _id: 'r1', id: 'pareto-6182-G36', status: 'external_eval', gemini_job_name: 'batches/abc' }]);
    const r = await discardBatchJob(f.db, { ...opts, gemini: succeeded, result: held });
    expect(r).toMatchObject({ action: 'discarded', modified: 1, inserted: 0 });
    expect(f.writes[0].filter).toMatchObject({ _id: 'r1', status: 'external_eval' });
    expect(f.writes[0].update.$set).toMatchObject({ status: DISCARDED_STATUS, status_before_discard: 'external_eval' });
    expect(f.writes[0].update.$set.discard).toMatchObject({ reason: 'stopped experiment', by: 'tests', issue: 6293, result_sha256: held.sha256, requests: 2, requests_ok: 1 });
  });

  it('inserts a record when no batch_jobs row names the job, and never twice', async () => {
    const f = db([]);
    const r = await discardBatchJob(f.db, { ...opts, gemini: succeeded, result: held });
    expect(r).toMatchObject({ action: 'discarded', inserted: 1 });
    expect(f.writes[0].filter).toEqual({ gemini_job_name: 'batches/abc' });
    expect(f.writes[0].opts).toEqual({ upsert: true });
    expect(f.writes[0].update.$setOnInsert).toMatchObject({ status: DISCARDED_STATUS, type: 'discard_record', job_name: 'batches/abc', display_name: 'eval/pareto-6182 G36' });
  });

  it('writes nothing when refused or on a dry run', async () => {
    const f = db([{ _id: 'r1', status: 'pending', job_name: 'batches/abc' }]);
    expect((await discardBatchJob(f.db, { ...opts, gemini: succeeded, result: held })).action).toBe('refused');
    const g = db([]);
    expect((await discardBatchJob(g.db, { ...opts, gemini: succeeded, result: held, dryRun: true })).action).toBe('discarded');
    expect([...f.writes, ...g.writes]).toEqual([]);
  });
});
