/**
 * Surfaces that exist only on the global library, never inside a partner
 * reading room (issue #3364).
 *
 * After the tenant-as-filter migration, every path on a tenant subdomain flows
 * through to its global counterpart and the route is expected to honor the
 * `x-tenant-*` headers the proxy stamps. These routes don't: they render
 * corpus-wide aggregations that have no tenant-scoped meaning, so on
 * bph.sourcelibrary.org they served the whole global library. Measured before
 * the fix, `/encyclopedia/Matthiolus` on the BPH host linked 121 books of which
 * 102 were NOT BPH holdings, and `/api/entities` returned byte-identical global
 * results on both hosts.
 *
 * Blocking rather than scoping is deliberate. The entity index is built across
 * the whole corpus (`entities.books[]`), the timeline and map plot global
 * entities, ngrams are corpus-wide frequency data by construction, and
 * `/libraries` credits every contributing institution. A tenant-scoped version
 * of each would be a different feature, not a filter — and until one exists a
 * partner reading room should say "not here" rather than show someone else's
 * holdings.
 *
 * NOT listed, because they already scope correctly (verified by diffing tenant
 * vs global responses): `/search` and `/api/search/unified`, `/gallery`,
 * `/collections`, `/browse` (see src/lib/tenant-browse.ts).
 *
 * This is one list so the proxy block and the site nav can never disagree —
 * the nav must not link to a path the proxy 404s.
 */

/** Page routes. Also used to filter the site nav on tenant hosts. */
export const GLOBAL_ONLY_TENANT_PAGE_PATHS = [
  // Corpus-wide aggregations (#3364).
  '/encyclopedia',
  '/explore',
  '/ngrams',
  '/libraries',
  // The works index groups editions by `work_id` across the entire corpus and
  // its whole point is the cross-library span — "31 editions across 4
  // libraries". On a partner host that is a list of other institutions'
  // holdings, and a tenant-scoped version would be a different feature (most
  // works would collapse to one witness). Same reasoning as /libraries.
  // Note `/work/[id]` (singular) is NOT listed: it is a per-book detail surface
  // reached from a book page and already tenant-gated via embedPolicy
  // .showRelatedEditions, the same gate as the RelatedEditions rail.
  '/works',
  // Source Library's own institutional pages (#3370). A partner reading room is
  // not the place to tell Source Library's story, and these pages carry
  // hardcoded links into the wider corpus: /about alone embeds a figure linking
  // Michael Maier's Atalanta Fugiens plus four /q/ shortlinks to non-tenant
  // books, which was the last foreign-book link the leak audit could find on
  // bph.sourcelibrary.org. `/about` covers `/about/progress` by prefix.
  '/about',
  '/vision',
  '/census',
  '/research',
  '/blog',
  '/contribute',
  '/support',
  // `/give` is /support's one-screen twin and the header's Support button. Both
  // solicit for Source Library specifically (the NAF form is the Source Library
  // designation, not the Embassy's general fund), so a partner reading room is
  // the wrong place for it — a BPH visitor asked for money on BPH's own domain
  // would reasonably think they were giving to BPH. The header filters on this
  // list, so listing it here also removes the button on tenant hosts.
  '/give',
  '/sponsors',
  // Volunteer review queues. Items are drawn from `review_candidates`, a pool
  // built across every visible book in the corpus, so a partner reading room
  // would hand its visitors other libraries' pages to judge — the same content
  // leak as /encyclopedia, in a surface that also invites people to act on it.
  // A tenant-scoped review queue is a different feature, not a filter.
  '/review',
  '/volunteers',
  // Inner-circle curation surfaces (#3846): identity adjudication over the
  // whole corpus (work merges, edition keeper choices). Corpus-wide by
  // construction and actuating, so a partner host must refuse it outright —
  // the same reasoning as /review, with writes attached.
  '/curation',
] as const;

/**
 * Institutional pages that stay reachable on tenant hosts, deliberately.
 *
 * `/terms`, `/privacy`, `/dmca` and `/licensing` are legal and rights notices —
 * a public site must serve them on whatever host it answers, and the first three
 * plus `/developers` sit in the crawler-readable allow-lists that the
 * three-layer AI-access gate depends on (`BOT_READABLE_PATHS` in src/proxy.ts,
 * the path-scoped Cloudflare skip rule, and robots.txt DOCS_ONLY). Blocking them
 * per-host would make the policy layer inconsistent for anything crawling a
 * subdomain. `/in-memoriam` honours Joost Ritman, whose library IS the BPH
 * collection — more apt on that subdomain than on the global site.
 *
 * Not enforced in code; recorded so the next person adding to the block list
 * above knows these were considered and kept.
 */
export const TENANT_REACHABLE_INSTITUTIONAL_PATHS = [
  '/terms',
  '/privacy',
  '/dmca',
  '/licensing',
  '/developers',
  '/in-memoriam',
] as const;

/**
 * API routes backing those pages. Listed separately because these surfaces
 * render client-side: blocking only the page would leave the unscoped data
 * reachable, since the browser fetches it from the tenant host.
 */
export const GLOBAL_ONLY_TENANT_API_PATHS = [
  '/api/entities',
  '/api/explore',
  '/api/ngrams',
  // The queue pages render client-side and fetch their items from the host
  // they were served on, so blocking only the page would leave the unscoped
  // corpus reachable from a tenant subdomain.
  '/api/review',
] as const;

const ALL_GLOBAL_ONLY_PATHS: readonly string[] = [
  ...GLOBAL_ONLY_TENANT_PAGE_PATHS,
  ...GLOBAL_ONLY_TENANT_API_PATHS,
];

/** Exact match or a path segment beneath it — `/explore` and `/explore/map`,
 *  but never `/exploration`. */
export function isGlobalOnlyTenantPath(pathname: string): boolean {
  return ALL_GLOBAL_ONLY_PATHS.some(
    p => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/** True for a nav href that the proxy would 404 on a tenant host. */
export function isGlobalOnlyNavHref(href: string): boolean {
  return GLOBAL_ONLY_TENANT_PAGE_PATHS.some(
    p => href === p || href.startsWith(`${p}/`)
  );
}
