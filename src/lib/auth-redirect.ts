/**
 * Post-sign-in redirect resolution for NextAuth.
 *
 * Sign-in lives only on the apex (`sourcelibrary.org/auth/signin`). Partner
 * reading rooms — bph.sourcelibrary.org and the tenants that follow — have no
 * sign-in page of their own, so a cataloguer signing in from a tenant
 * subdomain has to be sent back across an origin boundary afterwards.
 *
 * NextAuth's default `redirect` callback allows only relative URLs and URLs
 * whose origin equals `baseUrl`; anything else silently falls back to
 * `baseUrl`. That drops BPH editors on the main site after sign-in with no
 * explanation, which is indistinguishable from "signing in didn't work"
 * (#3468 — it cost a BPH librarian an hour before she wrote in).
 *
 * The session cookie is already shared across `.sourcelibrary.org` (see the
 * cookies block in `auth.ts`), so the session genuinely does carry to the
 * subdomain. Only the redirect was blocking the return trip.
 *
 * This module is deliberately dependency-free so it can be unit-tested
 * without pulling in the Mongo adapter that `auth.ts` imports.
 */

const APEX = 'sourcelibrary.org';

/**
 * Is this a Source Library host we're willing to hand a session back to?
 *
 * Exact-match the apex, or require a literal `.` before it, so lookalikes
 * fail closed:
 *   - `evilsourcelibrary.org`      → false (no dot separator)
 *   - `sourcelibrary.org.evil.com` → false (doesn't end with the apex)
 *   - `https://sourcelibrary.org@evil.com` → false (URL parses host as evil.com)
 *
 * HTTPS only: an http:// target would strip the `__Secure-` cookie's
 * protection and is never a real destination in production.
 */
export function isSourceLibraryHost(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  return url.hostname === APEX || url.hostname.endsWith(`.${APEX}`);
}

/**
 * Resolve where to send someone after they sign in.
 *
 * Order matters: relative paths resolve against `baseUrl` (NextAuth's own
 * behaviour), then same-origin absolutes pass through, then — the part we
 * add — any other `*.sourcelibrary.org` host. Everything else, including
 * anything unparseable, falls back to `baseUrl` rather than throwing, so a
 * malformed callbackUrl degrades to "you land on the homepage signed in"
 * instead of a 500 on the auth callback.
 */
export function resolvePostSignInRedirect(url: string, baseUrl: string): string {
  if (url.startsWith('/')) return `${baseUrl}${url}`;

  try {
    const target = new URL(url);
    if (target.origin === baseUrl) return url;
    if (isSourceLibraryHost(target)) return target.toString();
  } catch {
    // Not a URL at all — fall through.
  }

  return baseUrl;
}
