/**
 * PRIOR ART: `src/lib/further-reading.ts` resolves an authored, ordered list of
 * `books.id` refs against the visible books a loader fetched, dropping any ref
 * that did not come back — and that rule is REUSED here verbatim. It does not
 * fit as-is because its unit is a flat list of BOOKS, while a reading list is a
 * list of WORKS, each of which may be satisfied by several held witnesses (a
 * manuscript and a print, two volumes, a named edition and a fallback) or by
 * none. The row, not the book, is what the reader checks off, and a row has a
 * state even when every book under it is absent. `furtherReadingStatus()` is
 * reused for the per-book readability word; nothing here adds a second
 * threshold.
 *
 * The reading list — the works a collection was BUILT AROUND, and the witnesses
 * that were asked for, distinguished from the related works we merely hold.
 *
 * WHAT THIS IS FOR
 * ----------------
 * A commissioned collection starts from a list: "these thirteen works, in these
 * manuscripts or editions". Months later the collection holds sixty-odd books,
 * and the works grid cannot say which of them were the point. The scholar who
 * wrote the list arrives with it in their head and wants one answer per row:
 * is it here, and in what form — the named witness, the list's own fallback,
 * another edition of the same work, a stopgap, or nothing yet.
 *
 * `collections.reading_list.items[]` carries that, authored. Each held ref
 * names its `match` so the page can say honestly what was found; the reader,
 * not the page, decides whether a microfilm of the named manuscript counts.
 *
 * THE TAKEDOWN RULE, INHERITED
 * ----------------------------
 * The loader fetches with `visible: true`. A ref whose book was not returned is
 * dropped — its `witness` label included, since that label is authored text
 * naming a specific book. A row whose refs ALL failed to resolve says only that
 * something was acquired and is being prepared: no title, no witness, no link.
 * That is the same defence `resolveFurtherReading` documents: authored prose
 * inside a collection document is a takedown surface, and the only structural
 * guard is that a resolve which cannot find the book renders nothing.
 */

import {
  furtherReadingStatus,
  type FurtherReadingBook,
  type FurtherReadingStatus,
} from './further-reading';

/** How a held book relates to what the list asked for. */
export type ReadingListMatch = 'exact' | 'fallback' | 'edition' | 'stopgap';

const MATCH_KINDS: ReadonlySet<string> = new Set(['exact', 'fallback', 'edition', 'stopgap']);

/** Reader-facing word for each match kind. */
export const READING_LIST_MATCH_LABEL: Record<ReadingListMatch, string> = {
  exact: 'the witness named',
  fallback: 'the list’s fallback',
  edition: 'another edition',
  stopgap: 'stopgap',
};

/** An authored held-witness ref inside a reading-list row. */
export interface ReadingListHeldRef {
  /** `books.id` — NOT the Mongo `_id`. */
  book_id: string;
  match: ReadingListMatch;
  /** The witness as the curator described it ("BSB Clm 4570, 1108 — colour"). */
  witness?: string;
}

/** An authored row of `collections.reading_list.items`. */
export interface ReadingListItem {
  /** Curator's running number ("N01"). Display only. */
  n?: string;
  /** The work, as the list named it. */
  work: string;
  /** The witnesses asked for, free text. */
  wanted?: string;
  /** Curator's note — typically why a row is still open. */
  note?: string;
  held?: ReadingListHeldRef[];
}

export interface ReadingListDoc {
  source?: string;
  items?: ReadingListItem[];
}

/** A held ref that resolved to a visible book. */
export type ReadingListWitness = ReadingListHeldRef & {
  book: FurtherReadingBook;
  status: FurtherReadingStatus;
};

export type ReadingListRowState =
  /** At least one witness resolved — the row links. */
  | 'held'
  /** Refs exist but none resolved (hidden while being processed). No titles leak. */
  | 'preparing'
  /** The list asked and nothing has been acquired. */
  | 'gap';

export interface ReadingListRow {
  n?: string;
  work: string;
  wanted?: string;
  note?: string;
  state: ReadingListRowState;
  witnesses: ReadingListWitness[];
}

function isHeldRef(x: unknown): x is ReadingListHeldRef {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.book_id === 'string' && r.book_id.length > 0
    && typeof r.match === 'string' && MATCH_KINDS.has(r.match);
}

function isItem(x: unknown): x is ReadingListItem {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.work === 'string' && r.work.trim().length > 0;
}

/**
 * Resolve the authored rows against the books actually fetched, preserving
 * the curator's order — of rows, and of witnesses within a row.
 *
 * Malformed rows (no `work`) and malformed refs (no `book_id`, unknown
 * `match`) are skipped rather than thrown on: the document is hand-edited, and
 * one bad row must not take the band down for the other twelve.
 */
export function resolveReadingList(
  doc: ReadingListDoc | ReadingListItem[] | undefined | null,
  books: FurtherReadingBook[],
): ReadingListRow[] {
  const items = Array.isArray(doc) ? doc : doc?.items;
  if (!Array.isArray(items) || items.length === 0) return [];
  const byId = new Map(books.map(b => [b.id, b]));

  return items.filter(isItem).map(item => {
    const refs = Array.isArray(item.held) ? item.held.filter(isHeldRef) : [];
    const witnesses: ReadingListWitness[] = refs.flatMap(ref => {
      const book = byId.get(ref.book_id);
      if (!book) return [];
      return [{ ...ref, book, status: furtherReadingStatus(book) }];
    });
    const state: ReadingListRowState =
      witnesses.length > 0 ? 'held' : refs.length > 0 ? 'preparing' : 'gap';
    return {
      n: item.n,
      work: item.work,
      wanted: item.wanted,
      note: item.note,
      state,
      witnesses,
    };
  });
}

/** Every `book_id` the loader must fetch for {@link resolveReadingList}. */
export function readingListBookIds(doc: ReadingListDoc | ReadingListItem[] | undefined | null): string[] {
  const items = Array.isArray(doc) ? doc : doc?.items;
  if (!Array.isArray(items)) return [];
  const ids = new Set<string>();
  for (const item of items) {
    if (!isItem(item) || !Array.isArray(item.held)) continue;
    for (const ref of item.held) if (isHeldRef(ref)) ids.add(ref.book_id);
  }
  return [...ids];
}
