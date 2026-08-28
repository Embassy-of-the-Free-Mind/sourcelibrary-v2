import { NextResponse } from 'next/server';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import {
  applyWorkMerge,
  finalizeIdentityBatch,
  pickWorkWinner,
  rejectWorkMerge,
  type BatchMarker,
  type WorkMergeResult,
} from '@/lib/identity-review-apply';

export const maxDuration = 60;

/**
 * Batch lane for `work_merge_queue` (#4271).
 *
 * The queue accumulated 1,940 pending pairs and drained at one row per click;
 * the LLM screen (`scripts/analysis/stamp-work-merge-queue-llm.mjs`) had
 * already sorted 980 of them into `same` and 745 into `different` weeks
 * earlier. This route lets a human clear a verdict slice in one sitting
 * WITHOUT changing what a single approval does:
 *
 *   - GET  builds the MANIFEST — every row the run would touch, with the
 *     winner/loser it would pick and the live count of books it would move.
 *     Nothing is written. This is the list-first-approve step (Data
 *     Protection rule: never batch-write without showing what will be
 *     touched), and it is the only place the full set is enumerable.
 *   - POST executes ONE CHUNK of that manifest, calling the exact same
 *     `applyWorkMerge` / `rejectWorkMerge` the single-row endpoint calls.
 *     The client loops chunks so it can show progress and abort mid-run.
 *     Actuation stays inline — no row is left for a background job to read.
 *   - POST { action: 'finalize' } revalidates the deduped path set once at
 *     the end instead of ~2,000 times.
 *
 * Measured 2026-08-28, and the reason the manifest reports `willBeStale`:
 * 763 of the 1,588 work ids the 980 `same` rows reference are carried by NO
 * book any more, and none of them appear in `work_id_aliases` — so they were
 * not merged away; the `local:n:<author>:<normalized-title>` mint moved under
 * them when a title or author was repaired. 717 of the 980 pairs are
 * therefore unmergeable and approving them writes `stale`, not a merge. The
 * real merge work in that slice is ~263 pairs moving ~277 books. Say so in
 * the manifest rather than promising 980 merges.
 *
 * Two guards make the endpoint refuse to be a silent bulk-merge API:
 *   1. every id in a chunk must still be `pending` AND still carry the
 *      `verdict` the run declared — an approve-all-`same` run physically
 *      cannot touch a `different` row, even if the client sends one;
 *   2. `approve` requires a declared spot-check, and is refused when the
 *      human flagged a fifth or more of the sample (that says the screen is
 *      unreliable on this slice, not that 20 rows need skipping).
 */

const CHUNK_MAX = { approve: 25, reject: 100 } as const;
/** How many pairs the human must eyeball before an approve-all run. */
const SPOT_CHECK_SIZE = 20;
/** Flagging this share of the sample means the screen is wrong, not the rows. */
const SPOT_CHECK_ABORT_RATIO = 0.2;
/** Ceiling on the manifest — well past the 980 `same` rows, but not unbounded. */
const MANIFEST_MAX = 3000;

const VERDICTS = ['same', 'different', 'unsure', 'none'];

function verdictFilter(verdict: string): Record<string, unknown> {
  return verdict === 'none' ? { llm: { $exists: false } } : { 'llm.verdict': verdict };
}

/** Deterministic sample so a reload shows the reviewer the same 20 pairs. */
function sample<T>(arr: T[], n: number, seed: string): T[] {
  if (arr.length <= n) return [...arr];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const picked = new Set<number>();
  const out: T[] = [];
  let x = Math.abs(h) || 1;
  while (out.length < n) {
    x = (Math.imul(1103515245, x) + 12345) & 0x7fffffff;
    const i = x % arr.length;
    if (picked.has(i)) continue;
    picked.add(i);
    out.push(arr[i]);
  }
  return out;
}

/**
 * GET /api/admin/work-merges/batch?verdict=same&bph=1
 * The manifest. Read-only: nothing here writes.
 */
