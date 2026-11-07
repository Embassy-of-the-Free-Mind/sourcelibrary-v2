/**
 * The GPU print lane releases ONLY the `gpu-print-6871` hold it placed (#6871, Derek 2026-10-31). A book that came in
 * under a scans-only hold, or carries any other decision's hold, keeps it whether or not the lane finished it.
 *
 * PRIOR ART: tests/unit/pipeline-hold.test.ts pins holdViolation and the hold's status rules (no release by reason);
 * tests/unit/gpu-print-lane.test.ts pins the lane's page verdicts. Neither runs releaseBook against documents, which is
 * the only way to pin the update filter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
import { holdBook, releaseBook, HOLD_STATUS } from '../../scripts/lib/pipeline-hold.mjs';
import { HOLD_REASON, HOLD_RELEASE, laneReleaseVerdict } from '../../scripts/lib/gpu-print-lane.mjs';

const OTHER = ['scans-only-publish-7270', 'recited-quran-ocr-7605', 'ia-wrong-leaf-4790'];
const plan = (placed: boolean, pns = [1, 2, 3]) => ({ placed_hold: placed, pages: pns.map((pn) => ({ pn })) });
const allDone = () => true;

async function heldFor(id: string, reason: string, from = 'archive_complete') {
  const db = getTestDb();
  await db.collection('books').insertOne({ id, title: id, pipeline_auto: { status: from } });
  const r = await holdBook(db, id, { reason, issue: 1, release: reason === HOLD_REASON ? HOLD_RELEASE : 'test', release_when: { kind: 'issue', ref: 1 } });
  expect(r.outcome).toBe('held');
}

describe('gpu-print lane release (#6871)', () => {
  beforeEach(async () => { await cleanDb(); });

  it('releases a hold the lane placed, back to the status it was held from', async () => {
    await heldFor('lane', HOLD_REASON, 'complete');
    const r = await releaseBook(getTestDb(), 'lane', { reason: HOLD_REASON, source: 'test' });
    expect(r).toMatchObject({ outcome: 'released', to: 'complete' });
    const b = await getTestDb().collection('books').findOne({ id: 'lane' });
    expect(b?.pipeline_auto).toMatchObject({ status: 'complete' });
    expect(b?.pipeline_auto.hold).toBeUndefined();
  });

  it('NEVER lifts a hold placed for another reason (negative control)', async () => {
    for (const reason of OTHER) {
      await heldFor(reason, reason);
      const r = await releaseBook(getTestDb(), reason, { reason: HOLD_REASON, source: 'test' });
      expect(r.outcome).toBe('held_other_reason');
      const b = await getTestDb().collection('books').findOne({ id: reason });
      expect(b?.pipeline_auto).toMatchObject({ status: HOLD_STATUS, hold: { reason } });
    }
    expect(await getTestDb().collection('book_events').countDocuments({ type: 'pipeline_release' })).toBe(0);
  });

  it('the write itself carries the reason: a hold swapped in after the read is not lifted', async () => {
    await heldFor('swap', HOLD_REASON);
    const db = getTestDb();
    // Another decision's hold replaces the lane's between releaseBook's read and its write.
    const books = db.collection('books');
    const realFindOne = books.findOne.bind(books);
    const proxy = new Proxy(db, { get: (t, k) => (k === 'collection' ? (n: string) => {
      const c = t.collection(n);
      if (n !== 'books') return c;
      return new Proxy(c, { get: (ct, ck) => (ck === 'findOne' ? async (...a: unknown[]) => {
        const doc = await (realFindOne as (...x: unknown[]) => Promise<unknown>)(...a);
        await books.updateOne({ id: 'swap' }, { $set: { 'pipeline_auto.hold.reason': 'scans-only-publish-7270' } });
        return doc;
      } : (ct as any)[ck]?.bind?.(ct) ?? (ct as any)[ck]) });
    } : (t as any)[k]) });
    const r = await releaseBook(proxy as any, 'swap', { reason: HOLD_REASON, source: 'test' });
    expect(r.outcome).toBe('not_held');
    expect((await books.findOne({ id: 'swap' }))?.pipeline_auto).toMatchObject({ status: HOLD_STATUS, hold: { reason: 'scans-only-publish-7270' } });
  });

  it('the lane verdict: only a hold it placed, only its own reason, only when every planned page is done', () => {
    expect(laneReleaseVerdict(plan(true), { reason: HOLD_REASON }, allDone)).toMatchObject({ release: true, why: 'finished' });
    // a scans-only book the lane wrote under its existing hold: placed_hold is false, the hold stays
    expect(laneReleaseVerdict(plan(false), { reason: HOLD_REASON }, allDone)).toMatchObject({ release: false, why: 'hold_not_placed_by_lane' });
    expect(laneReleaseVerdict({ pages: [{ pn: 1 }] }, { reason: HOLD_REASON }, allDone)).toMatchObject({ release: false });
    for (const reason of OTHER) expect(laneReleaseVerdict(plan(true), { reason }, allDone)).toMatchObject({ release: false, why: `held_other_reason:${reason}` });
    expect(laneReleaseVerdict(plan(true), null, allDone)).toMatchObject({ release: false, why: 'not_held' });
    expect(laneReleaseVerdict(plan(true), { reason: HOLD_REASON }, (pn) => pn !== 2)).toMatchObject({ release: false, why: 'pages_outstanding', outstanding: 1 });
    expect(laneReleaseVerdict(plan(true), { reason: HOLD_REASON }, (pn) => pn !== 2, { abandon: true })).toMatchObject({ release: true, why: 'abandoned', outstanding: 1 });
    // --abandon never widens WHOSE hold is released
    expect(laneReleaseVerdict(plan(true), { reason: OTHER[0] }, allDone, { abandon: true })).toMatchObject({ release: false });
  });
});
