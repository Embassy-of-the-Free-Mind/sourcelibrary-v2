/**
 * Work-grain grouping for search results (#4300).
 *
 * WHY
 * ---
 * A reader's mental model is a WORK; our result lists served a flat pile of
 * SCANS. An external audit of the catalogue found four separate records of
 * Kircher's *Musurgia Universalis* Vol. I — four digitizations of the same 1650
 * printing — presented as four unrelated results, which reads as a library that
 * doesn't know what it holds.
 *
 * The lanes disagreed about this. `/api/search` and the keyword book lane of
 * `/api/search/unified` each grew their own inline `seenWorkIds` filter; the
 * semantic lanes (`/api/search/semantic`, and unified's semantic lane) had
 * none, so the copies came back in through the lane nobody had patched. This
 * module is the single definition, so a new lane inherits the behaviour instead
 * of re-deriving it.
 *
 * WHAT COUNTS AS THE SAME THING — and what deliberately does NOT
 * -------------------------------------------------------------
 * Grouping happens ONLY on links a human or a HIGH-confidence resolver already
 * blessed:
 *
 *   `duplicate_of`  a copy is not a result; it collapses onto its keeper
 *   `work_id`       the work layer (~98% of live books), alias-aware
 *
 * `edition_key` is deliberately NOT a grouping key here. #4285's text
 * comparator read the OCR of 259 keeper↔copy pairs sharing a full-quality key
 * and found 27% of them are NOT the same content — fragments under a full
 * edition's key, generic-title collections, pecha volumes, the 1670 Spinoza
 * variant printings. Collapsing on a raw key match would hide *different texts*
 * behind one row: the search-side version of the wrongly-hidden-book failure.
 * When #4285 lands a text-confirmed allowlist, confirmed pairs can join here;
 * suspect and gray pairs must stay separate rows.
 *
 * WHAT THIS DOES NOT FIX
 * ----------------------
 * - Work-id fragmentation (14,946 unjudged local mints, 1,940 pending merges,
 *   #4271) means one work can still show as two rows. Mild, and self-healing as
 *   the queue drains.
 * - `work_id` is work-grain, not volume-grain, so Vol. I and Vol. II of one set
 *   share a key and collapse to one row (#3708). That is why the fan-out count
 *   and link matter: the collapsed volumes are still one click away on
 *   `/work/[id]`, which is exactly what the count describes.
 */

/** The identity fields grouping reads. Every lane must project these. */
export interface WorkGroupable {
  /** Book id — used only for stable tie-breaking, never as a group key. */
  book_id?: string | null;
  id?: string | null;
  work_id?: string | null;
  /** Retired work_ids kept on every edition by the merge writer (#3759). */
  work_id_aliases?: string[] | null;
  /** Set on a copy; points at the keeper book id. */
  duplicate_of?: string | null;
}

/**
 * The group key for one result, or null when the result must stand alone.
 *
 * Null is the safe answer and the common one: a book with no `work_id` is not
 * "ungrouped by accident", it is a book we have not shown to be an edition of
 * anything. Never invent a key from title/author strings — that is the
 * heuristic-collapse failure the edition layer exists to keep out of reader
 * surfaces.
 */
export function workGroupKey(b: WorkGroupable): string | null {
  const dup = typeof b.duplicate_of === 'string' ? b.duplicate_of.trim() : '';
  // A copy collapses onto its keeper even when the keeper is not in this
  // result set — two copies of one keeper then still group with each other.
  // Belt-and-braces: copies are normally hidden, so public lanes rarely see
  // one. That is exactly why it must not be the only defence.
  if (dup) return `copy:${dup}`;
  const work = typeof b.work_id === 'string' ? b.work_id.trim() : '';
  if (work) return `work:${work}`;
  return null;
}

/**
 * Build a canonical-key resolver over one result set, folding retired work_ids
 * into their survivor.
 *
 * The merge writer sets the surviving `work_id` on every edition and keeps the
 * losing ids in `work_id_aliases`, so in a settled corpus all editions already
 * agree and this is a no-op. It is not free of value: a partially-applied merge
 * (or a book written by an older resolver) can still carry a retired id, and
 * without this the same work splits into two rows precisely when the identity
 * layer is mid-repair.
 */
