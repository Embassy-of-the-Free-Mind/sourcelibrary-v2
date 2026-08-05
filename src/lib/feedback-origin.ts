/**
 * Where a piece of feedback came from.
 *
 * Until now the only answer to "is this BPH feedback?" was a string prefix on
 * the client-supplied `page` field — `scripts/analytics/feedback-triage.mjs`
 * classified anything under `/catalog/` as `partner-cms`. That is wrong in both
 * directions: the global site has its own `/catalog` and `/catalog/scholar`
 * routes (so non-tenant rows match), and a librarian writing from the catalogue
 * index or the tenant home doesn't match at all.
 *
 * These helpers derive the origin from things the server controls or at least
 * observes directly — the proxy's `x-tenant-*` headers first, the `Referer`
 * header second — so downstream queries can filter on a real `tenant_slug`
 * instead of guessing from a path.
 *
 * Nothing here does I/O; the route resolves a slug to an id.
 */

/**
 * Which part of the site the submitter was looking at.
 *
 * `catalog` is the BPH cataloguing UI (`/catalog/*` on a tenant subdomain),
 * `reader` is a book/page reading surface, `global` is everything else.
 *
 * Advisory only — it is derived from a path, and the `Referer` it usually comes
 * from is client-controlled. Never gate access on it; use `tenant_slug`, which
 * comes from the proxy, for anything that matters.
 */
export type FeedbackSurface = 'catalog' | 'reader' | 'global';

export interface FeedbackOrigin {
  tenant_slug: string | null;
  tenant_id: string | null;
  /** Which resolution branch produced the tenant, for debugging cross-tenant rows. */
  tenant_source: string | null;
  surface: FeedbackSurface;
  /** True when the submitter was inside a partner iframe or subdomain. */
  embedded: boolean;
}

/** An origin that records nothing. Used when tagging fails or nothing resolves. */
export const UNTAGGED_ORIGIN: FeedbackOrigin = {
  tenant_slug: null,
  tenant_id: null,
  tenant_source: null,
  surface: 'global',
  embedded: false,
};

/**
 * Pull the pathname out of a Referer header. Returns null for absent, relative,
 * or unparseable values rather than throwing — a malformed Referer is a normal
 * thing to receive from the open internet, not an error worth failing a write.
 */
export function refererPathname(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).pathname;
  } catch {
    return null;
  }
}

/**
 * Extract the tenant slug from an `/embed/<slug>/…` path.
 *
 * This exists because `src/proxy.ts` resolves an API call's tenant from the
 * Referer's FIRST path segment, which for a partner iframe is the literal
 * `embed`, not the tenant. So a reader submitting feedback from the Webflow
 * iframe at embassyofthefreemind.com reaches `/api/feedback` with no tenant
 * headers at all. Rather than widen the proxy (tenant lockdown invariant), the
 * feedback route re-reads it here.
 *
 * Returns null unless the path really is `/embed/<slug>/…` with a plausible
 * slug, so an arbitrary Referer can't inject a tenant name.
 */
export function parseEmbedTenantSlug(pathname: string | null): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'embed') return null;
  const slug = segments[1];
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  return slug;
}

/**
 * Strip a leading `/embed/<slug>` so an embedded catalogue path classifies the
 * same as the equivalent path on a tenant subdomain.
 */
function stripEmbedPrefix(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'embed' && segments[1]) {
    return '/' + segments.slice(2).join('/');
  }
  return pathname;
}

/**
 * Classify a path into a surface. Prefers the Referer path over the
 * client-supplied `page`, falling back to it when the Referer is missing
 * (some privacy modes strip it).
 */
export function deriveSurface(
  refererPath: string | null,
  page: string | null | undefined
): FeedbackSurface {
  const raw = refererPath || page || '';
  if (!raw.startsWith('/')) return 'global';
  const path = stripEmbedPrefix(raw);

  if (path === '/catalog' || path === '/catalogue') return 'catalog';
  if (path.startsWith('/catalog/') || path.startsWith('/catalogue/')) return 'catalog';
  if (path.startsWith('/book/') || path.startsWith('/read/')) return 'reader';
  return 'global';
}

/**
 * True when the submitter was inside a partner surface: either the proxy said
 * so, or the Referer is an `/embed/…` path.
 */
export function isEmbeddedOrigin(
  headerIsEmbedded: boolean,
  refererPath: string | null
): boolean {
  if (headerIsEmbedded) return true;
  return refererPath ? refererPath.split('/').filter(Boolean)[0] === 'embed' : false;
}
