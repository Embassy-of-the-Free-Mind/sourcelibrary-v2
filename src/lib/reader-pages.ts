/**
 * Which pages a reader pages through (#5056).
 *
 * PRIOR ART: src/lib/page-counts.ts VISIBLE_PAGE_MATCH — the counters' rule
 * (`page_number > 0`); the reader's list is deliberately wider (it keeps page 0
 * and drops two page types), so it cannot simply spread it. This module is the
 * one copy of the reader's rule, which five routes had each inlined as the same
 * `p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread'`.
 *
 * A page is left out of the reader's list when:
 *  - its `page_number` is negative (a soft-hidden duplicate or split parent),
 *  - its `page_type` is in HIDDEN_PAGE_TYPES or is `archived-spread`, or
 *  - it carries `repeat_of`: a later capture of a leaf the book already holds
 *    (the same spread uploaded or photographed twice). `repeat_of` is the `id`
 *    of the kept capture. The page keeps its number and id, so a shortlink or
 *    citation made against it still resolves (the reader redirects it to the
 *    kept page); unsetting the field restores it.
 *
 * Direct URLs still resolve: this filters LISTS, never lookups by id.
 */

import { HIDDEN_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { NOT_REPEAT_CAPTURE, IS_REPEAT_CAPTURE, isRepeatCapture } from '@/lib/page-counts';

export { NOT_REPEAT_CAPTURE, isRepeatCapture };

/** The two count queries a caller runs; kept apart so a test can pin their shape. */
export function readerPageCountFilters(bookId: string, tenantId?: string | null) {
  const scope: Record<string, unknown> = tenantId ? { tenantId } : {};
  return {
    // Covered by pages_book_pagenum_idx (COUNT_SCAN) when there is no tenant scope.
    all: { book_id: bookId, page_number: { $gte: 0 }, ...scope },
    // Covered by pages_book_repeat_of_partial: a small partial index.
    repeats: { book_id: bookId, ...IS_REPEAT_CAPTURE, page_number: { $gte: 0 }, ...scope },
  };
}

/**
 * Number of pages `readerPageListFilter` matches, without fetching a page.
 * `countDocuments(readerPageListFilter(...))` itself cannot be answered from
 * any index (`repeat_of: null` is not boundable on pages_book_pagenum_idx), so
 * it FETCHed every page document of the book, OCR and translation included.
 * Count everything, then subtract the repeats (PR #7777 review S1).
 */
export async function countReaderListedPages(
  count: (filter: Record<string, unknown>) => Promise<number>,
  bookId: string,
  tenantId?: string | null,
): Promise<number> {
  const f = readerPageCountFilters(bookId, tenantId);
  const [all, repeats] = await Promise.all([count(f.all), count(f.repeats)]);
  return Math.max(0, all - repeats);
}

/** Page types the reader's list leaves out (still reachable by direct URL). */
export const READER_HIDDEN_PAGE_TYPES: ReadonlySet<string> = new Set([...HIDDEN_PAGE_TYPES, 'archived-spread']);

/** Mongo filter for one book's reader list. Pair with `isReaderListedPage` (the page types). */
export function readerPageListFilter(bookId: string) {
  return { book_id: bookId, page_number: { $gte: 0 }, ...NOT_REPEAT_CAPTURE };
}

/**
 * True iff the page belongs in the reader's page list. The projection that
 * loaded it must include `page_type`, `page_number` and `repeat_of`.
 */
export function isReaderListedPage(page: object | null | undefined): boolean {
  if (!page) return false;
  const p = page as { page_type?: unknown; page_number?: unknown; repeat_of?: unknown };
  if (typeof p.page_type === 'string' && READER_HIDDEN_PAGE_TYPES.has(p.page_type)) return false;
  if (typeof p.page_number === 'number' && p.page_number < 0) return false;
  return !isRepeatCapture(p);
}

/** The fields `resolveRepeatKeeper` reads from a page. */
export const REPEAT_KEEPER_PROJECTION = { _id: 0, id: 1, page_number: 1, repeat_of: 1, split_into: 1 } as const;

type KeeperCandidate = { id?: unknown; page_number?: unknown; repeat_of?: unknown; split_into?: unknown };

/**
 * The listed page a hidden repeat capture stands for, or null (#5056).
 *
 * Starts at `repeatOf` and follows, up to `maxHops` lookups:
 *  - a page that is itself a repeat, to its `repeat_of` (the sweep never writes
 *    chains, but a later sweep could);
 *  - an archived split parent (negative `page_number` with `split_into`), to
 *    its first leaf: a keeper split after the hide still has a listed page, so
 *    the leaf is not orphaned out of every list (PR #7777 review S6).
 * A missing page, or one soft-hidden without `split_into`, answers null: the
 * repeat then renders at its own URL, and scripts/audit/repeat-of-orphans.mjs
 * lists it.
 */
export async function resolveRepeatKeeper(
  lookup: (id: string) => Promise<object | null>,
  repeatOf: string,
  maxHops = 4,
): Promise<string | null> {
  let id = repeatOf;
  for (let hop = 0; hop < maxHops; hop++) {
    const p = (await lookup(id)) as KeeperCandidate | null;
    if (!p || typeof p.page_number !== 'number') return null;
    if (p.page_number < 0) {
      if (!Array.isArray(p.split_into) || typeof p.split_into[0] !== 'string') return null;
      id = p.split_into[0];
      continue;
    }
    if (typeof p.repeat_of === 'string') { id = p.repeat_of; continue; }
    return typeof p.id === 'string' ? p.id : null;
  }
  return null;
}

/**
 * `resolveRepeatKeeper` for many pages of ONE book at once: hidden repeat id ->
 * kept page id, for those of `pageIds` that are hidden repeats with a keeper.
 * A page that is not a repeat, or whose keeper cannot be resolved, is absent.
 *
 * For links rendered from stored data (chapters[].pageId, a printed page
 * number's page): the stored data is left alone and the link is mapped at
 * render time. `findByIds` loads pages of the book by id with at least
 * REPEAT_KEEPER_PROJECTION; it runs twice in the usual case (the pages, then
 * their keepers), and once more per hop only for a chain or a split keeper.
 */
export async function resolveRepeatKeepers(
  findByIds: (ids: string[]) => Promise<object[]>,
  pageIds: Iterable<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set([...pageIds].filter((id) => typeof id === 'string' && id))];
  if (wanted.length === 0) return out;
  const byId = new Map<string, KeeperCandidate>();
  const load = async (ids: string[]) => {
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length === 0) return;
    for (const row of (await findByIds(missing)) as KeeperCandidate[]) {
      if (typeof row.id === 'string') byId.set(row.id, row);
    }
  };
  await load(wanted);
  const repeats = wanted.filter((id) => typeof byId.get(id)?.repeat_of === 'string');
  if (repeats.length === 0) return out;
  await load(repeats.map((id) => byId.get(id)!.repeat_of as string));
  const lookup = async (id: string) => {
    if (!byId.has(id)) await load([id]);
    return byId.get(id) ?? null;
  };
  for (const id of repeats) {
    const keeper = await resolveRepeatKeeper(lookup, byId.get(id)!.repeat_of as string);
    if (keeper) out.set(id, keeper);
  }
  return out;
}

/**
 * Chapters with every `pageId` that is a hidden repeat swapped for its keeper
 * (`keepers` from resolveRepeatKeepers). `pageNumber` follows the keeper when
 * `numberOf` knows it: the reader picks the current chapter by page_number, so
 * a chapter left at the hidden page's number would not be "current" on the
 * page its own link opens. Returns the same array when nothing changes; never
 * mutates the stored chapters.
 */
export function mapChapterPageIds<T extends { pageId?: string; pageNumber?: number }>(
  chapters: T[],
  keepers: ReadonlyMap<string, string>,
  numberOf?: (pageId: string) => number | undefined,
): T[] {
  if (keepers.size === 0 || !chapters.some((ch) => ch.pageId && keepers.has(ch.pageId))) return chapters;
  return chapters.map((ch) => {
    const keeper = ch.pageId ? keepers.get(ch.pageId) : undefined;
    if (!keeper) return ch;
    const n = numberOf?.(keeper);
    return typeof ch.pageNumber === 'number' && typeof n === 'number' ? { ...ch, pageId: keeper, pageNumber: n } : { ...ch, pageId: keeper };
  });
}
