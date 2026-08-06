/**
 * Which column a BPH catalogue URL segment addresses.
 *
 * The catalogue detail route is `/catalog/[ubn]` and keyed on `bph_works.ubn`.
 * But **Memorix issues no UBN for manuscripts or photographs** — 2,012 rows,
 * including all 110 `Fot` records and 442 of the `M ` manuscripts. Those rows
 * had no address anywhere on the site: the browser's `detailUrl()` returned null
 * without a ubn, so they rendered as dead plain text and could not be opened.
 *
 * Reported twice by BPH staff before anyone noticed:
 *   - José Bouman, 2026-07-31 — "It is not possible to click on titles with a
 *     shelf mark M (+number), nor on those with shelfmark Fot (+ number)"
 *   - Natalie Koch, 2026-08-05 — "the manuscript records aren't clickable yet"
 *
 * Every one of those rows carries a `uuid`, so the route accepts either key and
 * picks the column by shape. This is safe because the two shapes cannot collide:
 * a uuid is 8-4-4-4-12 hex, and **zero** `bph_works.ubn` values match that
 * pattern (verified against production 2026-08-05 — `ubn LIKE '%-%-%-%-%'`
 * returns 0 rows). UBNs are short digit strings, or occasionally shelf-mark-like
 * values such as "BPH 151".
 *
 * If a UBN ever DID take uuid shape it would be routed to the wrong column and
 * 404 — so the collision check is pinned by a test, not left as a comment.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function catalogKeyColumn(key: string): 'ubn' | 'uuid' {
  return UUID_RE.test(key) ? 'uuid' : 'ubn';
}

/**
 * The addressable key for a catalogue row, preferring the human-meaningful UBN
 * and falling back to the uuid. Returns null when the row has neither, in which
 * case callers must render plain text — never a link to `/catalog/null`, which
 * soft-404s (observed in not_found_reports 2026-05-26 to 05-28).
 */
export function catalogRowKey(row: { ubn?: string | null; uuid?: string | null } | null | undefined): string | null {
  return row?.ubn || row?.uuid || null;
}
