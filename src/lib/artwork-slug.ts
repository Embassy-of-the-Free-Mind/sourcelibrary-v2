/**
 * Choosing which record a `/artwork/<slug>` URL resolves to.
 *
 * Artworks can exist under a bare slug and a legacy `art-` prefixed twin, so
 * the lookup asks for both. The bug this exists to prevent: doing that with a
 * single `findOne({ slug: { $in: [slug, 'art-'+slug] } })` lets Mongo return
 * *either* match, and the visibility gate then runs on whichever came back. So
 * when a dedup sweep hid the `art-` twin — correctly, it is a duplicate — the
 * route could pick the hidden twin and 404 while the visible canonical sat
 * right there. `/artwork/bembine-table-of-isis` and `/artwork/gold` were dead
 * for weeks that way, linked from live collection pages.
 *
 * It also made the site disagree with itself: the librarian's link checker
 * (`src/lib/embassy/librarian.ts`) queries all variants with
 * `visible: { $ne: false }` and so reports the link as live, then the page
 * refuses it.
 *
 * Precedence, most specific first:
 *   1. the exact slug asked for, if visible
 *   2. the `art-` variant, if visible
 *   3. any match at all — hidden, so the caller's visibility gate 404s it
 *
 * Rule 3 matters: a hidden *canonical* must still 404 rather than silently
 * falling through to some other record (the hidden-book read-path gate).
 */

export interface ArtworkCandidate {
  slug?: string | null;
  visible?: boolean | null;
}

/**
 * Where a `/book/<id>` request should be sent instead, or null to render it as a book.
 *
 * `/book/[id]` renders artworks too (BookInfo branches to <ArtworkInfo> on
 * `resource_type`), so every artwork had two fully-rendering URLs, each emitting a
 * self-referential canonical. This is the predicate that collapses them onto /artwork.
 *
 * It has to agree with BOTH ends or it strands a working page:
 *   - the `isVisualArt` branch in src/app/book/[id]/page.tsx — what /book renders as art
 *   - getArtwork() in src/app/artwork/[slug]/page.tsx — what /artwork will accept:
 *     `resource_type` present, `content_type !== 'book'`, and matched BY SLUG ONLY
 * Anything failing either test keeps its /book rendering. A redirect into a 404 is
 * strictly worse than the duplicate URL this cleans up, so every branch here fails
 * toward "keep rendering where you are".
 */
export function artworkRedirectSlug(book: {
  content_type?: string | null;
  resource_type?: string | null;
  slug?: string | null;
}): string | null {
  // 'text' is handled by TextReader upstream; 'book' is refused by /artwork outright.
  if (book.content_type === 'text' || book.content_type === 'book') return null;
  // Mirrors isVisualArt: a resource_type that is neither of the two textual kinds.
  if (!book.resource_type || book.resource_type === 'printed_book' || book.resource_type === 'manuscript') return null;
  // /artwork resolves by slug ($in on [slug, `art-${slug}`]), never by id.
  return book.slug || null;
}

// Unconstrained in T so callers keep their own document type (the route passes
// raw Mongo documents straight through to the renderer); the two fields it
// actually reads are narrowed internally.
export function pickArtworkRecord<T>(candidates: T[], requestedSlug: string): T | null {
  if (!candidates.length) return null;
  const as = (c: T) => c as unknown as ArtworkCandidate;
  const visible = (c: T) => as(c).visible !== false;
  const slugOf = (c: T) => as(c).slug;

  return (
    candidates.find((c) => slugOf(c) === requestedSlug && visible(c)) ??
    candidates.find((c) => slugOf(c) === `art-${requestedSlug}` && visible(c)) ??
    candidates.find((c) => slugOf(c) === requestedSlug) ??
    candidates[0]
  );
}
