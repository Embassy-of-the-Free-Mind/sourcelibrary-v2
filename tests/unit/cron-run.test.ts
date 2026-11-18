/**
 * The run row the scheduler workers write (v3#428): the shape /admin/pipeline reads (src/lib/pipeline-line.ts
 * getLineInputs groups the last 24 h of cron_runs by `cron` on `timestamp`).
 */
import { describe, it, expect } from 'vitest';
import { cronRunRow, writeCronRun } from '../../scripts/lib/cron-run.mjs';

const now = new Date('2026-11-16T22:00:00Z');

describe('cronRunRow', () => {
  it('carries the timestamp the page reads, the duration, and the summary', () => {
    const r = cronRunRow({ cron: 'archive-ocr', start: now.getTime() - 80_812, status: 'partial', actions: { archived: 3, failed: 12 }, summary: 'pages 3 archived, 12 failed', now });
    expect(r).toMatchObject({
      cron: 'archive-ocr', timestamp: now, finished_at: now, duration_ms: 80_812, status: 'partial', failed: false,
      actions: { archived: 3, failed: 12 }, summary: 'pages 3 archived, 12 failed', error_count: 0,
    });
    expect(r.started_at).toEqual(new Date('2026-11-16T21:58:39.188Z'));
  });

  it('marks only a failed run as failed, and keeps a skip a skip', () => {
    expect(cronRunRow({ cron: 'x', start: now, status: 'failed', now }).failed).toBe(true);
    expect(cronRunRow({ cron: 'x', start: now, status: 'skipped', now })).toMatchObject({ status: 'skipped', failed: false, duration_ms: 0 });
  });

  it('refuses a row the page could not read', () => {
    expect(() => cronRunRow({ start: now, status: 'success' })).toThrow(/cron/);
    expect(() => cronRunRow({ cron: 'x', start: now, status: 'ok' })).toThrow(/status/);
  });

  it('caps the errors it stores and counts them all', () => {
    const r = cronRunRow({ cron: 'x', start: now, status: 'partial', errors: Array.from({ length: 30 }, (_, i) => `e${i}`), now });
    expect(r.errors).toHaveLength(20);
    expect(r.error_count).toBe(30);
  });
});

describe('writeCronRun', () => {
  it('inserts one row, and never throws when the write fails', async () => {
    const rows: unknown[] = [];
    const db = { collection: (name: string) => ({ insertOne: async (r: unknown) => { expect(name).toBe('cron_runs'); rows.push(r); } }) };
    await writeCronRun(db, { cron: 'display-backfill', start: now, status: 'success' });
    expect(rows).toHaveLength(1);
    const bad = { collection: () => ({ insertOne: async () => { throw new Error('socket closed'); } }) };
    await expect(writeCronRun(bad, { cron: 'display-backfill', start: now, status: 'success' })).resolves.toBeUndefined();
  });
});
