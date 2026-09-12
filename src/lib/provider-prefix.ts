import { LIBRARY_PARTNERS } from '@/lib/library-partners';
import { TENANT_ROOT_PATHS } from '@/lib/tenant-roots';

/**
 * Tenant slugs that own real URL space (partner subdomains with scoped UI).
 * The proxy's path-based tenant resolution is gated on this set; it must
 * never overlap with the provider-prefix strip below.
 *
 * The constant itself now lives in `@/lib/tenant-roots` — a leaf module the
 * browser can import without pulling in `LIBRARY_PARTNERS` and its logo data.
 * Re-exported here so existing server-side import sites keep working.
 */
export { TENANT_ROOT_PATHS };

/**
 * Contributing-library slugs that must never claim URL space. Content lives
 * at tenant-agnostic URLs (/book/..., /gallery/..., /collections/...), but
 * old provider-prefixed links (/internet-archive/book/foo) are still in
 * search indexes and AI-chat citations. Derived statically from
 * LIBRARY_PARTNERS — no DB lookup, and routing tenants are excluded so a
 * partner that is also a subdomain tenant (kloss-collection) keeps its root.
 */
const PROVIDER_PREFIX_SLUGS = new Set(
  Object.keys(LIBRARY_PARTNERS).filter(slug => !TENANT_ROOT_PATHS.has(slug))
);

/**
 * If `pathname` starts with a provider slug, return the pathname it should
 * 308 to; otherwise null.
 *
 *   /internet-archive/book/foo  → /book/foo
 *   /internet-archive           → /libraries/internet-archive (credit page)
 *   /bph/...                    → null (routing tenant, untouched)
 *   /book/foo                   → null (not a provider prefix)
 *
 * This re-establishes the PR #2025 safety net that was removed in commit
 * 8e348991 (it depended on `kind:'provider'` rows in the `tenants` Mongo
 * collection, which conflicted with tenant resolution). Evidence these links
 * still get real traffic: not_found_reports logged ~770 provider-prefixed
 * 404s in the first week of June 2026.
 */
export function getProviderPrefixRedirect(pathname: string): string | null {
  const match = pathname.match(/^\/([a-z0-9-]+)(\/.*)?$/);
  if (!match) return null;
  const [, firstSegment, rest] = match;
  // '/libraries/<lib>/book/foo' → '/book/foo'. The credit page owns only
  // /libraries/<slug>; deeper content-shaped paths were never valid URL space
  // but stale external links still carry them (not_found_reports, 2026-08:
  // /libraries/bibliotheca-philosophica-hermetica/book/…, /libraries/bph/book/…).
  // Any <lib> segment is stripped — known partner or not, the content slug is
  // globally unique and the redirect target enforces its own existence.
  if (firstSegment === 'libraries' && rest) {
    const deep = rest.match(/^\/[a-z0-9-]+(\/(?:book|gallery|collections|author|artwork)\/.+)$/);
    if (deep) return deep[1];
  }
  // '/default/book/foo' → '/book/foo'. The `tenants` collection has a
  // kind:'default' row whose slug leaked into externally-built links
  // (~390 not_found_reports/3d as of 2026-07-09). No book carries
  // tenantId 'default', so the whole prefix is safe to strip; the bare
  // root goes home rather than to a (nonexistent) credit page.
  if (firstSegment === 'default') {
    return rest && rest !== '/' ? rest : '/';
  }
  if (!PROVIDER_PREFIX_SLUGS.has(firstSegment)) return null;
  return rest && rest !== '/' ? rest : `/libraries/${firstSegment}`;
}
