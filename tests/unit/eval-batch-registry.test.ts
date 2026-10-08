/**
 * An eval Batch registration must have an end (#5897).
 *
 * The incident: eval scripts registered hand-submitted Gemini Batch jobs in `batch_jobs` as
 * `external_eval` so the orphan sweep would spare them, and nothing ever changed that status.
 * The daily paid-vs-got audit counts every non-terminal named row as open at Gemini, so it
 * reported 1, then 14, then 28 "jobs past 40 h" over four days. All were finished and downloaded.
 *
 * Two things are pinned here. The helper's close moves a row to a status the audit treats as
 * finished and touches nothing else. And no script writes the `external_eval` status itself:
 * a copy of the register write is how four scripts ended up without a close.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { registerEvalBatch, closeEvalBatch, EVAL_OPEN, EVAL_CLOSED } from '../../scripts/lib/eval-batch-registry.mjs';
import { BATCH_TERMINAL, collectionCheck } from '../../scripts/audit/paid-vs-got.mjs';

type Row = Record<string, unknown>;

/** The two Mongo calls the helper makes, over an in-memory array. */
function fakeDb(rows: Row[]) {
  return {
    collection: () => ({
      async updateOne(filter: Row, update: { $set?: Row; $setOnInsert?: Row }, opts?: { upsert?: boolean }) {
        const row = rows.find((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
        if (row) {
          if (update.$set) Object.assign(row, update.$set);
          return { modifiedCount: update.$set ? 1 : 0, upsertedCount: 0 };
        }
        if (opts?.upsert) { rows.push({ ...filter, ...update.$setOnInsert }); return { modifiedCount: 0, upsertedCount: 1 }; }
        return { modifiedCount: 0, upsertedCount: 0 };
      },
    }),
  } as never;
}

const HOURS_AGO = (h: number) => new Date(Date.now() - h * 3600e3);

describe('eval batch registry', () => {
  it('a registered eval batch is open to the audit, and FAILs past 40 h if never collected', async () => {
    const rows: Row[] = [];
    await registerEvalBatch(fakeDb(rows), { jobName: 'batches/a', id: 'eval-a', submittedBy: 'scripts/eval/x.mjs', submittedAt: HOURS_AGO(41), issue: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(EVAL_OPEN);
    expect(rows[0].submitted_by).toBe('scripts/eval/x.mjs');
    expect(BATCH_TERMINAL.has(EVAL_OPEN)).toBe(false);
    expect(collectionCheck({ jobs: rows as never }).fail).toBe(1);
  });

  it('closing it ends the registration: the same 41 h row no longer counts as open', async () => {
    const rows: Row[] = [];
    const db = fakeDb(rows);
    await registerEvalBatch(db, { jobName: 'batches/a', id: 'eval-a', submittedBy: 'scripts/eval/x.mjs', submittedAt: HOURS_AGO(41) });
    expect(await closeEvalBatch(db, 'batches/a', { evidence: '63 responses written to out/', usage: { cost_usd: 0.02 } })).toBe(1);
    expect(rows[0]).toMatchObject({ status: EVAL_CLOSED, results_collected: true, collected_evidence: '63 responses written to out/', cost_usd: 0.02 });
    expect(BATCH_TERMINAL.has(EVAL_CLOSED)).toBe(true);
    expect(collectionCheck({ jobs: rows as never }).fail).toBe(0);
  });

  it('close never touches a row that is not an open eval registration', async () => {
    const rows: Row[] = [
      { gemini_job_name: 'batches/prod', status: 'pending', type: 'ocr' },
      { gemini_job_name: 'batches/done', status: EVAL_CLOSED, collected_evidence: 'first' },
    ];
    const db = fakeDb(rows);
    expect(await closeEvalBatch(db, 'batches/prod', { evidence: 'x' })).toBe(0);
    expect(await closeEvalBatch(db, 'batches/done', { evidence: 'second' })).toBe(0);
    expect(await closeEvalBatch(db, 'batches/unknown', { evidence: 'x' })).toBe(0);
    expect(rows[0].status).toBe('pending');
    expect(rows[1].collected_evidence).toBe('first');
  });

  it('close refuses to run without saying what proves the download', async () => {
    await expect(closeEvalBatch(fakeDb([]), 'batches/a', {} as never)).rejects.toThrow(/evidence/);
  });

  it('no script writes the external_eval status except through the helper', () => {
    const root = path.resolve(__dirname, '../..');
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-n', '-E', "status: *['\"]external_eval['\"]", '--', 'scripts', 'src'], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e; // 1 = no match
    }
    expect(hits.trim().split('\n').filter(Boolean)).toEqual([]);
  });
});
