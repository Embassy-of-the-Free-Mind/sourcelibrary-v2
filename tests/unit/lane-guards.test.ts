/**
 * assertLaneGuards (#5480): observe mode — records a held book or an active pause in audit_log, returns
 * what it saw, never refuses and never throws.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { assertLaneGuards, LANE_GUARD_ACTION } from '@/lib/lane-guards';

function fakeDb({ held = [] as { id: string; reason: string }[], control = {} as Record<string, unknown>, pages = [] as { id: string; book_id: string }[], throwOn = '' }) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    collection(name: string) {
      if (name === throwOn) throw new Error('boom');
      return {
        find(q: Record<string, { $in: string[] }>) {
          const ids = q.id.$in;
          const out = name === 'pages'
            ? pages.filter((p) => ids.includes(p.id))
            : held.filter((b) => ids.includes(b.id)).map((b) => ({ id: b.id, pipeline_auto: { hold: { reason: b.reason, issue: 1 } } }));
          return { toArray: async () => out };
        },
        findOne: async () => control,
        insertOne: async (doc: Record<string, unknown>) => { inserted.push(doc); return { acknowledged: true }; },
      };
    },
  } as unknown as Db;
  return { db, inserted };
}

describe('assertLaneGuards', () => {
  it('records a held book, resolving pages to their book', async () => {
    const { db, inserted } = fakeDb({ held: [{ id: 'b1', reason: 'x' }], pages: [{ id: 'p1', book_id: 'b1' }] });
    const seen = await assertLaneGuards(db, { route: '/api/process', pageIds: ['p1'] });
    expect(seen.held).toEqual([{ id: 'b1', reason: 'x', issue: 1 }]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ action: LANE_GUARD_ACTION, route: '/api/process', mode: 'observe', held_count: 1 });
  });
  it('records an active pause even with no held book', async () => {
    const { db, inserted } = fakeDb({ control: { paused: true, paused_phases: [2] } });
    const seen = await assertLaneGuards(db, { route: '/api/scan/start-ocr', bookIds: ['b2'] });
    expect(seen).toMatchObject({ paused: true, pausedPhases: [2], held: [] });
    expect(inserted).toHaveLength(1);
  });
  it('writes nothing when the book is free and nothing is paused', async () => {
    const { db, inserted } = fakeDb({});
    await assertLaneGuards(db, { route: '/api/process', bookIds: ['b3'] });
    expect(inserted).toHaveLength(0);
  });
  it('never throws: an observer must not break the click', async () => {
    const { db } = fakeDb({ throwOn: 'books' });
    await expect(assertLaneGuards(db, { route: '/api/process', bookIds: ['b4'] })).resolves.toMatchObject({ held: [] });
  });
});
