/**
 * The reader's side of lazy pages (#7343 step 2a). The materializer itself is
 * scripts/lib/lazy-pages.mjs — ONE writer for every trigger; this file only
 * decides when the reader calls it and what a failure means on an ISR route.
 *
 * PRIOR ART: scripts/lib/lazy-pages.mjs (the materializer this wraps);
 * src/lib/page-number-resolve.ts resolves a page that EXISTS and has no notion
 * of a book whose pages were never created.
 *
 * Why a failure THROWS (invariants/rendering-and-seo.md): the book page is ISR
 * with a 24 h window. Rendering "no pages" for a book whose pages simply have not
 * been created yet would cache an empty book for a day. A throw is never cached:
 * ISR keeps serving the last good render, and a cold miss reaches error.tsx.
 */
import type { Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { materializePages } from '../../scripts/lib/lazy-pages.mjs';
import { isLazyPagesBook } from '../../scripts/lib/pages-state.mjs';

/** Thrown when a manifest-only book's pages could not be created for a reader. */
export class LazyPagesNotReadyError extends Error {
  constructor(public readonly bookId: string, public readonly status: string, detail?: string) {
    super(`lazy pages not ready for ${bookId}: ${status}${detail ? ` — ${detail}` : ''}`);
    this.name = 'LazyPagesNotReadyError';
  }
}

/** How long a reader request waits for another request that is already materializing the book. */
const READER_WAIT_MS = 8_000;

/**
 * The reader's pages for a book, materializing a lazy book's first.
 *
 * WHEN it acts (#7346 review 1 and 3):
 *   - the book doc says it is lazy (`pages_state` manifest_only/materializing),
 *     even with SOME pages: a partly written set must be finished, not rendered
 *     and cached for 24 h as if it were the book;
 *   - or, when `bookDocIsComplete` is false (the doc came from the Supabase
 *     catalog, which does not carry `pages_state`), the book came back with no
 *     pages and a positive count — it may be lazy.
 * Any other book returns `firstRead` untouched and costs nothing.
 *
 * FAILURE. For a book known to be lazy, anything short of its pages THROWS
 * LazyPagesNotReadyError (never cached by ISR). For a book only suspected of
 * being lazy, an ERROR (the primary is down) falls back to `firstRead`: a legacy
 * empty book must render exactly as it did before #7343, not as "unavailable".
 */
export async function resolveReaderPages<T>(opts: {
  bookId: string;
  book: { pages_count?: unknown; pages_state?: unknown };
  bookDocIsComplete: boolean;
  firstRead: T[];
  reread: (db: Db) => Promise<T[]>;
  /** Injected for tests; the primary, not the read pool — the claim is a write and the re-read must see it. */
  getPrimaryDb?: () => Promise<Db>;
}): Promise<T[]> {
  const { bookId, book, bookDocIsComplete, firstRead, reread, getPrimaryDb = getDb } = opts;
  const knownLazy = isLazyPagesBook(book);
  const maybeLazy = !bookDocIsComplete && firstRead.length === 0 && Number(book.pages_count ?? 0) > 0;
  if (!knownLazy && !maybeLazy) return firstRead;
  try {
    const db = await getPrimaryDb();
    const res = await materializePages(db, bookId, { trigger: 'reader', waitMs: READER_WAIT_MS });
    if (res.status === 'not_found') return firstRead;
    if (res.status !== 'materialized' && res.status !== 'not_lazy') {
      throw new LazyPagesNotReadyError(bookId, res.status, res.error);
    }
    // Materialized just now (by this call or a concurrent one), or a moment ago.
    return await reread(db);
  } catch (err) {
    if (err instanceof LazyPagesNotReadyError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    if (knownLazy) throw new LazyPagesNotReadyError(bookId, 'error', detail);
    console.warn(`[lazy-pages] reader check for ${bookId} failed; serving the first read: ${detail}`);
    return firstRead;
  }
}
