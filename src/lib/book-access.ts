import { isInnerCircle } from '@/lib/auth-helpers';

/**
 * Access control for HIDDEN books (`visible === false`).
 *
 * A book is hidden when an editor/pipeline explicitly set `visible: false`
 * (the parallel `hidden: true` flag is kept in sync — see CLAUDE.md
 * "Visibility & Stats Invariants"). Hidden books are deliberately kept out
 * of public surfaces — often because they are in copyright (modern critical
 * editions / translations) or not yet QA'd.
 *
 * Until 2026-06 `visible: false` only removed a book from listings/search/
 * sitemap; the reader page and every content API (quote/text/IIIF) still
 * served the full text at the direct URL. This module is the gate that
 * closes that leak.
 *
 * Scope is intentionally narrow: ONLY `visible === false` is gated. Legacy
 * books with `visible: null`/missing (~6.5k, never explicitly promoted) stay
 * public exactly as before — do NOT widen this to `visible !== true`.
 *
 * Who may still read a hidden book:
 *   - the pipeline / Claude Code scripts, via `Authorization: Bearer <CRON_SECRET>`
 *   - a logged-in editor/admin (isInnerCircle), e.g. in the /book/[id]/preview route
 */

/**
 * Accepts any book-shaped object. Typed as `object` (not a `{ visible? }`
 * literal) so BOTH concrete `Book` interfaces and Mongo `WithId<Document>`
 * values pass without a cast at the ~17 call sites — a `{ visible? }` literal
 * is a TS "weak type" that rejects `WithId<Document>`, while an index-signature
 * type rejects the `Book` interface. `object` accepts every non-null object.
 */
export type BookLike = object;

/** True only for books an editor deliberately hid. null/missing = NOT hidden. */
export function isHiddenBook(book: BookLike | null | undefined): boolean {
  return (book as { visible?: boolean | null } | null | undefined)?.visible === false;
}

/** True if the request carries the pipeline/Claude-Code CRON_SECRET bearer token. */
export function hasCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * May this requester read a hidden book? CRON_SECRET bearer OR editor session.
 * Cheap path first (header check) so most public requests never hit the
 * session lookup.
 */
export async function canReadHiddenBook(request: Request): Promise<boolean> {
  if (hasCronAuth(request)) return true;
  try {
    return await isInnerCircle();
  } catch {
    return false; // fail closed
  }
}

/**
 * Final gate for API routes: returns true if the book may be served to this
 * requester. Public books (visible !== false) always pass; hidden books pass
 * only for CRON_SECRET or an editor session. A null book never passes
 * (callers should already 404 on not-found, but this is defensive).
 */
export async function isBookReadable(book: BookLike | null | undefined, request: Request): Promise<boolean> {
  if (!book) return false;
  if (!isHiddenBook(book)) return true;
  return canReadHiddenBook(request);
}
