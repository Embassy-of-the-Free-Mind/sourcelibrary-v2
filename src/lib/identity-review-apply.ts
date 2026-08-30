import { revalidatePath } from 'next/cache';
import type { Db, Document } from 'mongodb';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

/**
 * The write half of the identity-review surface (#3846, batched in #4271).
 *
 * These two functions ARE the write path. Both the one-row endpoints
 * (`/api/admin/work-merges`, `/api/admin/edition-keepers`) and the batch
 * endpoints call them, so a batch approval is literally N single approvals —
 * same aliases, same provenance doc, same revert payload, same `updated_at`
 * bump the Supabase catalog sync keys on. Nothing about "batch" may fork the
 * semantics; if a rule changes it changes here, for both lanes at once.
 *
 * Actuation stays inline (the #3726 Tier 3 shape): approving performs the
 * merge in the request, attributed to the signed-in human. No queue row is
 * left for a later job to consume — see the "writing to a store an automated
 * job reads is ACTUATION" rule in CLAUDE.md.
 */

/** Default winner for a work pair: a Wikidata QID beats a local mint; else the id holding more books. */
export function pickWorkWinner(
  aWorkId: string,
  bWorkId: string,
  nA: number,
  nB: number,
): string {
  const aQ = /^Q\d/.test(aWorkId);
  const bQ = /^Q\d/.test(bWorkId);
  if (aQ !== bQ) return aQ ? aWorkId : bWorkId;
  return nB > nA ? bWorkId : aWorkId;
}

/**
 * Marker stamped onto the per-row provenance so a batch run is reconstructable
 * after the fact ("which merges came from the 2026-08-28 approve-all-same
 * run, and what did the human spot-check?"). Deliberately a FIELD on the
 * existing `work_id_merges` / queue docs rather than a new collection — a new
 * shared collection is shared mutable state that another session can clobber.
 */
export interface BatchMarker {
  /** client-generated run id, stable across the chunks of one run */
  run_id: string;
  /** e.g. 'approve-all-same' | 'reject-all-different' | 'keeper-mechanical' */
  kind: string;
  /** how many pairs the human eyeballed, and how many they flagged */
  spot_check?: { reviewed: number; flagged: number; of: number };
}

export interface WorkMergeResult {
  id: string;
  status: 'approved' | 'stale' | 'rejected' | 'error';
  winner?: string;
  loser?: string;
  booksMoved?: number;
  message?: string;
  /** ISR paths this row's write invalidated. Callers dedupe across a batch. */
  paths?: string[];
}

/**
 * Apply one `work_merge_queue` approval: rewrite the loser's books onto the
 * winner, stamp `work_id_aliases` across the whole cluster so `/work/[id]`
 * 307s the retired id, and write the `work_id_merges` provenance doc that
 * carries the per-book revert payload.
 *
 * The row must already be verified `status: 'pending'` by the caller; the
 * status flip below is guarded on that so two concurrent reviewers cannot
 * both apply it.
 */
export async function applyWorkMerge(
  db: Db,
  row: Document,
  opts: { winner?: string; note?: string; reviewer: string; now?: Date; batch?: BatchMarker },
): Promise<WorkMergeResult> {
  const now = opts.now ?? new Date();
  const id = row._id as string;
  const a = row.a as string;
  const b = row.b as string;
  const queue = db.collection('work_merge_queue');
  const booksCol = db.collection('books');

  const cluster = await booksCol
    .find({ work_id: { $in: [a, b] } }, { projection: { _id: 0, id: 1, work_id: 1 } })
    .toArray();
  const nA = cluster.filter((x) => x.work_id === a).length;
  const nB = cluster.filter((x) => x.work_id === b).length;
  if (nA === 0 || nB === 0) {
    // One side has no books left — an earlier merge or repair already moved
    // them. Nothing to do; mark it so it leaves the pending lane.
    await queue.updateOne(
      { _id: id as never, status: 'pending' },
      { $set: { status: 'stale', reviewed_by: opts.reviewer, reviewed_at: now, updated_at: now } },
    );
    return { id, status: 'stale', message: `no books left on ${nA === 0 ? a : b}` };
  }

  const winner = opts.winner && (opts.winner === a || opts.winner === b)
    ? opts.winner
    : pickWorkWinner(a, b, nA, nB);
  const loser = winner === a ? b : a;

  // Revert path: the prior work_id of every rewritten book, kept in the
  // provenance doc (the maintenance script keeps the same payload in a backup
  // file; a request handler keeps it in the doc).
  const affected = cluster
    .filter((x) => x.work_id === loser)
    .map((x) => ({ book_id: x.id as string, old_work_id: loser }));

  const moved = await booksCol.updateMany(
    { work_id: loser },
    { $set: { work_id: winner, updated_at: now }, $addToSet: { work_id_aliases: loser } },
  );
  // Winner-side books carry the alias too: the redirect describes the WORK,
  // so every edition under it must resolve the retired id.
  await booksCol.updateMany(
    { work_id: winner, work_id_aliases: { $ne: loser } },
    { $set: { updated_at: now }, $addToSet: { work_id_aliases: loser } },
  );

  await db.collection('work_id_merges').insertOne({
    winner,
    losers: [loser],
    sources: ['queue:human'],
    books_rewritten: moved.modifiedCount,
    affected,
    resolver: 'human',
    reviewed_by: opts.reviewer,
    issue: 3846,
    applied_at: now,
    ...(opts.batch ? { batch: opts.batch } : {}),
  });

  await queue.updateOne(
    { _id: id as never },
    {
      $set: {
        status: 'approved',
        winner,
        note: opts.note || null,
        ...(opts.batch ? { batch: opts.batch } : {}),
        reviewed_by: opts.reviewer,
        reviewed_at: now,
        updated_at: now,
      },
    },
  );

  return {
    id,
    status: 'approved',
    winner,
    loser,
    booksMoved: moved.modifiedCount,
    paths: [`/work/${winner}`, `/work/${loser}`],
  };
}

