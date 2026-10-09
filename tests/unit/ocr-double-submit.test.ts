/**
 * Regression for #5498: the same OCR page set submitted twice, 35 s apart, and paid twice.
 *
 * 2026-10-01T01:50:13Z and 01:50:48Z, one 250-page pool, two `saved` batch jobs. The first came
 * from the main orchestrator loop's Phase 1.5 (pipeline.log), the second from the
 * `pipeline-preview-ocr` worker (`--phase 1.5`, preview-ocr.log), which the scheduler spawned at
 * 01:50:02 under a DIFFERENT flock lock. Both selected the same candidates and both passed the
 * pooler's only guard — "no pending batch_jobs row for this book" — because that row is written
 * only after the ~30 s download + upload.
 *
 * `submitter()` below replays the pooler's order of operations against an in-process store whose
 * single operations run to completion without yielding (Mongo's per-document atomicity). The
 * `await tick()` between check and insert is the download/upload window.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  ACTIVE_OCR_JOB_STATUSES,
  claimBookForOcrSubmit,
  releaseOcrSubmitClaims,
  loadOcrPagesInFlight,
  partitionGuardedPages,
  describeSkips,
} from '../../scripts/lib/ocr-submit-guard.mjs';

// ── a store just large enough for the queries the guard issues ──
type Doc = Record<string, any>;
const get = (d: Doc, p: string) => p.split('.').reduce((v: any, k) => (v == null ? undefined : v[k]), d);
function matches(d: Doc, q: Doc): boolean {
  return Object.entries(q).every(([k, c]) => {
    if (k === '$or') return (c as Doc[]).some((x) => matches(d, x));
    if (k === '$and') return (c as Doc[]).every((x) => matches(d, x));
    const v = get(d, k);
    if (c === null) return v == null;
    if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
      return Object.entries(c).every(([op, a]: [string, any]) => {
        if (op === '$exists') return a ? v !== undefined : v === undefined;
        if (op === '$lt') return v != null && v < a;
        if (op === '$gte') return v != null && v >= a;
        if (op === '$in') return Array.isArray(v) ? v.some((x) => a.includes(x)) : a.includes(v);
        throw new Error(`op ${op}`);
      });
    }
    return Array.isArray(v) ? v.includes(c) : v === c;
  });
}
function setPath(d: Doc, p: string, val: any) {
  const ks = p.split('.'); let o = d;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks.at(-1)!] = val;
}
function unsetPath(d: Doc, p: string) {
  const ks = p.split('.'); const o = get(d, ks.slice(0, -1).join('.')) ?? d;
  delete o[ks.at(-1)!];
}
function apply(d: Doc, u: Doc) {
  for (const [p, v] of Object.entries(u.$set || {})) setPath(d, p, v);
  for (const p of Object.keys(u.$unset || {})) unsetPath(d, p);
}
function fakeDb() {
  const cols: Record<string, Doc[]> = { books: [], batch_jobs: [] };
  const col = (n: string) => ({
    docs: (cols[n] ??= []),
    async updateOne(q: Doc, u: Doc) {
      const d = cols[n].find((x) => matches(x, q));
      if (d) apply(d, u);
      return { matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 };
    },
    async updateMany(q: Doc, u: Doc) {
      const ds = cols[n].filter((x) => matches(x, q)); ds.forEach((d) => apply(d, u));
      return { matchedCount: ds.length, modifiedCount: ds.length };
    },
    async findOne(q: Doc) { return cols[n].find((x) => matches(x, q)) ?? null; },
    find(q: Doc) { return { toArray: async () => cols[n].filter((x) => matches(x, q)) }; },
    async countDocuments(q: Doc) { return cols[n].filter((x) => matches(x, q)).length; },
    async insertOne(d: Doc) { cols[n].push(d); },
  });
  return { collection: col, cols };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

const BOOKS = ['b1', 'b2', 'b3'];
const PAGES: Record<string, string[]> = { b1: ['p1', 'p2'], b2: ['p3', 'p4'], b3: ['p5'] };

function seed() {
  const db = fakeDb();
  for (const id of BOOKS) db.cols.books.push({ id, pipeline_auto: { status: 'archive_complete' } });
  return db;
}

/** The pooler's sequence: [lease] -> active-batch check -> [page guard] -> (download/upload) -> insert -> [release]. */
async function submitter(db: any, owner: string, { guarded }: { guarded: boolean }) {
  const claimed: string[] = [];
  try {
    const eligible: string[] = [];
    for (const id of BOOKS) {
      if (guarded) {
        if (!(await claimBookForOcrSubmit(db, id, { owner })).ok) continue;
        claimed.push(id);
      }
      const active = await db.collection('batch_jobs').countDocuments({
        $or: [{ book_id: id }, { book_ids: id }], type: 'ocr', status: { $in: ACTIVE_OCR_JOB_STATUSES },
      });
      if (active === 0) eligible.push(id);
    }
    if (!eligible.length) return null;
    const inFlight = guarded ? await loadOcrPagesInFlight(db, eligible) : new Map();
    const pages = eligible.flatMap((b) => PAGES[b].map((id) => ({ id })));
    const { keep } = partitionGuardedPages(pages, inFlight);
    if (!keep.length) return null;
    await tick(); // download 250 images + upload a ~108 MB JSONL + create the batch
    const job = { id: `job-${owner}`, type: 'ocr', status: 'pending', book_id: eligible[0], book_ids: eligible, page_ids: keep.map((p) => p.id), submitted_by: owner, created_at: new Date() };
    await db.collection('batch_jobs').insertOne(job);
    return job;
  } finally {
    if (guarded) await releaseOcrSubmitClaims(db, claimed, { owner });
  }
}

