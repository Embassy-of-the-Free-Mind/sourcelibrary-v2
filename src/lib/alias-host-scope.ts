/**
 * Scoping non-canonical hosts to the surface they exist for.
 *
 * `ficinosociety.org` is an alias on the same Vercel project. `SOCIETY_DOMAINS`
 * in the proxy was written as an *additive* allowlist: it rewrites `/` →
 * `/ficino-society` and lifts `/discussions` and `/members` onto the domain
 * root. It never restricted anything, so every other route — `/book/*`,
 * `/artwork/*`, `/collections/*`, the whole library — fell through and was
 * served from that hostname too.
 *
 * That mattered more than duplicate content. `ficinosociety.org` resolves
 * straight to Vercel (name.com nameservers, no `cf-ray` on any response), so
 * the entire Cloudflare layer is absent there: the AS132203 blocks, the bot
 * rules, the first layer of the three-layer crawler gate. Measured 2026-07-29,
 * minutes after `host` was added to read events: **3,791 of ~6,276 `page_read`
 * events came from the Tencent fleet via `ficinosociety.org`, and zero came
 * from the fleet via `sourcelibrary.org`** — the edge block works, they were
 * simply walking in through the unguarded door.
 *
 * So a request to a non-canonical host for something outside that host's own
 * surface is answered with a 308 to the canonical domain, where every layer
 * applies. Redirecting rather than blocking keeps shared links working and
 * consolidates the duplicate content, and a crawler that follows the redirect
 * arrives somewhere it can be governed.
 *
 * The allowlist is deliberately explicit. Anything the society pages genuinely
 * need — their own routes, framework assets, auth, presence, telemetry — stays;
 * everything else leaves. If a society feature breaks, the fix is to add its
 * prefix here, never to widen this to a catch-all.
 */

export const CANONICAL_HOST = 'sourcelibrary.org';

/** Prefixes that must keep working on an alias host. */
const ALIAS_ALLOWED_PREFIXES = [
  // The society surface itself, plus the two paths the proxy lifts to root.
  '/ficino-society',
  '/discussions',
  '/members',
  // Framework + static assets. Redirecting these would break the page that is
  // legitimately served here.
  '/_next',
  '/static',
  '/images',
  '/fonts',
  // Auth and the society's own APIs. A cross-origin redirect on a credentialed
  // XHR fails, so these must be answered in place.
  '/api/auth',
  '/api/ficino',
  '/api/presence',
  '/api/me',
  // Telemetry: keep it local so this host's traffic keeps being measurable —
  // losing that visibility is how the bypass stayed invisible in the first place.
  '/api/analytics',
  '/api/track',
  '/api/errors',
  '/api/feedback',
];

/** Exact paths allowed on an alias host. */
const ALIAS_ALLOWED_EXACT = new Set(['/', '/favicon.ico', '/manifest.json', '/opensearch.xml']);

/**
 * Should this path be redirected off an alias host to the canonical domain?
 * Callers apply it only when the request is already known to be on an alias.
 */
export function shouldRedirectToCanonical(pathname: string): boolean {
  if (ALIAS_ALLOWED_EXACT.has(pathname)) return false;
  return !ALIAS_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

/** The canonical URL a redirected alias request should land on. */
export function canonicalUrl(pathname: string, search: string): string {
  return `https://${CANONICAL_HOST}${pathname}${search || ''}`;
}
