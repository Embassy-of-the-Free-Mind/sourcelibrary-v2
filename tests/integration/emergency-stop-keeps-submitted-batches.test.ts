import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';

/**
 * #5492 B1: an emergency stop must never abandon paid work.
 *
 * A batch_jobs row with a Gemini job name was already submitted (paid). The stop
 * used to mark it `cancelled` in Mongo only, which took it out of the collector's
 * selection forever; Phase 8.5 then re-dispatched the book after 48 h (#4839).
 * These run the real route against a real (in-memory) Mongo, then run the
 * collector's real selection filter against the result.
 */

vi.mock('@/lib/auth-helpers', () => ({
  withAdminAuth: (handler: (req: Request) => Promise<Response>) => handler,
}));

vi.mock('@/lib/sqs-client', () => ({
  purgeAIQueues: vi.fn().mockResolvedValue({ purged: [], errors: [] }),
}));

vi.mock('@/lib/mongodb', async () => {
  const { getTestDb } = await import('../setup');
  return {
    getDb: vi.fn().mockImplementation(async () => getTestDb()),
    getReadDb: vi.fn().mockImplementation(async () => getTestDb()),
  };
});

import { POST } from '@/app/api/admin/emergency-stop/route';
// @ts-expect-error — plain .mjs helper, no types
import { collectableBatchJobsFilter } from '../../scripts/lib/batch-job-filters.mjs';

const old = new Date(Date.now() - 60 * 60 * 1000);

function stop(body?: object) {
  return POST(
    new Request('http://localhost:3000/api/admin/emergency-stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }) as never,
    {} as never,
  );
}

describe('emergency stop keeps submitted batch jobs collectable (#5492 B1)', () => {
  beforeEach(async () => {
    await cleanDb();
    await getTestDb().collection('batch_jobs').insertMany([
      // Submitted — paid work at Gemini.
      { id: 'sub-ocr', type: 'ocr', book_id: 'b1', status: 'pending', gemini_job_name: 'batches/abc', created_at: old },
      { id: 'sub-tr', type: 'translation', book_id: 'b2', status: 'processing', job_name: 'batches/def', created_at: old },
      { id: 'sub-img', type: 'image_extraction', book_ids: ['b3'], status: 'JOB_STATE_RUNNING', gemini_job_name: 'batches/ghi', created_at: old },
      // Never submitted — the insert happened but the Gemini call did not.
      { id: 'unsub', type: 'ocr', book_id: 'b4', status: 'pending', job_name: null, created_at: old },
      { id: 'unsub-empty', type: 'ocr', book_id: 'b5', status: 'processing', gemini_job_name: '', created_at: old },
      // Parent of a multi-job submission: no name of its own, children carry them.
      { id: 'parent', type: 'ocr', book_id: 'b6', status: 'processing', child_job_ids: ['c1'], created_at: old },
    ]);
  });

  for (const [label, body] of [
    ['full stop', undefined],
    ['targeted stop', { paused_phases: ['embeddings'] }],
  ] as const) {
    it(`${label}: submitted rows are untouched and still selected by the collector`, async () => {
      const res = await stop(body);
      const json = await res.json();
      expect(json.success).toBe(true);

      const rows = getTestDb().collection('batch_jobs');
      for (const id of ['sub-ocr', 'sub-tr', 'sub-img']) {
        const row = await rows.findOne({ id });
        expect(row?.status).not.toBe('cancelled');
        expect(row?.cancelled_by).toBeUndefined();
      }
      const collectable = await rows.find(collectableBatchJobsFilter()).toArray();
      expect(collectable.map(r => r.id).sort()).toEqual(['sub-img', 'sub-ocr', 'sub-tr']);
      expect(json.batch_jobs_left_for_collector).toBe(3);
    });

  }

  it('full stop: only never-submitted, non-parent rows are cancelled', async () => {
    const json = await (await stop()).json();
    const cancelled = await getTestDb().collection('batch_jobs').find({ status: 'cancelled' }).toArray();
    expect(cancelled.map(r => r.id).sort()).toEqual(['unsub', 'unsub-empty']);
    expect(json.batch_jobs_cancelled).toBe(2);
    const parent = await getTestDb().collection('batch_jobs').findOne({ id: 'parent' });
    expect(parent?.status).toBe('processing');
  });

  it('targeted stop cancels no batch job at all: cancelling is not keyed by step (#5496 review B1)', async () => {
    const { purgeAIQueues } = await import('@/lib/sqs-client');
    vi.mocked(purgeAIQueues).mockClear();
    await getTestDb().collection('jobs').insertOne({ id: 'lambda-ocr', status: 'processing' });
    const json = await (await stop({ paused_phases: ['embeddings'] })).json();
    expect(json.batch_jobs_cancelled).toBe(0);
    expect(json.lambda_jobs_cancelled).toBe(0);
    expect((await getTestDb().collection('jobs').findOne({ id: 'lambda-ocr' }))?.status).toBe('processing');
    expect(purgeAIQueues).not.toHaveBeenCalled();
    expect(await getTestDb().collection('batch_jobs').countDocuments({ status: 'cancelled' })).toBe(0);
  });

  it('dry run changes nothing', async () => {
    await cleanDb();
    await getTestDb().collection('batch_jobs').insertOne({ id: 'u', status: 'pending', created_at: old });
    const res = await POST(
      new Request('http://localhost:3000/api/admin/emergency-stop?dry_run=true', { method: 'POST' }) as never,
      {} as never,
    );
    const dry = await res.json();
    expect(dry.batch_jobs_cancelled).toBe(1);
    expect((await getTestDb().collection('batch_jobs').findOne({ id: 'u' }))?.status).toBe('pending');
  });
});