function pagesPaidTwice(db: any) {
  const seen = new Map<string, number>();
  for (const j of db.cols.batch_jobs) for (const p of j.page_ids) seen.set(p, (seen.get(p) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([p]) => p);
}

describe('#5498 double submission', () => {
  it('reproduces: two concurrent Phase 1.5 runs without the lease both pay for the same pool', async () => {
    const db = seed();
    await Promise.all([submitter(db, 'main', { guarded: false }), submitter(db, 'phase-1.5', { guarded: false })]);
    expect(db.cols.batch_jobs).toHaveLength(2);
    expect(pagesPaidTwice(db).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('with the lease, the same race submits each page once', async () => {
    const db = seed();
    const [a, b] = await Promise.all([submitter(db, 'main', { guarded: true }), submitter(db, 'phase-1.5', { guarded: true })]);
    expect(db.cols.batch_jobs).toHaveLength(1);
    expect(pagesPaidTwice(db)).toEqual([]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    // Leases are released, so the book is not stranded.
    expect(db.cols.books.every((d: Doc) => d.pipeline_auto.ocr_submit_claim === undefined)).toBe(true);
  });

  it('a later run does not resubmit pages of a job that is still pending', async () => {
    const db = seed();
    await submitter(db, 'main', { guarded: true });
    expect(await submitter(db, 'phase-1.5', { guarded: true })).toBeNull();
    expect(db.cols.batch_jobs).toHaveLength(1);
  });
});

describe('page-level guard', () => {
  const now = new Date('2026-10-01T02:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600e3);

  it('refuses pages in a live job or one saved within the window, with a reason', async () => {
    const db = seed();
    db.cols.batch_jobs.push(
      { id: 'live', type: 'ocr', status: 'pending', book_id: 'x', book_ids: ['b1'], page_ids: ['p1'], created_at: ago(1) },
      { id: 'fresh', type: 'ocr', status: 'saved', book_id: 'b2', page_ids: ['p3'], created_at: ago(2) },
      { id: 'old', type: 'ocr', status: 'saved', book_id: 'b2', page_ids: ['p4'], created_at: ago(30) },
      { id: 'dead', type: 'ocr', status: 'failed', book_id: 'b3', page_ids: ['p5'], created_at: ago(1) },
    );
    const inFlight = await loadOcrPagesInFlight(db, BOOKS, { now, savedHours: 6 });
    const pages = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id }));
    const { keep, skipped } = partitionGuardedPages(pages, inFlight);
    expect(keep.map((p) => p.id)).toEqual(['p2', 'p4', 'p5']); // terminal failure and old saves are retryable
    expect(skipped).toEqual([
      { page_id: 'p1', reason: 'in_flight', job_id: 'live', status: 'pending' },
      { page_id: 'p3', reason: 'saved_recently', job_id: 'fresh', status: 'saved' },
    ]);
    expect(describeSkips(skipped)).toMatch(/2 pages refused \(1 in_flight, 1 saved_recently\)/);
  });

  it('force submits anyway but still reports what it overrode', () => {
    const inFlight = new Map([['p1', { job_id: 'live', status: 'pending', created_at: now }]]);
    const { keep, skipped } = partitionGuardedPages([{ id: 'p1' }], inFlight, { force: true });
    expect(keep).toHaveLength(1);
    expect(skipped[0].reason).toBe('in_flight_forced');
  });
});

describe('lease', () => {
  it('is exclusive, re-entrant for its owner, and stealable only once expired', async () => {
    const db = seed();
    const t0 = new Date('2026-10-01T01:50:00Z');
    expect((await claimBookForOcrSubmit(db, 'b1', { owner: 'A', now: t0 })).ok).toBe(true);
    expect((await claimBookForOcrSubmit(db, 'b1', { owner: 'A', now: t0 })).ok).toBe(true);
    const refused = await claimBookForOcrSubmit(db, 'b1', { owner: 'B', now: t0 });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/held by A/);
    const later = new Date(t0.getTime() + 31 * 60e3);
    expect((await claimBookForOcrSubmit(db, 'b1', { owner: 'B', now: later })).ok).toBe(true);
    // A's late release must not drop B's lease.
    expect(await releaseOcrSubmitClaims(db, ['b1'], { owner: 'A' })).toBe(0);
    expect(db.cols.books[0].pipeline_auto.ocr_submit_claim.owner).toBe('B');
  });
});

describe('the orchestrator wires the guard into both submit paths', () => {
  const orch = readFileSync(path.join(__dirname, '..', '..', 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
  const fn = (name: string) => {
    const start = orch.indexOf(`async function ${name}(`);
    expect(start, name).toBeGreaterThan(0);
    return orch.slice(start, orch.indexOf('\nasync function ', start + 10));
  };

  it('pooler: lease before the active-batch check, page guard, release in finally', () => {
    // The outer function owns the leases' release; the work runs under them in the inner one.
    expect(fn('submitCrossBookOcrBatches')).toMatch(/submitCrossBookOcrBatchesUnderLease\([\s\S]*finally \{[\s\S]*releaseOcrSubmitClaims\(db, claimed/);
    const body = fn('submitCrossBookOcrBatchesUnderLease');
    const lease = body.indexOf('claimBookForOcrSubmit(');
    expect(lease).toBeGreaterThan(0);
    expect(lease).toBeLessThan(body.indexOf("collection('batch_jobs').countDocuments"));
    expect(body).toContain('claimed.push(book.id)');
    expect(body).toContain('partitionGuardedPages(pages, pagesInFlight)');
  });

  it('per-book path: leased, checks book_ids too, and a fully-refused book is NOT alreadyDone', () => {
    expect(fn('submitOcrDirectly')).toMatch(/claimBookForOcrSubmit[\s\S]*finally \{[\s\S]*releaseOcrSubmitClaims/);
    const inner = fn('submitOcrDirectlyUnderLease');
    expect(inner).toContain('{ book_ids: book.id }');
    // alreadyDone advances the book to ocr_complete; a guard refusal must never take that branch.
    expect(inner).toMatch(/guarded\.keep\.length === 0\) \{\s*return \{[^}]*alreadyDone: false, skippedDuplicate: true/);
  });
});
