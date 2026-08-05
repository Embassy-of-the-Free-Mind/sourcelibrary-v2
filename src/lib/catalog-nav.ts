import type { TenantSource } from '@/lib/tenant-context';

/**
 * Build the URL prefix the catalogue toolbar should link to.
 *
 * The catalogue is one set of routes reachable by two different URLs:
 *
 *   bph.sourcelibrary.org/catalog/4201      (proxy rewrites to the route below)
 *   sourcelibrary.org/embed/bph/catalog/4201
 *
 * Both render `src/app/embed/[tenant]/catalog/…`, so the route params alone
 * cannot tell you which URL the browser is showing. Hardcoding `/catalog/…`
 * (what the toolbar did) is correct on the subdomain and a 404 everywhere else,
 * including preview deployments, which have no tenant subdomain at all.
 *
 * `x-tenant-source` is the discriminator, and the proxy already sets it:
 * 'subdomain' for the rewrite branch, 'embed-path' for a direct /embed/ URL.
 *
 * Anything else (or a missing source) falls back to the embed form, which is
 * valid on every host. Better a URL that is ugly on the subdomain than one that
 * 404s off it.
 */
export function catalogBasePath(source: TenantSource | null, tenant: string): string {
  if (source === 'subdomain') return '/catalog';
  return `/embed/${encodeURIComponent(tenant)}/catalog`;
}

/**
 * Tenants whose catalogue index is its own route rather than a view of the
 * landing page. Mirrors `usesDedicatedCatalogue` in `src/proxy.ts` — if that
 * list grows, this one has to grow with it.
 */
const DEDICATED_CATALOGUE_TENANTS = new Set(['bhutan']);

/**
 * The catalogue INDEX is not `${catalogBasePath()}` — that is the base for
 * record and sub-pages only.
 *
 * On a subdomain both are spelled `/catalog`, which is what hid this: the
 * proxy rewrites bare `/catalog` to `/embed/<tenant>?view=catalog` (or to
 * `/embed/<tenant>/catalogue` for tenants with a dedicated route), while
 * `/catalog/<ubn>` rewrites to `/embed/<tenant>/catalog/<ubn>`. There is no
 * page at `/embed/<tenant>/catalog`, so linking there 404s off the subdomain.
 */
export function catalogIndexPath(source: TenantSource | null, tenant: string): string {
  if (source === 'subdomain') return '/catalog';
  const slug = encodeURIComponent(tenant);
  if (DEDICATED_CATALOGUE_TENANTS.has(tenant)) return `/embed/${slug}/catalogue`;
  return `/embed/${slug}?view=catalog`;
}
