/* eslint-disable @typescript-eslint/no-explicit-any -- a fake Mongo is untyped by nature */
/**
 * translate-worker selfDispatch() candidates (#5429), by behaviour: which books the filter picks.
 * Realtime takes reader requests only (processing_priority ≥ REALTIME_PRIORITY_FLOOR, #5430's
 * LANE_FILTER) and never a book with an open translate_batch_runs run (OPEN_RUN_FILTER). The
 * worker runs main() on import, so its $match is rebuilt here from the same pieces, and a source
 * check pins that both candidate queries spread OPEN_RUN_FILTER.
 *
 * The negative control runs the pre-fix filter over the same books and shows it WOULD pick the
 * priority-50, unprioritised and open-run books — so a pass means the filter excludes them, not
 * that the fixture could never have produced them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { openRunBookIds, notInOpenRun } from '../../scripts/workers/lib/self-dispatch-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { phase4Lane, REALTIME_PRIORITY_FLOOR } from '../../scripts/lib/translate-batch-chained.mjs';

type Doc = Record<string, any>;

// A matcher for exactly the operators these filters use: $in, $nin, $gte, $ne, $or, $and.
function get(doc: Doc, p: string) {
  return p.split('.').reduce((v: any, k) => (v == null ? undefined : v[k]), doc);
}
function matchCond(val: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      if (op === '$in') return arg.includes(val);
      if (op === '$nin') return !arg.includes(val);
      if (op === '$gte') return typeof val === 'number' && val >= arg;
      if (op === '$ne') return val !== arg;
      throw new Error(`fake matcher: unsupported ${op}`);
    });
  }
  return val === cond;
}
function matches(doc: Doc, q: Doc): boolean {
  return Object.entries(q).every(([k, c]: [string, any]) => {
    if (k === '$or') return c.some((sub: Doc) => matches(doc, sub));
    if (k === '$and') return c.every((sub: Doc) => matches(doc, sub));
    return matchCond(get(doc, k), c);
  });
}
function fakeDb(collections: Record<string, Doc[]>) {
  return {
    collection: (name: string) => ({
      distinct: async (field: string, q: Doc) =>
        [...new Set((collections[name] || []).filter((d) => matches(d, q)).map((d) => get(d, field)))],
    }),
  };
}

const book = (id: string, extra: Doc = {}) => ({ id, pipeline_auto: { status: 'ocr_complete' }, ...extra });
const BOOKS = [
  book('low', { processing_priority: 50 }),
  book('none'),                                             // no priority at all: the common case
  book('reader', { processing_priority: 95 }),
  book('reader-in-run', { processing_priority: 95 }),       // a reader request already enrolled
  book('reader-done-run', { processing_priority: 95 }),     // its run finished: not blocking
  book('reader-unsplit', { processing_priority: 95, needs_splitting: true }),
];
const RUNS = [
  { book_id: 'reader-in-run', mode: 'chained', phase: 'round_submitted' },
  { book_id: 'reader-done-run', mode: 'chained', phase: 'complete' },
  { book_id: 'low', mode: 'chained', phase: 'round_ready' },
];
const db = fakeDb({ translate_batch_runs: RUNS });
const pick = (q: Doc) => BOOKS.filter((b) => matches(b, q)).map((b) => b.id);

// The worker's fresh-candidate $match, from the same pieces (LANE_FILTER as #5430 builds it).
const BASE = {
  'pipeline_auto.status': { $in: ['ocr_complete'] },
  $or: [{ needs_splitting: { $ne: true } }, { split_completed: true }],
};
async function workerMatch(env: Record<string, string> = {}, scopeFilter: Doc = {}) {
  const LANE_FILTER = phase4Lane({ processing_priority: 0 }, env) === 'chained'
    ? { processing_priority: { $gte: REALTIME_PRIORITY_FLOOR } }
    : {};
  return { ...BASE, ...scopeFilter, ...LANE_FILTER, ...notInOpenRun(await openRunBookIds(db)) };
}

describe('selfDispatch candidates (#5429)', () => {
  it('open runs: counts a non-terminal run, not a finished one', async () => {
    expect((await openRunBookIds(db)).sort()).toEqual(['low', 'reader-in-run']);
  });

  it('takes a priority-95 book; not priority 50, no priority, an open run, or an unsplit spread', async () => {
    expect(pick(await workerMatch()).sort()).toEqual(['reader', 'reader-done-run']);
  });

  it('negative control: the pre-fix filter picks the priority-50, unprioritised and open-run books', () => {
    expect(pick(BASE)).toEqual(expect.arrayContaining(['low', 'none', 'reader-in-run']));
  });

  it('PHASE4_TRANSLATE_LANE=realtime lifts the floor but still skips open runs', async () => {
    expect(pick(await workerMatch({ PHASE4_TRANSLATE_LANE: 'realtime' })).sort()).toEqual(['none', 'reader', 'reader-done-run']);
  });

  it('a selective-unpause scope filter confines without dropping the open-run exclusion', async () => {
    expect(pick(await workerMatch({}, { id: { $in: ['reader', 'reader-in-run', 'low'] } }))).toEqual(['reader']);
  });

  it('the worker spreads OPEN_RUN_FILTER into both candidate queries', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/workers/translate-worker.mjs'), 'utf8');
    const start = src.indexOf('async function selfDispatch(');
    const body = src.slice(start, src.indexOf('const dispatched = [];', start));
    expect(body).toMatch(/const OPEN_RUN_FILTER = notInOpenRun\(await openRunBookIds\(db\)\);/);
    expect(body.match(/\.\.\.OPEN_RUN_FILTER,/g)?.length).toBe(2);
  });
});