/** Reject one pair: a status write only, no book is touched. */
export async function rejectWorkMerge(
  db: Db,
  id: string,
  opts: { note?: string; reviewer: string; now?: Date; batch?: BatchMarker },
): Promise<WorkMergeResult> {
  const now = opts.now ?? new Date();
  const res = await db.collection('work_merge_queue').updateOne(
    { _id: id as never, status: 'pending' },
    {
      $set: {
        status: 'rejected',
        note: opts.note || null,
        ...(opts.batch ? { batch: opts.batch } : {}),
        reviewed_by: opts.reviewer,
        reviewed_at: now,
        updated_at: now,
      },
    },
  );
  if (res.matchedCount === 0) return { id, status: 'error', message: 'row is not pending' };
  return { id, status: 'rejected' };
}

export interface KeeperResult {
  editionKey: string;
  status: 'kept' | 'dismissed' | 'error';
  keeper?: string;
  hidden?: number;
  message?: string;
  paths?: string[];
}

/**
 * Apply one `edition_keeper_queue` keep: hide every other member of the
 * cluster with the same semantics as /api/admin/duplicates (hidden_reason
 * 'duplicate', duplicate_of → keeper) plus the `updated_at` bump the Supabase
 * catalog sync keys on — a visibility flip without it is invisible to
 * Supabase and the hidden book keeps showing up in public listings.
 */
export async function applyKeeperChoice(
  db: Db,
  row: Document,
  opts: { keeperId: string; note?: string; reviewer: string; now?: Date; batch?: BatchMarker },
): Promise<KeeperResult> {
  const now = opts.now ?? new Date();
  const editionKey = row._id as string;
  const memberIds = ((row.members as { id: string }[]) || []).map((m) => m.id);
  if (!memberIds.includes(opts.keeperId)) {
    return { editionKey, status: 'error', message: 'keeperId must be a member of the cluster' };
  }
  const others = memberIds.filter((m) => m !== opts.keeperId);

  const hidden = await db.collection('books').updateMany(
    { id: { $in: others }, visible: true },
    {
      $set: {
        hidden: true,
        visible: false,
        hidden_reason: 'duplicate',
        hidden_at: now,
        duplicate_of: opts.keeperId,
        updated_at: now,
      },
    },
  );

  await db.collection('edition_keeper_queue').updateOne(
    { _id: editionKey as never },
    {
      $set: {
        status: 'kept',
        keeper: opts.keeperId,
        note: opts.note || null,
        ...(opts.batch ? { batch: opts.batch } : {}),
        reviewed_by: opts.reviewer,
        reviewed_at: now,
        updated_at: now,
      },
    },
  );

  return {
    editionKey,
    status: 'kept',
    keeper: opts.keeperId,
    hidden: hidden.modifiedCount,
    paths: [`/book/${opts.keeperId}`, ...others.map((o) => `/book/${o}`)],
  };
}

/** Dismiss one cluster: "not the same edition", no book is touched. */
export async function dismissKeeperCluster(
  db: Db,
  editionKey: string,
  opts: { note?: string; reviewer: string; now?: Date },
): Promise<KeeperResult> {
  const now = opts.now ?? new Date();
  const res = await db.collection('edition_keeper_queue').updateOne(
    { _id: editionKey as never, status: 'pending' },
    {
      $set: {
        status: 'dismissed',
        note: opts.note || null,
        reviewed_by: opts.reviewer,
        reviewed_at: now,
        updated_at: now,
      },
    },
  );
  if (res.matchedCount === 0) return { editionKey, status: 'error', message: 'cluster is not pending' };
  return { editionKey, status: 'dismissed' };
}

/** Hard cap on paths per finalize call — a 980-row run can name ~2,000. */
const MAX_FINALIZE_PATHS = 2000;

/**
 * Cache half of a batch run: dedupe the paths every applied row named, mark
 * them stale for ISR, and purge Cloudflare for the same set.
 *
 * NOT a write to any store — the data writes already happened inline, row by
 * row. The Supabase `books_catalog` mirror is NOT synced here: every write
 * above bumps `updated_at`, which is exactly what the incremental
 * `scripts/workers/sync-books-catalog.mjs` (Hetzner, :45 of every odd hour)
 * keys on, so the mirror catches up within two hours without this route
 * shelling out. Callers should say so to the human rather than implying the
 * public listings are already current.
 */
export async function finalizeIdentityBatch(paths: string[]): Promise<{ revalidated: number; purged: boolean }> {
  const uniq = [...new Set(paths.filter((p) => typeof p === 'string' && p.startsWith('/')))].slice(0, MAX_FINALIZE_PATHS);
  for (const p of uniq) revalidatePath(p);
  let purged = false;
  try {
    await purgeCloudflareUrls(uniq);
    purged = true;
  } catch (err) {
    // A failed purge leaves stale edge HTML, not bad data — report it, don't throw.
    console.error('[identity-batch] Cloudflare purge failed:', err);
  }
  return { revalidated: uniq.length, purged };
}
