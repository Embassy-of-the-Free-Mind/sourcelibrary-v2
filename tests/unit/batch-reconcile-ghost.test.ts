/**
 * Ghost verdicts must come from asking Gemini about the job, never from the
 * job's absence in a truncated listing (issue #4889).
 *
 * The incident: batch-collector's reconcile walked `batches.list` newest-first,
 * stopped after 50 consecutive inactive jobs, and treated every DB-active job
 * missing from that window as "404 on all Gemini keys". 85 RUNNING file-batch
 * OCR jobs (8,770 pages) were failed that way, resubmitted, then completed and
 * billed on Gemini without ever being collected. A second rule in the same
 * function cancels "orphans" (active on Gemini, not DB-active) — so a job the
 * first rule falsely failed would, if it later fell inside the window, be
 * CANCELLED on Gemini.
 *
 * These tests drive the extracted reconciler against a stubbed Mongo and stubbed
 * Gemini clients. A change that infers non-existence from the listing again, or
 * that cancels a job the DB knows in any status, fails here.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  reconcileBatchState,
  probeBatchJob,
  isNotFoundError,
  listActiveJobs,
  GHOST_ERROR,
  LIST_PAGE_SIZE,
} from '../../scripts/workers/lib/batch-reconcile.mjs';

type GeminiJob = { name: string; state: string };

class ApiErrorStub extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * A stub Gemini client. `listed` is what batches.list yields (newest-first);
 * `known` is what batches.get can answer, by name; `getError` overrides the
 * error thrown for names not in `known` (default: a 404 ApiError).
 */
function stubClient(opts: { listed?: GeminiJob[]; known?: Record<string, GeminiJob>; getError?: (name: string) => Error }) {
  const cancels: string[] = [];
  const gets: string[] = [];
  const client = {
    batches: {
      list: async () => (async function* () { for (const j of opts.listed ?? []) yield j; })(),
      get: async ({ name }: { name: string }) => {
        gets.push(name);
        const j = opts.known?.[name];
        if (j) return j;
        throw opts.getError ? opts.getError(name) : new ApiErrorStub(404, `NOT_FOUND: batch ${name} not found`);
      },
      cancel: async ({ name }: { name: string }) => { cancels.push(name); },
    },
  };
  return { client, cancels, gets };
}

type Row = Record<string, unknown> & { _id: string; status: string };

/** A minimal in-memory `batch_jobs` + `pages` stand-in with the verbs the reconciler uses. */
function stubDb(rows: Row[]) {
  const updates: Array<{ filter: unknown; set: Record<string, unknown> }> = [];
  const matches = (row: Row, filter: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') return (v as Record<string, unknown>[]).some(f => matches(row, f));
      const cond = v as { $in?: unknown[] } | unknown;
      if (cond && typeof cond === 'object' && '$in' in (cond as object)) {
        if (!(cond as { $in: unknown[] }).$in.includes(row[k])) return false;
      } else if (row[k] !== cond) return false;
    }
    return true;
  };
  const collection = (name: string) => ({
    find: (filter: Record<string, unknown>) => {
      const hits = name === 'batch_jobs' ? rows.filter(r => matches(r, filter)) : [];
      const cursor = { project: () => cursor, toArray: async () => hits.map(r => ({ ...r })) };
      return cursor;
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      updates.push({ filter, set: update.$set });
      const row = rows.find(r => matches(r, filter));
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
    updateMany: async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      let n = 0;
      for (const row of rows) if (matches(row, filter)) { Object.assign(row, update.$set); n++; }
      updates.push({ filter, set: update.$set });
      return { modifiedCount: n };
    },
    countDocuments: async () => 0,
  });
  return { db: { collection }, rows, updates };
}

const HOUR = 3600_000;
const NOW = Date.parse('2026-09-15T18:30:00Z');
const twoHoursAgo = new Date(NOW - 2 * HOUR);

/** Newest-first listing: `n` inactive jobs on top, hiding anything older. */
function inactiveWall(n: number): GeminiJob[] {
  return Array.from({ length: n }, (_, i) => ({ name: `batches/done-${i}`, state: 'JOB_STATE_SUCCEEDED' }));
}

