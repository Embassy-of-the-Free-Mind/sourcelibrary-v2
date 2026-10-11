import type { Db } from 'mongodb';
import { canonWorkForWorkId } from '@/lib/canon-works';

/**
 * Resolve a retired work_id to its current address (#3759).
 *
 * When work_id clusters are merged, the losing ids are kept on every edition
 * of the work in `books.work_id_aliases` (indexed). A /work/<old-id> URL then
 * finds no editions by direct match; this lookup recovers the current
 * work_id from any book carrying the alias, and prefers the canon slug when
 * the surviving id belongs to a canon entry — one stable reading address.
 *
 * Returns the target route param (slug or work_id) or null when the id is not
 * a known alias. No visibility filter: even a fully hidden cluster should
 * redirect rather than 404, so the address stays stable when books resurface.
 */
export async function workAliasTarget(db: Db, id: string): Promise<string | null> {
  if (!id) return null;
  const holder = await db
    .collection('books')
    .findOne({ work_id_aliases: id }, { projection: { work_id: 1 } });
  const current = holder?.work_id as string | undefined;
  if (!current || current === id) return null;
  const canon = canonWorkForWorkId(current);
  return canon ? canon.slug : current;
}

/**
 * Where a stored work_id points NOW (#4329).
 *
 * A work id held outside `books` (a `work_merge_queue` row, a saved URL) can
 * stop being carried by any book: it was merged away, or the local mint moved
 * when the title/author it was derived from was repaired. Both leave the old id
 * in `books.work_id_aliases`. Anything that ACTS on a stored id resolves it
 * here first, and says which of four things it found instead of treating
 * "no books" as one undifferentiated state:
 *
 *   live      — a book carries the id itself
 *   alias     — retired; every book holding it as an alias agrees on one current id
 *   ambiguous — retired, but its holders now sit on more than one work (the id
 *               was a fusion, or its cluster was split later). Never guess.
 *   orphaned  — no book carries it and no alias remembers it. The reference is dead.
 */
export type WorkIdResolution =
  | { via: 'live'; current: string }
  | { via: 'alias'; current: string }
  | { via: 'ambiguous'; current: null; candidates: string[] }
  | { via: 'orphaned'; current: null };

/** Pure half of `resolveWorkIds`: no I/O, so the four outcomes are unit-testable. */
export function resolveWorkIdsFrom(
  ids: string[],
  liveIds: Iterable<string>,
  aliasHolders: { work_id?: string | null; work_id_aliases?: string[] | null }[],
): Map<string, WorkIdResolution> {
  const live = new Set(liveIds);
  const targets = new Map<string, Set<string>>();
  for (const h of aliasHolders) {
    if (!h.work_id) continue;
    for (const alias of h.work_id_aliases || []) {
      if (alias === h.work_id) continue;
      if (!targets.has(alias)) targets.set(alias, new Set());
      targets.get(alias)!.add(h.work_id);
    }
  }
  const out = new Map<string, WorkIdResolution>();
  for (const id of new Set(ids)) {
    if (live.has(id)) { out.set(id, { via: 'live', current: id }); continue; }
    const t = [...(targets.get(id) || [])].sort();
    if (t.length === 1) out.set(id, { via: 'alias', current: t[0] });
    else if (t.length > 1) out.set(id, { via: 'ambiguous', current: null, candidates: t });
    else out.set(id, { via: 'orphaned', current: null });
  }
  return out;
}

/** Two indexed reads (`work_id_1`, `work_id_aliases_1`) for any number of ids. */
export async function resolveWorkIds(db: Db, ids: string[]): Promise<Map<string, WorkIdResolution>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const books = db.collection('books');
  const live = (await books.distinct('work_id', { work_id: { $in: uniq } })) as string[];
  const liveSet = new Set(live);
  const dead = uniq.filter((id) => !liveSet.has(id));
  const holders = dead.length
    ? await books
        .find<{ work_id?: string | null; work_id_aliases?: string[] | null }>(
          { work_id_aliases: { $in: dead } },
          { projection: { _id: 0, work_id: 1, work_id_aliases: 1 } },
        )
        .toArray()
    : [];
  return resolveWorkIdsFrom(uniq, liveSet, holders);
}

/** Why a queued pair cannot be merged. Written to the row, shown in the manifest. */
export type StalePairReason = 'orphaned-id' | 'ambiguous-alias' | 'already-merged';

/**
 * What approving a queued pair (a, b) would do once both ids are resolved:
 * merge the two CURRENT ids, or nothing — with the reason named.
 */
export function planQueuedPair(
  a: string,
  b: string,
  res: Map<string, WorkIdResolution>,
): { kind: 'merge'; a: string; b: string } | { kind: 'stale'; reason: StalePairReason; ids: string[] } {
  const ra = res.get(a);
  const rb = res.get(b);
  const bad = (via: string) => [a, b].filter((id) => (res.get(id)?.via ?? 'orphaned') === via);
  if (bad('ambiguous').length) return { kind: 'stale', reason: 'ambiguous-alias', ids: bad('ambiguous') };
  if (!ra?.current || !rb?.current) return { kind: 'stale', reason: 'orphaned-id', ids: bad('orphaned') };
  if (ra.current === rb.current) return { kind: 'stale', reason: 'already-merged', ids: [a, b] };
  return { kind: 'merge', a: ra.current, b: rb.current };
}
