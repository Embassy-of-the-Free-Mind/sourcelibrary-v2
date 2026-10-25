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
import { getDb } from '@/lib/mongodb';
import { materializePages } from '../../scripts/lib/lazy-pages.mjs';

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
 * Called by the reader when a book with `pages_count > 0` came back with no page
 * docs. Returns true when the caller should re-read the pages from the primary:
 * they were just created (by this call or a concurrent one), or the book is not
 * lazy (an empty shell, or one materialized a moment ago — the re-read decides).
 * Throws LazyPagesNotReadyError when the book is lazy and its pages are still
 * not there.
 */
export async function materializeForReader(bookId: string): Promise<boolean> {
  // The primary, not the read pool: the claim is a write, and the caller re-reads
  // the pages it just created.
  const db = await getDb();
  const res = await materializePages(db, bookId, { trigger: 'reader', waitMs: READER_WAIT_MS });
  if (res.status === 'materialized' || res.status === 'not_lazy') return true;
  if (res.status === 'not_found') return false;
  throw new LazyPagesNotReadyError(bookId, res.status, res.error);
}
