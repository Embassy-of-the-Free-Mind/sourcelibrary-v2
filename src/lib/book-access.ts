import type { Db } from 'mongodb';
import { isInnerCircle } from '@/lib/auth-helpers';
import { artworkRedirectSlug } from '@/lib/artwork-slug';
import { findBookForTenant } from '@/lib/tenant-catalog-books';

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

/**
 * Where a hidden DUPLICATE should send its readers, or null to keep the 404.
 *
 * Dedup hides the weaker copy (a low-res twin, a second scan of the same edition)
 * and records the copy it kept in `duplicate_of`. Without this, every inbound
 * link to the hidden copy — search engines, bookmarks, chat answers — dead-ended
 * on a 404 while the better copy sat one hop away (#5029: 4,050 records,
 * 3,332 with a visible keeper). Those 404s never reach not_found_reports either:
 * the logger skips hidden records by design.
 *
 * Deliberately narrow. Only a duplicate-class `hidden_reason` (or none) qualifies:
 * a rights/takedown hide must never be turned into a pointer at another copy of
 * the same text. The keeper must itself be `visible: true` and pass the tenant's
 * admission rule, so a redirect can never land on a 404 or leak a book onto a
 * partner subdomain. No chain-following: a hidden keeper means the 404 stands.
 */
const DUPLICATE_REASON_RE = /duplicate/i;
const RIGHTS_REASON_RE = /copyright|takedown|dmca|rights/i;
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9._~-]*$/i;

export interface DuplicateKeeper {
  slug: string;
  /** Set when the keeper renders on /artwork (see artworkRedirectSlug). */
  artworkSlug: string | null;
}

export async function findVisibleDuplicateKeeper(
  db: Db,
  hiddenBookId: string,
  tenant?: { id?: string | null; slug?: string | null } | null,
): Promise<DuplicateKeeper | null> {
  const hidden = await db.collection('books').findOne(
    { id: hiddenBookId },
    { projection: { _id: 0, visible: 1, duplicate_of: 1, hidden_reason: 1 }, maxTimeMS: 3000 },
  );
  if (!hidden || hidden.visible !== false) return null;
  if (typeof hidden.duplicate_of !== 'string' || !hidden.duplicate_of) return null;
  const reason = hidden.hidden_reason;
  if (reason != null && (typeof reason !== 'string' || !DUPLICATE_REASON_RE.test(reason) || RIGHTS_REASON_RE.test(reason))) {
    return null;
  }

  const found = await findBookForTenant(
    db,
    hidden.duplicate_of,
    { _id: 0, id: 1, slug: 1, visible: 1, content_type: 1, resource_type: 1 },
    tenant,
  );
  const keeper = found?.book as { slug?: string; visible?: boolean; content_type?: string; resource_type?: string } | undefined;
  if (!keeper || keeper.visible !== true) return null;
  if (!keeper.slug || !SAFE_SLUG_RE.test(keeper.slug)) return null;
  return { slug: keeper.slug, artworkSlug: artworkRedirectSlug(keeper) };
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

/**
 * The catalog card a hidden book presents to unauthorized callers.
 *
 * Policy (Derek, 2026-08-27): bibliographic metadata of hidden books is
 * PUBLIC — a large visible catalog raises the library's perceived value —
 * while CONTENT stays gated. So this card carries identity, description and
 * counts, and deliberately omits the pages array and every per-page image
 * URL (a page list against the public image bucket would be content access
 * in one hop). Cover fields are included: covers are a book's public face.
 * The text/quote/index/chat/download routes still refuse hidden books
 * entirely via isBookReadable above.
 */
const METADATA_CARD_FIELDS = [
  'id', 'slug', 'title', 'display_title', 'author', 'published', 'year',
  'language', 'original_language', 'text_role', 'is_translation',
  'pages_count', 'pages_translated', 'categories', 'work_id', 'doi',
  'reading_summary', 'contains_works', 'chapters',
  'thumbnail', 'thumbnail_blob', 'image_display', 'image_thumb',
] as const;

export function hiddenBookMetadataCard(book: BookLike): Record<string, unknown> {
  const b = book as Record<string, unknown>;
  const card: Record<string, unknown> = {};
  for (const f of METADATA_CARD_FIELDS) if (b[f] !== undefined) card[f] = b[f];
  // Per-language edition counters (pages_translated_es, …) — same public
  // surface as the visible-book card.
  for (const k of Object.keys(b)) if (k.startsWith('pages_translated_')) card[k] = b[k];
  card.visible = false;
  card.access = 'metadata_only';
  return card;
}
