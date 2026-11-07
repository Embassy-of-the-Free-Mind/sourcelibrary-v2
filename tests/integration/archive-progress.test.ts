/**
 * Archive progress per lane (#5448 step 6): pages/day from hourly snapshots, remaining counted from
 * page counters AND manifest ledgers, and an alarm that pages once for a lane quiet 6 h with work left.
 *
 * PRIOR ART: tests/unit/archiver-heartbeat.test.ts (a run's own per-minute rate; gone with the
 * process, and silent about a lane that is not running at all).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
import {
  measureByProvider, laneOfProvider, laneRates, quietLanes, alarmTransition, QUIET_HOURS,
} from '../../scripts/lib/archive-progress.mjs';

const TABLE = {
  lanes: [
    { name: 'sbb', box: 'l7a', providers: ['sbb'] },
    { name: 'e-rara', box: 'l7a', providers: ['e-rara', 'erara'] },
    { name: 'harvard', box: 'mac', providers: ['harvard'] },
  ],
};
const laneOf = laneOfProvider(TABLE);
const H = 3600e3;
const NOW = new Date(Date.UTC(2026, 9, 26, 12));
const snap = (hoursAgo: number, by_provider: Record<string, any>) => ({ at: new Date(NOW.getTime() - hoursAgo * H), by_provider });
const row = (archived: number, remaining: number) => ({ books: 1, pages: archived + remaining, archived, remaining, lazy_books: 0 });

describe('archive progress (#5448 step 6)', () => {
  beforeEach(async () => { await cleanDb(); });

  it('counts a materialized book by its counter and a manifest-only book by its ledger', async () => {
    await getTestDb().collection('books').insertMany([
      { id: 'a', pages_count: 100, pages_archived: 40, image_source: { provider: 'sbb' } },
      { id: 'b', pages_count: 50, pages_archived: 50, archive_status: 'archive_complete', image_source: { provider: 'sbb' } },
      // Lazy: pages_archived is 0 by design; the ledger says 30 of 60 canvases.
      { id: 'c', pages_count: 60, pages_archived: 0, pages_state: { state: 'manifest_only' }, archive_metadata: { manifest_ledger: { v: 1, canvases: 60, n_done: 30 } }, image_source: { provider: 'sbb' } },
      // Lazy with no ledger yet: owes every page.
      { id: 'd', pages_count: 20, pages_state: { state: 'manifest_only' }, image_source: { provider: 'sbb' } },
      // Complete with gaps owes nothing more.
      { id: 'e', pages_count: 10, pages_archived: 9, archive_status: 'archive_complete_with_gaps', image_source: { provider: 'erara' } },
      { id: 'f', pages_count: 0, image_source: { provider: 'sbb' } },
    ]);
    const m = await measureByProvider(getTestDb());
    expect(m.sbb).toEqual({ books: 4, pages: 230, archived: 120, remaining: 60 + 30 + 20, lazy_books: 2 });
    expect(m.erara.remaining).toBe(0);
  });

  it('pages/day and projected finish from snapshots; providers sum into their lane', () => {
    const snaps = [
      snap(24, { sbb: row(1000, 5000), erara: row(0, 900), 'e-rara': row(0, 100), bsb: row(10, 10) }),
      snap(6, { sbb: row(1500, 4500), erara: row(0, 900), 'e-rara': row(0, 100), bsb: row(10, 10) }),
      snap(0, { sbb: row(2000, 4000), erara: row(0, 900), 'e-rara': row(0, 100), bsb: row(10, 10) }),
    ];
    const r = laneRates(snaps, laneOf, { now: NOW });
    expect(r.sbb.per_day).toBe(1000);
    expect(r.sbb.added_6h).toBe(500);
    expect(r.sbb.finish).toBe('2026-10-30');            // 4,000 left at 1,000/day
    expect(r['e-rara'].remaining).toBe(1000);           // erara + e-rara
    expect(r['e-rara'].finish).toBeNull();              // no rate, no date
    expect(r['other:bsb']).toBeDefined();
  });

  it('a lane quiet for a full 6 h with work left is alarmed; a mac lane, a short window or no backlog is not', () => {
    const snaps = [
      snap(7, { sbb: row(100, 50), erara: row(5, 10), harvard: row(0, 9) }),
      snap(0, { sbb: row(100, 50), erara: row(9, 6), harvard: row(0, 9) }),
    ];
    const r = laneRates(snaps, laneOf, { now: NOW });
    expect(quietLanes(r, TABLE.lanes)).toEqual([{ lane: 'sbb', box: 'l7a', remaining: 50 }]);
    // Only 3 h of snapshots: not yet a 6 h silence.
    const short = laneRates([snap(3, { sbb: row(100, 50) }), snap(0, { sbb: row(100, 50) })], laneOf, { now: NOW });
    expect(quietLanes(short, TABLE.lanes)).toEqual([]);
    // Quiet but done: nothing owed, no alarm.
    const done = laneRates([snap(QUIET_HOURS + 1, { sbb: row(150, 0) }), snap(0, { sbb: row(150, 0) })], laneOf, { now: NOW });
    expect(quietLanes(done, TABLE.lanes)).toEqual([]);
  });

  it('pages ONCE per quiet spell, and says when the lane resumes', () => {
    const q = [{ lane: 'sbb', box: 'l7a', remaining: 50 }];
    const t1 = alarmTransition([], q);
    expect(t1.fresh.map(x => x.lane)).toEqual(['sbb']);
    const t2 = alarmTransition(t1.alarmed, q);
    expect(t2.fresh).toEqual([]);                       // still quiet: no second page
    const t3 = alarmTransition(t2.alarmed, []);
    expect(t3.resumed).toEqual(['sbb']);
    expect(t3.alarmed).toEqual([]);
  });
});
