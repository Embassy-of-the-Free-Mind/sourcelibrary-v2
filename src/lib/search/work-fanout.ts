/**
 * "N editions of this work" — the fan-out shown under a collapsed search row
 * (#4300).
 *
 * THE COUNT IS A CLAIM (visibility-and-stats.md)
 * ----------------------------------------------
 * A card must count what its TARGET page renders, not what the collapse happened
 * to hide. `/collections/[id]` shipped "518 books" above a page showing 30
 * because the counter and the view were filled by different queries; the fix
 * there was to tie the number to the view. So this helper does not count rows,
 * and does not write its own predicate: it calls `workEditionsCountFilter()`,
 * which lives beside `workEditionsFilter()` — the filter `/work/[id]` builds
 * its edition list from — and selects the same set by the indexed half of it
 * (the `work_slug` branch has no index and takes ~8s; see that function's note).
 * `tests/unit/search-work-grouping.test.ts` pins the two to each other, so a
 * change to the work page's definition can't leave this number behind.
 *
 * TENANT LOCKDOWN
 * ---------------
 * The fan-out is a whole-library claim ("this work has 12 editions") and the
 * link goes to a global surface. On a partner subdomain that is other
 * institutions' holdings, so the caller must pass `tenantScoped: true` and get
 * nothing — the same gate `embedPolicy.showRelatedEditions` puts on the book
 * page's editions rail (tenant-lockdown.md).
 */

import type { Db } from 'mongodb';
import { canonWorkForWorkId, workEditionsCountFilter } from '@/lib/canon-works';
import { workIdFromGroupKey, type WorkFanout } from '@/lib/search/work-grouping';

/** Never fire more than this many count queries for one search request. */
const MAX_FANOUT_LOOKUPS = 8;

/**
 * The reading address for a work: the canon slug when the work has one (a
 * stable, human URL), otherwise the raw work_id. Mirrors `workAliasTarget()`.
 */
export function workHref(workId: string): string {
  const canon = canonWorkForWorkId(workId);
  return `/work/${encodeURIComponent(canon ? canon.slug : workId)}`;
}

/**
 * Count the editions `/work/[id]` would render, for each group that actually
 * replaced sibling rows.
 *
 * Returns a map keyed by the group key. A group is OMITTED (rather than given a
 * zero or a guess) whenever the count can't be established — a copy-keyed
 * group, a tenant request, a Mongo error, or a count that doesn't exceed one.
 * A missing entry renders as today's silent collapse; a wrong entry would be a
 * false claim, which is worse.
 */
export async function fetchWorkFanouts(
  db: Db,
  /** Group key → how many sibling rows that key replaced in THIS response. */
  collapsedByKey: Map<string, number>,
  opts?: { tenantScoped?: boolean },
): Promise<Map<string, WorkFanout>> {
  const out = new Map<string, WorkFanout>();
  if (opts?.tenantScoped) return out;

  const targets = [...collapsedByKey.entries()]
    .filter(([, collapsed]) => collapsed > 0)
    .map(([key, collapsed]) => ({ key, collapsed, workId: workIdFromGroupKey(key) }))
    .filter((t): t is { key: string; collapsed: number; workId: string } => !!t.workId)
    .slice(0, MAX_FANOUT_LOOKUPS);
  if (targets.length === 0) return out;

  await Promise.all(
    targets.map(async ({ key, collapsed, workId }) => {
      try {
        const editions = await db
          .collection('books')
          .countDocuments(workEditionsCountFilter(workId), { maxTimeMS: 2000 });
        // One edition means nothing is reachable that isn't already on screen.
        if (editions < 2) return;
        out.set(key, {
          work_id: workId,
          href: workHref(workId),
          editions,
          collapsed_in_results: collapsed,
        });
      } catch {
        // No number is better than a made-up one — fall back to a silent collapse.
      }
    }),
  );

  return out;
}
