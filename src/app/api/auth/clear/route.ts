import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/clear
 *
 * One-shot endpoint to nuke stale NextAuth cookies, then redirect to
 * /auth/signin.
 *
 * Lives under /api/ so the BPH subdomain proxy lets it through unchanged —
 * non-/api/ paths get rewritten to /embed/[tenant]/* on tenant subdomains.
 *
 * Why this exists:
 *
 * Before #1943, NextAuth issued session cookies host-only (per-subdomain).
 * After #1943, the production cookie is shared at `.sourcelibrary.org`.
 * Same name, different scope — browsers treat them as distinct cookies and
 * keep both. Sign-out on the shared cookie doesn't clear the legacy host-only
 * cookie, so a user signed in pre-#1943 still appears signed in on
 * bph.sourcelibrary.org after clicking Sign out.
 *
 * This route sends two Set-Cookie headers per auth cookie name — one with
 * `Path=/` and no Domain (clears the legacy host-only variant), one with
 * `Path=/; Domain=.sourcelibrary.org` (clears the shared variant). Both have
 * `Max-Age=0`. Browsers delete whichever matches.
 *
 * Safe to keep around indefinitely (re-clearing already-deleted cookies is a
 * no-op), but can be removed once we're confident the legacy cookie set has
 * aged out across all signed-in users.
 */

// Cookie names NextAuth uses. We match production prefixes regardless of env
// — clearing a cookie that doesn't exist is harmless.
const COOKIE_NAMES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
  '__Secure-authjs.callback-url',
  'authjs.callback-url',
  '__Host-authjs.csrf-token',
  'authjs.csrf-token',
];

function buildClearCookie(name: string, options: { domain?: string }): string {
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  // Production cookies are Secure-only; the Secure flag is required for the
  // __Secure- / __Host- prefixes to be accepted by the browser when clearing.
  if (name.startsWith('__Secure-') || name.startsWith('__Host-')) {
    parts.push('Secure');
  }
  // __Host- prefix forbids a Domain attribute; everything else can carry one.
  if (options.domain && !name.startsWith('__Host-')) {
    parts.push(`Domain=${options.domain}`);
  }
  return parts.join('; ');
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get('callbackUrl') || '/';

  // Redirect to the sign-in page with the user's original destination preserved,
  // so after they re-sign-in they land back where they started.
  const signinUrl = new URL('/auth/signin', request.url);
  signinUrl.searchParams.set('callbackUrl', callbackUrl);

  const res = NextResponse.redirect(signinUrl, { status: 303 });

  for (const name of COOKIE_NAMES) {
    // Legacy host-only cookie (set by pre-#1943 NextAuth on each subdomain).
    res.headers.append('Set-Cookie', buildClearCookie(name, {}));
    // Current shared cookie (set by #1943 on .sourcelibrary.org).
    res.headers.append('Set-Cookie', buildClearCookie(name, { domain: '.sourcelibrary.org' }));
  }

  return res;
}
