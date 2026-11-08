/**
 * The page-order gate, pinned (#8068).
 *
 * A book stored back to front must be held before Phase 4 translates it; a book in order, or one an
 * eye has already released, must not be. The threshold (a descending run of 5+ markers) is what
 * separated the #5699 false positives (all exactly 4) from the confirmed reversals (all 5+), so a
 * 4-marker run is pinned as a pass.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { pageOrderGate, pageOrderVerdict, PAGE_ORDER_HOLD, PAGE_ORDER_HOLD_REASON, MIN_RUN } from '../../scripts/lib/page-order-gate.mjs';
// @ts-expect-error — scripts-side module, no types
import { releaseWhenProblem, RELEASE_EVENT } from '../../scripts/lib/pipeline-hold.mjs';

const page = (s: number, printed: number) => ({ id: `p${s}`, page_number: s, head: `<header>KITAB AL-LUMA ${printed}</header>\ntext`, tail: 'text' });
const ascending = Array.from({ length: 30 }, (_, i) => page(i + 1, i + 10));
const descending = Array.from({ length: 30 }, (_, i) => page(i + 1, 60 - i));

function fakeDb({ pages, released = false }: { pages: object[]; released?: boolean }) {
  const writes: { coll: string; op: string; args: unknown[] }[] = [];
  let pageReads = 0;
  const coll = (name: string) => ({
    findOne: async (q: Record<string, unknown>) => {
      if (name === 'book_events') return released && q.type === RELEASE_EVENT && q['details.reason'] === PAGE_ORDER_HOLD_REASON ? { _id: 1 } : null;
      if (name === 'books') return { id: 'b1', title: 'T', pipeline_auto: { status: 'ocr_complete' } };
      return null;
    },
    aggregate: () => ({ toArray: async () => { pageReads++; return pages.map((p) => ({ ...p })); } }),
    updateOne: async (...args: unknown[]) => { writes.push({ coll: name, op: 'updateOne', args }); return { modifiedCount: 1 }; },
    insertOne: async (...args: unknown[]) => { writes.push({ coll: name, op: 'insertOne', args }); return {}; },
  });
  return { db: { collection: coll }, writes, reads: () => pageReads };
}

describe('page-order gate (#8068)', () => {
  it('holds a book whose printed numbers descend, with a testable release condition', async () => {
    const f = fakeDb({ pages: descending });
    const r = await pageOrderGate(f.db, { id: 'b1', language: 'Arabic' });
    expect(r.outcome).toBe('held');
    const set = (f.writes.find((w) => w.coll === 'books')!.args[1] as { $set: Record<string, { reason?: string; release_when?: unknown }> }).$set;
    expect(set['pipeline_auto.status']).toBe('held');
    expect(set['pipeline_auto.hold'].reason).toBe(PAGE_ORDER_HOLD_REASON);
    expect(releaseWhenProblem(PAGE_ORDER_HOLD.release_when)).toBeNull();
    expect(PAGE_ORDER_HOLD.release).toMatch(/renumber-page-order\.mjs/);
  });
  it('passes a book in order and writes nothing', async () => {
    const f = fakeDb({ pages: ascending });
    expect((await pageOrderGate(f.db, { id: 'b1' })).outcome).toBe('pass');
    expect(f.writes).toHaveLength(0);
  });
  it('never re-holds a book an eye has released', async () => {
    const f = fakeDb({ pages: descending, released: true });
    expect((await pageOrderGate(f.db, { id: 'b1' })).outcome).toBe('released_before');
    expect(f.reads()).toBe(0);
    expect(f.writes).toHaveLength(0);
  });
  it('dry run says it would hold and writes nothing', async () => {
    const f = fakeDb({ pages: descending });
    expect((await pageOrderGate(f.db, { id: 'b1' }, { dryRun: true })).outcome).toBe('dry_run');
    expect(f.writes).toHaveLength(0);
  });
  it(`a descending run of ${MIN_RUN - 1} markers is not enough to hold`, () => {
    const short = [...ascending.slice(0, 10), page(11, 30), page(12, 29), page(13, 28), page(14, 27), ...Array.from({ length: 10 }, (_, i) => page(15 + i, 40 + i))];
    const v = pageOrderVerdict(short);
    expect(v.desc_runs.length).toBeGreaterThan(0);
    expect(v.hold).toBe(false);
    const long = [...ascending.slice(0, 10), page(11, 30), page(12, 29), page(13, 28), page(14, 27), page(15, 26), ...Array.from({ length: 10 }, (_, i) => page(16 + i, 40 + i))];
    expect(pageOrderVerdict(long).hold).toBe(true);
  });
});