describe('the incident shape: absent from a truncated listing but RUNNING on batches.get', () => {
  it('is NOT failed, and its liveness is recorded on the row', async () => {
    const running = { name: 'batches/old-running', state: 'JOB_STATE_RUNNING' };
    // 300 finished jobs on top; the listing budget is one page, so the running job is never listed.
    const k0 = stubClient({ listed: inactiveWall(300), known: { [running.name]: running } });
    const k1 = stubClient({ listed: [] });
    const { db, rows, updates } = stubDb([
      { _id: 'j1', status: 'processing', job_name: running.name, created_at: twoHoursAgo, type: 'ocr', book_id: 'b1' },
    ]);
    const log = vi.fn();

    const r = await reconcileBatchState(db, { clients: [k0.client, k1.client], keys: ['key-0', 'key-1'], now: () => NOW, log, pageBudget: 1 });

    expect(rows[0].status).toBe('processing');
    expect(rows[0].error).toBeUndefined();
    expect(r.ghostCandidates).toBe(1);
    expect(r.ghostsProbed).toBe(1);
    expect(r.ghostsAlive).toBe(1);
    expect(r.ghostsConfirmed).toBe(0);
    expect(r.ghostsDetected).toBe(0);
    // The probe actually asked Gemini about THIS job.
    expect(k0.gets).toContain(running.name);
    // And what it learned is on the row.
    const probe = rows[0].last_ghost_probe as { verdict: string; state: string };
    expect(probe.verdict).toBe('exists');
    expect(probe.state).toBe('JOB_STATE_RUNNING');
    // Nothing was cancelled.
    expect(k0.cancels).toEqual([]);
    expect(k1.cancels).toEqual([]);
    // No status write happened at all.
    expect(updates.filter(u => 'status' in u.set)).toHaveLength(0);
  });

  it('a SUCCEEDED-but-uncollected job is likewise left for the collection pass', async () => {
    const done = { name: 'batches/old-succeeded', state: 'JOB_STATE_SUCCEEDED' };
    const k0 = stubClient({ listed: inactiveWall(150), known: { [done.name]: done } });
    const { db, rows } = stubDb([
      { _id: 'j1', status: 'processing', job_name: done.name, created_at: twoHoursAgo },
    ]);
    const r = await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {}, pageBudget: 1 });
    expect(rows[0].status).toBe('processing');
    expect(r.ghostsAlive).toBe(1);
  });
});

describe('a real ghost: 404 on every key', () => {
  it('is failed, with the per-key evidence on the row and the meter closed', async () => {
    const k0 = stubClient({ listed: [] });
    const k1 = stubClient({ listed: [] });
    const { db, rows } = stubDb([
      { _id: 'j1', status: 'pending', job_name: 'batches/vanished', created_at: twoHoursAgo, type: 'ocr', book_id: 'b1' },
    ]);
    const closePlaceholder = vi.fn(async () => {});

    const r = await reconcileBatchState(db, { clients: [k0.client, k1.client], keys: ['key-0', 'key-1'], closePlaceholder, now: () => NOW, log: () => {} });

    expect(r.ghostsConfirmed).toBe(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBe(GHOST_ERROR);
    const verdict = rows[0].ghost_verdict as { verdict: string; keys_tried: number; attempts: Array<{ key_index: number; key: string; result: string; status: number }> };
    expect(verdict.verdict).toBe('not_found');
    expect(verdict.keys_tried).toBe(2);
    expect(verdict.attempts.map(a => a.result)).toEqual(['not_found', 'not_found']);
    expect(verdict.attempts.map(a => a.status)).toEqual([404, 404]);
    // Keys are fingerprinted, never written.
    for (const a of verdict.attempts) {
      expect(a.key).toMatch(/^[0-9a-f]{8}$/);
      expect(JSON.stringify(verdict)).not.toContain('key-0');
    }
    expect(closePlaceholder).toHaveBeenCalledTimes(1);
    expect(closePlaceholder.mock.calls[0][2]).toBe(GHOST_ERROR);
  });

  it('is not probed at all while younger than 30 minutes', async () => {
    const k0 = stubClient({ listed: [] });
    const { db, rows } = stubDb([
      { _id: 'j1', status: 'pending', job_name: 'batches/fresh', created_at: new Date(NOW - 5 * 60_000) },
    ]);
    const r = await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {} });
    expect(r.ghostCandidates).toBe(0);
    expect(k0.gets).toEqual([]);
    expect(rows[0].status).toBe('pending');
  });
});

describe('an unmeasurable probe is not a verdict', () => {
  it('leaves the row in flight when one key errors and no key returns the job', async () => {
    const k0 = stubClient({ listed: [], getError: () => new ApiErrorStub(503, 'Service Unavailable') });
    const k1 = stubClient({ listed: [] }); // genuine 404
    const { db, rows } = stubDb([
      { _id: 'j1', status: 'processing', job_name: 'batches/unreachable', created_at: twoHoursAgo },
    ]);
    const r = await reconcileBatchState(db, { clients: [k0.client, k1.client], now: () => NOW, log: () => {} });

    expect(r.ghostsUnmeasurable).toBe(1);
    expect(r.ghostsConfirmed).toBe(0);
    expect(rows[0].status).toBe('processing');
    const probe = rows[0].last_ghost_probe as { verdict: string; attempts: Array<{ result: string; status: number }> };
    expect(probe.verdict).toBe('unmeasurable');
    expect(probe.attempts.map(a => a.result)).toEqual(['error', 'not_found']);
    expect(probe.attempts[0].status).toBe(503);
    expect(r.issues.some(i => /unmeasurable/.test(i))).toBe(true);
  });

  it('a 403 (key cannot see the job) is not a 404', () => {
    expect(isNotFoundError(new ApiErrorStub(403, 'PERMISSION_DENIED'))).toBe(false);
    expect(isNotFoundError(new ApiErrorStub(404, 'NOT_FOUND'))).toBe(true);
    expect(isNotFoundError(new Error('fetch failed'))).toBe(false);
    // Message-only errors (no numeric status) still classify by text.
    expect(isNotFoundError(new Error('Batch not found'))).toBe(true);
  });

  it('probeBatchJob reports per-key results in key order', async () => {
    const job = { name: 'batches/x', state: 'JOB_STATE_RUNNING' };
    const k0 = stubClient({}); // 404
    const k1 = stubClient({ known: { [job.name]: job } });
    const p = await probeBatchJob(job.name, [k0.client, k1.client], ['a', 'b']);
    expect(p.verdict).toBe('exists');
    expect(p.keyIndex).toBe(1);
    expect(p.attempts.map(a => a.result)).toEqual(['not_found', 'found']);
  });
});

