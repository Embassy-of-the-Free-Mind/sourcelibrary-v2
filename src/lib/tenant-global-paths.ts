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
  '/encyclopedia',
  '/explore',
  '/ngrams',
  '/libraries',
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
