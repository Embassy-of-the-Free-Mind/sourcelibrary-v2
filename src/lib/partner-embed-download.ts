/**
 * Anonymous downloads inside a partner's embed (#7702).
 *
 * A visitor on www.embassyofthefreemind.com reads the Embassy's books in an
 * iframe (`/embed/bph/...`). They cannot sign in there: `/auth/signin` is
 * X-Frame-Options DENY, and the session cookie is SameSite=Lax, so a
 * cross-site iframe never sends it. Every "sign in to download" inside that
 * frame dead-ends. Derek's decision (2026-10-29): inside the EFM embed, the
 * EFM's OWN books download without sign-in, under a per-visitor daily cap.
 * Everywhere else (sourcelibrary.org, other tenants, books the tenant does not
 * own) the sign-in rule is unchanged.
 *
 * THIS IS A CONVENIENCE GATE, NOT A SECURITY BOUNDARY. `Referer` and `Host`
 * are client-controlled: anyone with curl can claim to be the embed. What
 * bounds abuse is the anonymous per-IP cap (`ANON_EMBED_DAILY_BOOK_CAP`, via
 * download-cap.ts), the restriction to free-tier formats, and the restriction
 * to the partner's own books. Paid formats and image-licence rules
 * (`classifyImageAccess`) are untouched.
 *
 * Client-safe: no mongodb, no next/server, no Node built-ins — DownloadButton
 * imports the slug resolver to decide whether to show the sign-in wall. The
 * server side (tenant id lookup, IP key) is partner-embed-download-server.ts.
 *
 * PRIOR ART: src/lib/image-gate.ts — reads Referer to tell our own pages from
 * hotlinks, but answers "is this any of our properties", not "which partner's
 * embed"; src/lib/api-client/client.ts getTenantSlugFromPathname — client
 * path parser, but it also returns tenant root paths, which are not the embed.
 */

/**
 * Tenants whose embed may download their own books anonymously. One partner
 * today; adding one is a product decision, not a config tweak.
 */
export const ANON_EMBED_DOWNLOAD_TENANTS: readonly string[] = ['bph'];

/** Distinct books per rolling 24h per visitor IP, for anonymous embed downloads. */
export const ANON_EMBED_DAILY_BOOK_CAP = 10;

const SLUG_RE = /^[a-z0-9-]+$/;
const APEX_HOSTS = new Set(['sourcelibrary.org', 'www.sourcelibrary.org']);

function stripPort(host: string): string {
  return host.toLowerCase().trim().replace(/:\d+$/, '');
}

/** `bph.sourcelibrary.org` → 'bph' when bph is an allowed tenant, else null. */
function allowedTenantFromHost(host: string): string | null {
  const h = stripPort(host);
  const m = h.match(/^([a-z0-9-]+)\.sourcelibrary\.org$/);
  if (!m || m[1] === 'www') return null;
  return ANON_EMBED_DOWNLOAD_TENANTS.includes(m[1]) ? m[1] : null;
}

/** `/embed/bph` or `/embed/bph/...` → 'bph' when bph is an allowed tenant, else null. */
function allowedTenantFromEmbedPath(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] !== 'embed' || !segs[1] || !SLUG_RE.test(segs[1])) return null;
  return ANON_EMBED_DOWNLOAD_TENANTS.includes(segs[1]) ? segs[1] : null;
}

/**
 * Which allowed partner embed (if any) a request comes from, judged by the
 * request host and the Referer. Server side.
 *
 *  - Host `<slug>.sourcelibrary.org` → that partner (the subdomain IS the
 *    partner's reading room; its pages call the API on the same host).
 *  - Referer path under `/embed/<slug>/` on sourcelibrary.org, on the
 *    partner's subdomain, or on the request's own host (a preview deploy
 *    serves the same `/embed/...` paths).
 *
 * No Referer and a non-partner host → null.
 */
export function partnerEmbedTenantFromRequest(
  host: string | null | undefined,
  referer: string | null | undefined,
): string | null {
  if (host) {
    const fromHost = allowedTenantFromHost(host);
    if (fromHost) return fromHost;
  }
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  const refHost = stripPort(url.host);
  const sameHost = !!host && refHost === stripPort(host);
  const ourHost = APEX_HOSTS.has(refHost) || allowedTenantFromHost(refHost) !== null;
  if (!sameHost && !ourHost) return null;
  return allowedTenantFromEmbedPath(url.pathname);
}

/**
 * Same question, from the browser's own location. Client side: decides
 * whether DownloadButton shows the sign-in wall. The server re-decides.
 */
export function partnerEmbedTenantFromLocation(host: string, pathname: string): string | null {
  return allowedTenantFromHost(host) ?? allowedTenantFromEmbedPath(pathname);
}

/**
 * The pure predicate: the request comes from an allowed partner's embed AND
 * the book is that partner's own (`books.tenantId` equals the partner's tenant
 * id). `tenantIds` maps slug → tenant id (resolved by the caller).
 */
export function isPartnerEmbedDownloadFor(opts: {
  host: string | null | undefined;
  referer: string | null | undefined;
  bookTenantId: string | null | undefined;
  tenantIds: Record<string, string | null | undefined>;
}): boolean {
  const slug = partnerEmbedTenantFromRequest(opts.host, opts.referer);
  if (!slug) return false;
  const tenantId = opts.tenantIds[slug];
  return !!tenantId && !!opts.bookTenantId && opts.bookTenantId === tenantId;
}
