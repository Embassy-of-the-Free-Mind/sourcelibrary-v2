import { NextResponse } from 'next/server';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import {
  applyKeeperChoice,
  finalizeIdentityBatch,
  type BatchMarker,
  type KeeperResult,
} from '@/lib/identity-review-apply';

export const maxDuration = 60;

/**
 * Batch lane for `edition_keeper_queue` (#4271) — narrower than the work-merge
 * lane on purpose.
 *
 * Keeping a cluster is a VISIBILITY FLIP: the other members go
 * `hidden_reason: 'duplicate'` and stop being readable. That is a different
 * risk class from a work merge (which only re-labels and leaves a redirect),
 * so only ONE bucket is batchable here:
 *
 *   MECHANICAL_KEEP, with `ft_flag` false.
 *
 * MECHANICAL_KEEP is the triage bucket where one member dominates on every
 * axis, so `keeper_suggested` is not a judgement call. `ft_flag` clusters are
 * excluded even inside that bucket: hiding a First-Translation-badged copy
 * changes what FT counting sees, and the single-row UI already stops for a
 * confirm on those. TOSSUP, SUSPECT_NOT_SAME, SCORED_KEEP and every
 * FT-flagged cluster stay per-cluster manual.
 *
 * Measured 2026-08-28: 89 pending MECHANICAL_KEEP clusters, of which 25 carry
 * `ft_flag: true` — so this lane offers 64, not the 89 the issue quotes. Of
 * those 64, ZERO have a non-keeper that is still visible: all 69 non-keepers
 * already carry `hidden_reason: 'same_edition_duplicate'`, which is what
 * `apply-keeper-choice-triage.mjs` writes. The script lane applied these and
 * never marked the queue rows, so "311 pending, zero worked" overstates the
 * outstanding work. `willHide` is therefore computed LIVE, not from the
 * 2026-08-09 snapshot, so the number the human approves is the real one.
 *
 * Shape is otherwise the work-merge lane's: GET manifest (read-only,
 * list-first), POST chunk (inline actuation through the same
 * `applyKeeperChoice` the single-row endpoint calls), POST finalize.
 */

const BATCHABLE_BUCKET = 'MECHANICAL_KEEP';
const CHUNK_MAX = 25;
const SPOT_CHECK_SIZE = 20;
const SPOT_CHECK_ABORT_RATIO = 0.2;
const MANIFEST_MAX = 1000;

/** Only clusters where the choice is mechanical AND no FT badge is at stake. */
function batchableFilter(): Record<string, unknown> {
  return { status: 'pending', bucket: BATCHABLE_BUCKET, ft_flag: { $ne: true } };
}

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

/** GET /api/admin/edition-keepers/batch — the manifest. Read-only. */
export const GET = withInnerCircleAuth(async () => {
  const db = await getDb();
  const queue = db.collection('edition_keeper_queue');
  const filter = batchableFilter();

  const [total, ftExcluded, rows] = await Promise.all([
    queue.countDocuments(filter),
    queue.countDocuments({ status: 'pending', bucket: BATCHABLE_BUCKET, ft_flag: true }),
    queue.find(filter).sort({ _id: 1 }).limit(MANIFEST_MAX).toArray(),
  ]);

  // Live visibility — the triage snapshot is from 2026-08-09 and a member may
  // already have been hidden by another lane. "Hides N" must be a live number.
  const memberIds = [...new Set(rows.flatMap((r) => ((r.members as { id: string }[]) || []).map((m) => m.id)))];
  const books = memberIds.length
    ? await db.collection('books').find(
        { id: { $in: memberIds } },
        { projection: { _id: 0, id: 1, title: 1, author: 1, visible: 1, is_first_translation: 1, pages_count: 1 } },
      ).toArray()
    : [];
  const byId = new Map(books.map((b) => [b.id as string, b]));

  const manifest = rows.map((r) => {
    const members = ((r.members as { id: string; quality?: number }[]) || []);
    const keeper = (r.keeper_suggested as string) || '';
    const others = members.filter((m) => m.id !== keeper);
    const keeperLive = byId.get(keeper);
    return {
      editionKey: String(r._id),
      keeper,
      keeperTitle: (keeperLive?.title as string) || '',
      keeperAuthor: (keeperLive?.author as string) || '',
      keeperFound: !!keeperLive,
      keeperVisible: keeperLive?.visible === true,
      nMembers: members.length,
      // Live count of members that would actually flip (already-hidden ones
      // are a no-op, so promising "hides 2" when one is already hidden lies).
      willHide: others.filter((m) => byId.get(m.id)?.visible === true).length,
      // A live FT badge anywhere in the cluster that the 08-09 snapshot missed.
      liveFtInCluster: members.some((m) => byId.get(m.id)?.is_first_translation === true),
      pageRatio: (r.page_ratio as number) ?? null,
      others: others.map((m) => ({
        id: m.id,
        title: (byId.get(m.id)?.title as string) || '',
        visible: byId.get(m.id)?.visible === true,
      })),
    };
  });

  // Belt and braces: a cluster whose keeper vanished, or that grew a live FT
  // badge since the snapshot, is not mechanical any more — flag it out of the
  // batch rather than trusting a three-week-old classification.
  const isBlocked = (m: (typeof manifest)[number]) => !m.keeperFound || !m.keeper || m.liveFtInCluster;
  const blocked = manifest.filter(isBlocked);
  const eligible = manifest.filter((m) => !isBlocked(m));

  return NextResponse.json({
    bucket: BATCHABLE_BUCKET,
    total,
    capped: total > MANIFEST_MAX,
    ftExcluded,
    manifest: eligible,
    blocked,
    booksHidden: eligible.reduce((s, m) => s + m.willHide, 0),
    spotCheckIds: sample(eligible, SPOT_CHECK_SIZE, BATCHABLE_BUCKET).map((m) => m.editionKey),
    spotCheckSize: Math.min(SPOT_CHECK_SIZE, eligible.length),
  });
});

