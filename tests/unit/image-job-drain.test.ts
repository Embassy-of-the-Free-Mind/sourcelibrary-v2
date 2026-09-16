import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs worker helper, no types
import { classifyImageJobDrain, drainStalledImageJobs, NO_RESULTS_MARK } from '../../scripts/workers/lib/image-job-drain.mjs';

/**
 * The loop this guards against (#4839): `jobs.progress.completed` only ever counted pages carrying
 * `detected_images`, so a candidate page with no illustrations on it was paid for and never
 * counted. The job could not reach its total, the reaper cancelled it, the orphan detector rolled
 * the book back, and Phase 8 re-dispatched every page — 1,385 cancellations in one week.
 */

/** Mongo-ish stub: pages.find({id:{$in}, image_extraction_updated_at:{$gte}}), jobs/books updates. */
function mockDb(pages: Array<{ id: string; image_extraction_updated_at?: Date }>) {
  const updates: Array<{ collection: string; filter: any; update: any }> = [];
  return {
    updates,
    collection(name: string) {
      return {
        find(query: any) {
          const ids: string[] = query?.id?.$in ?? [];
          const gte: Date | undefined = query?.image_extraction_updated_at?.$gte;
          const rows = pages.filter(p =>
            ids.includes(p.id) &&
            (!gte || (p.image_extraction_updated_at && p.image_extraction_updated_at >= gte)));
          return { project: () => ({ toArray: async () => rows.map(p => ({ id: p.id })) }) };
        },
        updateOne: async (filter: any, update: any) => { updates.push({ collection: name, filter, update }); },
      };
    },
  };
}

describe('classifyImageJobDrain', () => {
  it('calls a job COMPLETE when every target page was extracted, even with zero detections', () => {
    const result = classifyImageJobDrain(['p1', 'p2', 'p3'], ['p1', 'p2', 'p3']);
    expect(result.outcome).toBe('completed');
    expect(result.missingPageIds).toEqual([]);
  });

  it('reports the unreported pages rather than dropping them silently', () => {
    const result = classifyImageJobDrain(['p1', 'p2', 'p3'], ['p1']);
    expect(result.outcome).toBe('completed_with_errors');
    expect(result.attempted).toBe(1);
    expect(result.missingPageIds).toEqual(['p2', 'p3']);
  });

  it('refuses to finalize a job where NOTHING reported — that lane is broken, not finished', () => {
    const result = classifyImageJobDrain(['p1', 'p2'], []);
    expect(result.outcome).toBe('no_results');
    expect(result.missingPageIds).toEqual(['p1', 'p2']);
  });
});

describe('drainStalledImageJobs', () => {
  const createdAt = new Date('2026-09-15T10:00:00Z');
  const duringRun = new Date('2026-09-15T10:05:00Z');
  const beforeRun = new Date('2026-09-10T10:00:00Z');

  it('finalizes the exact shape that caused the loop: total 12, completed 8, 4 illustration-free pages', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, image_extraction_updated_at: duringRun }));
    const db = mockDb(pages);
    const job = { _id: 'x', id: 'job1', book_id: 'b1', created_at: createdAt, config: { page_ids: pages.map(p => p.id) }, progress: { total: 12, completed: 8, failed: 0 } };

    const { finalized, noResults } = await drainStalledImageJobs(db as any, [job]);

    expect(noResults).toHaveLength(0);
    expect(finalized[0]).toMatchObject({ jobId: 'job1', status: 'completed', attempted: 12, missing: 0 });
    const jobUpdate = db.updates.find(u => u.collection === 'jobs');
    expect(jobUpdate?.update.$set.status).toBe('completed');
    expect(jobUpdate?.update.$set['progress.completed']).toBe(12);
  });

  it('counts only pages attempted in THIS run — an older extraction does not close a new job', async () => {
    const db = mockDb([
      { id: 'p1', image_extraction_updated_at: duringRun },
      { id: 'p2', image_extraction_updated_at: beforeRun },
    ]);
    const job = { _id: 'x', id: 'job2', book_id: 'b2', created_at: createdAt, config: { page_ids: ['p1', 'p2'] } };

    const { finalized } = await drainStalledImageJobs(db as any, [job]);

    expect(finalized[0]).toMatchObject({ status: 'completed_with_errors', attempted: 1, missing: 1 });
    const jobUpdate = db.updates.find(u => u.collection === 'jobs');
    expect(jobUpdate?.update.$set.unreported_page_ids).toEqual(['p2']);
  });

  it('hands a wholly silent job back to the caller to cancel, and writes nothing', async () => {
    const db = mockDb([{ id: 'p1' }, { id: 'p2' }]);
    const job = { _id: 'x', id: 'job3', book_id: 'b3', created_at: createdAt, config: { page_ids: ['p1', 'p2'] } };

    const { finalized, noResults } = await drainStalledImageJobs(db as any, [job]);

    expect(finalized).toHaveLength(0);
    expect(noResults).toHaveLength(1);
    expect(db.updates).toHaveLength(0);
  });

  it('dryRun decides without writing', async () => {
    const db = mockDb([{ id: 'p1', image_extraction_updated_at: duringRun }]);
    const job = { _id: 'x', id: 'job4', book_id: 'b4', created_at: createdAt, config: { page_ids: ['p1'] } };

    const { finalized } = await drainStalledImageJobs(db as any, [job], { dryRun: true });

    expect(finalized[0].status).toBe('completed');
    expect(db.updates).toHaveLength(0);
  });

  it('keeps the give-up marker greppable — Phase 8 counts cancellations by it', () => {
    expect(NO_RESULTS_MARK).toContain('#4839');
  });
});