function buildAliasMap(items: WorkGroupable[]): Map<string, string> {
  const survivorOf = new Map<string, string>();
  for (const item of items) {
    const work = typeof item.work_id === 'string' ? item.work_id.trim() : '';
    if (!work) continue;
    for (const alias of item.work_id_aliases || []) {
      const a = typeof alias === 'string' ? alias.trim() : '';
      if (a && a !== work) survivorOf.set(a, work);
    }
  }
  // Chase a chain (A retired into B, B retired into C) so both rows land on C,
  // and stop on a cycle rather than spin — an inconsistent alias graph is a
  // data bug, not a reason to hang a search request.
  const resolved = new Map<string, string>();
  for (const [alias] of survivorOf) {
    let cur = alias;
    const seen = new Set<string>([alias]);
    for (let hops = 0; hops < 8; hops++) {
      const next = survivorOf.get(cur);
      if (!next || seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    if (cur !== alias) resolved.set(alias, cur);
  }
  return resolved;
}

export interface WorkGroup<T> {
  /** Canonical group key (`work:<id>` / `copy:<keeper id>`). */
  key: string;
  /** The result that represents the group — the first, i.e. best-ranked. */
  primary: T;
  /** The sibling results this row replaced, in their original order. */
  collapsed: T[];
}

export interface CollapseResult<T> {
  /** Results to render: one per group, plus every ungroupable result. */
  results: T[];
  /** Groups that actually replaced at least one sibling row. */
  groups: WorkGroup<T>[];
  /** key → group, for attaching fan-out metadata to the primary. */
  byKey: Map<string, WorkGroup<T>>;
}

/**
 * Collapse an ALREADY-RANKED list to one row per work.
 *
 * Order is the contract: the first occurrence of a key wins and becomes the
 * primary, so the caller must sort by its own keeper signals (translation
 * availability, scan quality, pages processed, closeness to source) BEFORE
 * calling. This function never re-ranks — a collapse that quietly reordered
 * results would make every lane's ladder unfalsifiable.
 */
export function collapseByWork<T extends WorkGroupable>(
  items: T[],
  opts?: { getIdentity?: (item: T) => WorkGroupable },
): CollapseResult<T> {
  const identityOf = opts?.getIdentity ?? ((item: T) => item as WorkGroupable);
  const identities = items.map(identityOf);
  const survivorOf = buildAliasMap(identities);

  const byKey = new Map<string, WorkGroup<T>>();
  const results: T[] = [];

  items.forEach((item, i) => {
    const raw = workGroupKey(identities[i]);
    if (!raw) {
      // No blessed identity — always its own row. Never guess.
      results.push(item);
      return;
    }
    const key = raw.startsWith('work:')
      ? `work:${survivorOf.get(raw.slice(5)) ?? raw.slice(5)}`
      : raw;
    const existing = byKey.get(key);
    if (existing) {
      existing.collapsed.push(item);
      return;
    }
    byKey.set(key, { key, primary: item, collapsed: [] });
    results.push(item);
  });

  return {
    results,
    groups: [...byKey.values()].filter(g => g.collapsed.length > 0),
    byKey,
  };
}

/**
 * The work id a group key names, or null for a copy-keyed group.
 * Used to look up the fan-out count against the work page's own filter.
 */
export function workIdFromGroupKey(key: string): string | null {
  return key.startsWith('work:') ? key.slice(5) : null;
}

/**
 * Fan-out metadata attached to a primary result whose row replaced siblings.
 *
 * `editions` is the count of what `/work/[id]` RENDERS, not the number of rows
 * we hid — the two differ and the reader is being handed a link, so the count
 * has to describe the destination (visibility-and-stats.md: "a card must count
 * what its TARGET page renders"). `collapsed_in_results` is the local number,
 * kept for tests and diagnostics and never shown as the headline.
 */
export interface WorkFanout {
  work_id: string;
  href: string;
  editions: number;
  collapsed_in_results: number;
}