interface KeeperBatchBody {
  action?: 'keep' | 'finalize';
  editionKeys?: string[];
  note?: string;
  runId?: string;
  paths?: string[];
  spotCheck?: { reviewed?: number; flagged?: number; of?: number };
}

/**
 * POST /api/admin/edition-keepers/batch
 *   { action: 'keep', editionKeys: [...], runId, spotCheck }
 *   { action: 'finalize', paths: [...] }
 *
 * There is deliberately no batch `dismiss`: dismissing is the "leave
 * everything visible" outcome, which nobody needs to do 89 times, and a
 * bulk-dismiss button would quietly empty the queue without a decision.
 */
export const POST = withInnerCircleAuth(async (request, session) => {
  const body = (await request.json()) as KeeperBatchBody;

  if (body.action === 'finalize') {
    const res = await finalizeIdentityBatch(body.paths || []);
    return NextResponse.json(res);
  }
  if (body.action !== 'keep') {
    return NextResponse.json({ error: 'action must be keep|finalize' }, { status: 400 });
  }

  const keys = (body.editionKeys || []).filter((x) => typeof x === 'string' && x.length > 0);
  if (keys.length === 0) return NextResponse.json({ error: 'editionKeys required' }, { status: 400 });
  if (keys.length > CHUNK_MAX) {
    return NextResponse.json({ error: `at most ${CHUNK_MAX} clusters per chunk` }, { status: 400 });
  }
  const runId = typeof body.runId === 'string' && body.runId ? body.runId.slice(0, 64) : null;
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const sc = body.spotCheck || {};
  const of = Number(sc.of) || 0;
  const reviewed = Number(sc.reviewed) || 0;
  const flagged = Number(sc.flagged) || 0;
  if (of === 0 || reviewed < of) {
    return NextResponse.json({ error: 'spot check incomplete — review every sampled cluster before keeping' }, { status: 400 });
  }
  if (flagged / of >= SPOT_CHECK_ABORT_RATIO) {
    return NextResponse.json({
      error: `${flagged}/${of} sampled clusters were flagged — the MECHANICAL_KEEP classification is not holding; review these by hand`,
    }, { status: 409 });
  }

  const db = await getDb();
  const queue = db.collection('edition_keeper_queue');
  const reviewer = session.user?.email || 'admin';
  const batch: BatchMarker = {
    run_id: runId,
    kind: 'keeper-mechanical',
    spot_check: { reviewed, flagged, of },
  };

  // Re-read under the batchable filter: a chunk physically cannot touch a
  // TOSSUP, a SCORED_KEEP, an FT-flagged cluster, or one another reviewer
  // already adjudicated — even if the client sends its key.
  const rows = await queue.find({ _id: { $in: keys as never[] }, ...batchableFilter() }).toArray();
  const found = new Set(rows.map((r) => String(r._id)));

  const results: KeeperResult[] = keys
    .filter((k) => !found.has(k))
    .map((k) => ({ editionKey: k, status: 'error' as const, message: 'not a pending non-FT MECHANICAL_KEEP cluster' }));

  // Re-check the live FT badge at write time. The queue's `ft_flag` is a
  // 2026-08-09 snapshot; a badge awarded since then would otherwise be hidden
  // by a batch that believed the cluster was mechanical.
  const memberIds = [...new Set(rows.flatMap((r) => ((r.members as { id: string }[]) || []).map((m) => m.id)))];
  const ftLive = new Set(
    (memberIds.length
      ? await db.collection('books').find(
          { id: { $in: memberIds }, is_first_translation: true },
          { projection: { _id: 0, id: 1 } },
        ).toArray()
      : []
    ).map((b) => b.id as string),
  );

  const now = new Date();
  for (const row of rows) {
    const key = String(row._id);
    const members = ((row.members as { id: string }[]) || []).map((m) => m.id);
    if (members.some((m) => ftLive.has(m))) {
      results.push({ editionKey: key, status: 'error', message: 'a member holds a live First Translation badge — review this cluster by hand' });
      continue;
    }
    const keeperId = (row.keeper_suggested as string) || '';
    if (!keeperId || !members.includes(keeperId)) {
      results.push({ editionKey: key, status: 'error', message: 'no suggested keeper on this cluster' });
      continue;
    }
    try {
      results.push(await applyKeeperChoice(db, row, { keeperId, note: body.note, reviewer, now, batch }));
    } catch (err) {
      results.push({ editionKey: key, status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const paths = [...new Set(results.flatMap((r) => r.paths || []))];
  const tally = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  return NextResponse.json({ results, tally, paths });
});
