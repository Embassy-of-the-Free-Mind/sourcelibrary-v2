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
