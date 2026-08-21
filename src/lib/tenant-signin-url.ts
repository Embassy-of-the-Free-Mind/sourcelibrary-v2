/**
 * Where does a visitor on a partner subdomain go to sign in?
 *
 * Not to their own host. Tenant subdomains have no `/auth/*` routes of their
 * own — `proxy.ts` rewrites every non-`/embed/`, non-`/api/`, non-`/_next/`
 * path to `/embed/<tenant>`, so a relative `/auth/signin` link lands silently
 * on the tenant homepage and reads as "nothing happened" (the same trap
 * `navigateToAccount` was written for in #1953).
 *
 * So the link has to point at the apex, carrying a `callbackUrl` that brings
 * the visitor back to the tenant page they started on. That return trip needs
 * `resolvePostSignInRedirect` in `auth-redirect.ts` to permit it — NextAuth's
 * default callback rejects cross-origin returns. Both halves are required;
 * either one alone leaves the visitor on the wrong site (#3468).
 *
 * Shared by the client menu (`EmbedUserMenu`) and the server-rendered
 * catalogue record page so the two can't drift apart.
 */

const APEX_ORIGIN = 'https://sourcelibrary.org';

/**
 * A tenant subdomain is any `*.sourcelibrary.org` host that isn't the apex.
 * Vercel previews (`*.vercel.app`) and localhost are deliberately excluded —
 * they're not tenant hosts, and there the relative link works fine.
 */
export function isTenantSubdomain(host: string): boolean {
  return host.endsWith('.sourcelibrary.org') && host !== 'sourcelibrary.org';
}

/**
 * Build the sign-in href for a visitor currently at `currentUrl` on `host`.
 *
 * On a tenant subdomain this is an absolute apex URL with an absolute
 * callback. Anywhere else it stays relative, so previews and localhost keep
 * working without a hardcoded production origin.
 */
export function buildSignInHref(host: string, currentUrl: string): string {
  if (isTenantSubdomain(host)) {
    return `${APEX_ORIGIN}/auth/signin?callbackUrl=${encodeURIComponent(currentUrl)}`;
  }

  // Relative callback for same-host sign-in: keep the path and query, drop
  // the origin, so this behaves identically on preview and local hosts.
  let relative = '/';
  try {
    const parsed = new URL(currentUrl);
    relative = `${parsed.pathname}${parsed.search}`;
  } catch {
    // currentUrl wasn't absolute — treat it as already-relative if it looks
    // like a path, otherwise fall back to the homepage.
    if (currentUrl.startsWith('/')) relative = currentUrl;
  }

  return `/auth/signin?callbackUrl=${encodeURIComponent(relative)}`;
}
