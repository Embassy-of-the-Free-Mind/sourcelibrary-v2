import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — .mjs maintenance script, no types
import { planAdoption } from '../../scripts/maintenance/adopt-enrich-batch.mjs';

/**
 * Adopting an orphaned enrich Batch job must not release any other book (#6145). The first
 * adoption deleted the parked state rows of 67 books the job did not hold; the hourly lane
 * re-admitted them and spent $2.94 nobody had decided. A row at `<stage>_pending` is what stops
 * re-admission, so the adopter writes only the job's own books and deletes nothing.
 */
describe('adopt-enrich-batch', () => {
  const now = new Date('2026-10-12T00:00:00Z');
  const jobRow = { _id: 'enrich-index-x', stage: 'index', status: 'submitting', book_ids: ['a', 'b', 'c'] };
  const stateRows = [
    { _id: 'a', stage: 'index_pending' },
    { _id: 'b', stage: 'index_pending' },
    { _id: 'c', stage: 'index_collected' }, // went on by another route
    { _id: 'p1', stage: 'index_pending' }, // parked, not in this job
    { _id: 'p2', stage: 'index_pending' },
    { _id: 'd', stage: 'done' },
  ];
  const plan = planAdoption({ jobId: 'enrich-index-x', geminiName: 'batches/abc', jobRow, stateRows, now });

  it('moves the job to submitted under its Gemini name', () => {
    expect(plan.refuse).toBeNull();
    expect(plan.job.filter).toEqual({ _id: 'enrich-index-x', status: 'submitting' });
    expect(plan.job.update.$set).toMatchObject({ status: 'submitted', gemini_name: 'batches/abc' });
    expect(plan.job.upsert).toBe(false);
  });

  it('moves only the job\'s own parked books', () => {
    expect(plan.adopted).toEqual(['a', 'b']);
    expect(plan.states.map((s: { filter: { _id: string } }) => s.filter._id)).toEqual(['a', 'b']);
    for (const s of plan.states) {
      expect(s.filter.stage).toBe('index_pending');
      expect(s.update.$set).toMatchObject({ stage: 'index_submitted', index_job: 'enrich-index-x' });
    }
    expect(plan.notParked).toEqual([{ book_id: 'c', stage: 'index_collected' }]);
  });

  it('never writes a book outside the job: parked rows are listed and left parked', () => {
    expect(plan.leftParked).toEqual(['p1', 'p2']);
    const written = new Set(plan.states.map((s: { filter: { _id: string } }) => s.filter._id));
    for (const id of ['p1', 'p2', 'd', 'c']) expect(written.has(id)).toBe(false);
  });

  it('every planned write is an update, and the script holds no delete', () => {
    for (const s of plan.states) expect(Object.keys(s.update)).toEqual(['$set']);
    const src = readFileSync('scripts/maintenance/adopt-enrich-batch.mjs', 'utf8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/\.(deleteMany|deleteOne|findOneAndDelete|drop|remove)\s*\(/);
    expect(src).not.toMatch(/\$unset/);
  });

  it('refuses a job the lane already tracks, and a job it cannot identify', () => {
    expect(planAdoption({ jobId: 'j', geminiName: 'batches/x', jobRow: { ...jobRow, status: 'submitted' }, stateRows }).refuse).toMatch(/status 'submitted'/);
    expect(planAdoption({ jobId: 'j', geminiName: 'batches/x', jobRow: { ...jobRow, status: 'collected' }, stateRows }).refuse).toMatch(/collected/);
    expect(planAdoption({ jobId: 'j', geminiName: null, jobRow, stateRows }).refuse).toMatch(/Gemini resource name/);
    expect(planAdoption({ jobId: 'j', geminiName: 'batches/x', jobRow: null, stateRows }).refuse).toMatch(/no stage/);
    expect(planAdoption({ jobId: 'j', geminiName: 'batches/x', stage: 'index', jobRow: null, stateRows }).refuse).toMatch(/no book ids/);
  });

  it('a job from before the row-first submit is inserted, with its books from the caller', () => {
    const p = planAdoption({ jobId: 'old', geminiName: 'batches/y', stage: 'index', bookIds: ['a'], jobRow: null, stateRows, now });
    expect(p.refuse).toBeNull();
    expect(p.job.upsert).toBe(true);
    expect(p.job.update.$setOnInsert).toMatchObject({ _id: 'old', stage: 'index', book_ids: ['a'] });
    expect(p.adopted).toEqual(['a']);
    expect(p.leftParked).toEqual(['b', 'p1', 'p2']);
  });
});