describe('orphan cancellation', () => {
  it('cancels a Gemini-active job the DB has never heard of', async () => {
    const k0 = stubClient({ listed: [{ name: 'batches/stranger', state: 'JOB_STATE_RUNNING' }] });
    const { db } = stubDb([]);
    const r = await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {} });
    expect(r.orphansCancelled).toBe(1);
    expect(k0.cancels).toEqual(['batches/stranger']);
  });

  it('does NOT cancel a Gemini-active job the DB knows in a non-active status (a previously failed row)', async () => {
    const name = 'batches/falsely-failed';
    const k0 = stubClient({ listed: [{ name, state: 'JOB_STATE_RUNNING' }] });
    const { db, rows } = stubDb([
      { _id: 'j1', status: 'failed', job_name: name, error: 'Ghost: named in DB but 404 on all Gemini keys', created_at: twoHoursAgo },
    ]);
    const r = await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {} });
    expect(k0.cancels).toEqual([]);
    expect(r.orphansCancelled).toBe(0);
    expect(r.orphansSparedKnownToDb).toBe(1);
    expect(rows[0].status).toBe('failed'); // reconcile does not resurrect; recovery does
  });

  it('honours the legacy gemini_job_name field when deciding what the DB knows', async () => {
    const name = 'batches/legacy-named';
    const k0 = stubClient({ listed: [{ name, state: 'JOB_STATE_PENDING' }] });
    const { db } = stubDb([{ _id: 'j1', status: 'saved', gemini_job_name: name, created_at: twoHoursAgo }]);
    await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {} });
    expect(k0.cancels).toEqual([]);
  });
});

describe('the listing walk is budgeted and loud', () => {
  it('stops at the page budget, says so, and never treats absence as non-existence', async () => {
    const wall = inactiveWall(LIST_PAGE_SIZE * 2 + 5);
    const k0 = stubClient({ listed: [...wall, { name: 'batches/beyond', state: 'JOB_STATE_RUNNING' }] });
    const log = vi.fn();
    const listing = await listActiveJobs([k0.client], { pageBudget: 2, log });
    expect(listing.truncated).toBe(true);
    expect(listing.perKey[0].seen).toBe(LIST_PAGE_SIZE * 2);
    expect(listing.activeNames.has('batches/beyond')).toBe(false);
    expect(listing.issues.some(i => /truncated at page budget/.test(i))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/listing truncated at page budget/));
  });

  it('does not stop early on a run of inactive jobs — an active job after 60 finished ones is still listed', async () => {
    const k0 = stubClient({ listed: [...inactiveWall(60), { name: 'batches/after-the-wall', state: 'JOB_STATE_RUNNING' }] });
    const listing = await listActiveJobs([k0.client], { pageBudget: 1, log: () => {} });
    expect(listing.truncated).toBe(false);
    expect(listing.activeNames.has('batches/after-the-wall')).toBe(true);
  });

  it('surfaces truncation on the reconcile result', async () => {
    const k0 = stubClient({ listed: inactiveWall(LIST_PAGE_SIZE + 1) });
    const { db } = stubDb([]);
    const r = await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {}, pageBudget: 1 });
    expect(r.listingTruncated).toBe(true);
    expect(r.issues.some(i => /truncated/.test(i))).toBe(true);
  });
});

describe('dry run', () => {
  it('writes nothing and cancels nothing', async () => {
    const k0 = stubClient({ listed: [{ name: 'batches/stranger', state: 'JOB_STATE_RUNNING' }] });
    const { db, rows, updates } = stubDb([
      { _id: 'j1', status: 'pending', job_name: 'batches/vanished', created_at: twoHoursAgo },
    ]);
    const r = await reconcileBatchState(db, { clients: [k0.client], now: () => NOW, log: () => {}, dryRun: true });
    expect(r.ghostsConfirmed).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(updates).toHaveLength(0);
    expect(k0.cancels).toEqual([]);
  });
});
