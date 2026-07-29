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