export const GET = withInnerCircleAuth(async (request) => {
  const url = new URL(request.url);
  const verdict = url.searchParams.get('verdict') || '';
  const bphOnly = url.searchParams.get('bph') === '1';
  if (!VERDICTS.includes(verdict)) {
    return NextResponse.json({ error: `verdict must be one of ${VERDICTS.join('|')}` }, { status: 400 });
  }

  const db = await getDb();
  const filter: Record<string, unknown> = { status: 'pending', ...verdictFilter(verdict) };

  if (bphOnly) {
    const bphWids = await db.collection('books').distinct('work_id', {
      $or: [{ held_by: 'bph' }, { 'image_source.provider': 'bph' }],
      work_id: { $exists: true, $nin: [null, ''] },
    });
    filter.$or = [{ a: { $in: bphWids } }, { b: { $in: bphWids } }];
  }

  const queue = db.collection('work_merge_queue');
  const total = await queue.countDocuments(filter);
  const rows = await queue.find(filter).sort({ 'evidence.author': 1, _id: 1 }).limit(MANIFEST_MAX).toArray();

  // Live book counts per side — the frozen `evidence` strings on the row are
  // display-order-unstable and can go stale, and the winner depends on which
  // side actually holds more books RIGHT NOW.
  const workIds = [...new Set(rows.flatMap((r) => [r.a as string, r.b as string]))];
  const counts = new Map<string, number>();
  if (workIds.length) {
    const agg = await db.collection('books').aggregate([
      { $match: { work_id: { $in: workIds } } },
      { $group: { _id: '$work_id', n: { $sum: 1 } } },
    ]).toArray();
    for (const c of agg) counts.set(c._id as string, c.n as number);
  }

  const manifest = rows.map((r) => {
    const a = r.a as string;
    const b = r.b as string;
    const nA = counts.get(a) || 0;
    const nB = counts.get(b) || 0;
    const winner = pickWorkWinner(a, b, nA, nB);
    const loser = winner === a ? b : a;
    return {
      id: String(r._id),
      author: (r.evidence?.author as string) || '',
      titleA: (r.evidence?.titleA as string) || '',
      titleB: (r.evidence?.titleB as string) || '',
      a, b, nA, nB,
      winner,
      loser,
      // Zero on either side means the pair is already resolved; approving it
      // marks it `stale` rather than merging. Surfaced so the count the human
      // sees ("N books will move") is honest.
      booksToMove: winner === a ? nB : nA,
      willBeStale: nA === 0 || nB === 0,
      llmReason: (r.llm?.reason as string) || '',
    };
  });

  const actionable = manifest.filter((m) => !m.willBeStale);
  return NextResponse.json({
    verdict,
    total,
    capped: total > MANIFEST_MAX,
    manifest,
    booksAffected: actionable.reduce((s, m) => s + m.booksToMove, 0),
    staleCount: manifest.length - actionable.length,
    spotCheckIds: sample(manifest, SPOT_CHECK_SIZE, verdict).map((m) => m.id),
    spotCheckSize: Math.min(SPOT_CHECK_SIZE, manifest.length),
  });
});

interface BatchBody {
  action?: 'approve' | 'reject' | 'finalize';
  verdict?: string;
  ids?: string[];
  note?: string;
  runId?: string;
  paths?: string[];
  spotCheck?: { reviewed?: number; flagged?: number; of?: number };
}

/**
 * POST /api/admin/work-merges/batch
 *   { action: 'approve'|'reject', verdict, ids: [...], runId, spotCheck }
 *   { action: 'finalize', paths: [...] }
 */
export const POST = withInnerCircleAuth(async (request, session) => {
  const body = (await request.json()) as BatchBody;
  const { action } = body;

  if (action === 'finalize') {
    const res = await finalizeIdentityBatch(body.paths || []);
    return NextResponse.json(res);
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: "action must be approve|reject|finalize" }, { status: 400 });
  }
  const verdict = body.verdict || '';
  if (!VERDICTS.includes(verdict)) {
    return NextResponse.json({ error: `verdict must be one of ${VERDICTS.join('|')}` }, { status: 400 });
  }
  const ids = (body.ids || []).filter((x) => typeof x === 'string' && x.length > 0);
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  if (ids.length > CHUNK_MAX[action]) {
    return NextResponse.json({ error: `at most ${CHUNK_MAX[action]} ids per ${action} chunk` }, { status: 400 });
  }
  const runId = typeof body.runId === 'string' && body.runId ? body.runId.slice(0, 64) : null;
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  // Spot-check gate. Only `approve` actuates, so only `approve` demands it.
  const sc = body.spotCheck || {};
  if (action === 'approve') {
    const of = Number(sc.of) || 0;
    const reviewed = Number(sc.reviewed) || 0;
    const flagged = Number(sc.flagged) || 0;
    if (of === 0 || reviewed < of) {
      return NextResponse.json({ error: 'spot check incomplete — review every sampled pair before approving' }, { status: 400 });
    }
    if (of > 0 && flagged / of >= SPOT_CHECK_ABORT_RATIO) {
      return NextResponse.json({
        error: `${flagged}/${of} sampled pairs were flagged — the LLM screen is unreliable on this slice; review it by hand instead of batching`,
      }, { status: 409 });
    }
  }

  const db = await getDb();
  const queue = db.collection('work_merge_queue');
  const reviewer = session.user?.email || 'admin';
  const batch: BatchMarker = {
    run_id: runId,
    kind: action === 'approve' ? `approve-all-${verdict}` : `reject-all-${verdict}`,
    spot_check: action === 'approve'
      ? { reviewed: Number(sc.reviewed) || 0, flagged: Number(sc.flagged) || 0, of: Number(sc.of) || 0 }
      : undefined,
  };

  // Re-read under the run's declared verdict. A chunk cannot touch a row that
  // drifted out of the slice (another reviewer took it) or that never carried
  // the verdict this run is for.
  const rows = await queue.find({ _id: { $in: ids as never[] }, status: 'pending', ...verdictFilter(verdict) }).toArray();
  const found = new Set(rows.map((r) => String(r._id)));

  const results: WorkMergeResult[] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ id, status: 'error' as const, message: 'no longer pending in this verdict slice' }));

  const now = new Date();
  for (const row of rows) {
    try {
      const res = action === 'approve'
        ? await applyWorkMerge(db, row, { note: body.note, reviewer, now, batch })
        : await rejectWorkMerge(db, String(row._id), { note: body.note, reviewer, now, batch });
      results.push(res);
    } catch (err) {
      results.push({ id: String(row._id), status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const paths = [...new Set(results.flatMap((r) => r.paths || []))];
  const tally = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  return NextResponse.json({ results, tally, paths });
});
