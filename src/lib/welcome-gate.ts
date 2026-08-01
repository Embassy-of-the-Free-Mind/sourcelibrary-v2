/**
 * Should the welcome interstitial interrupt this page view?
 *
 * Extracted from WelcomeGate so the decision can be tested. The component around
 * it is three hooks and a `router.push`; every rule that could lock a reader out
 * of the site lives here, where a test can reach it.
 */

// Paths where the gate must not fire (the auth flow itself, the welcome page, API
// routes, embed/tenant surfaces where we don't own the chrome).
export const SKIP_PATH_PREFIXES = [
  '/welcome',
  '/auth/',
  '/api/',
  '/admin',
  '/embed/',
];

// Only the apex site. Tenant subdomains render a partner's reading room and have
// their own chrome — see the tenant lockdown rules in CLAUDE.md.
export function isApexHost(hostname: string): boolean {
  return (
    hostname === 'sourcelibrary.org' ||
    hostname === 'www.sourcelibrary.org' ||
    hostname.startsWith('localhost') ||
    hostname.endsWith('.vercel.app')
  );
}

export interface WelcomeGateInput {
  /** next-auth session status. */
  status: string;
  /** session.user.needsWelcome — may be STALE; see alreadyFired. */
  needsWelcome: boolean;
  pathname: string | null;
  hostname: string;
  /**
   * Has the gate already interrupted this reader in this tab?
   *
   * This is the rule that turns a stale `needsWelcome` from a lockout into a
   * single wasted navigation. It has to be here rather than in a mount-scoped
   * ref, because every firing of the gate is a navigation and every navigation
   * remounts the component.
   */
  alreadyFired: boolean;
}

export function shouldFireWelcomeGate(input: WelcomeGateInput): boolean {
  const { status, needsWelcome, pathname, hostname, alreadyFired } = input;

  if (status !== 'authenticated') return false;
  if (!needsWelcome) return false;
  if (!pathname) return false;
  if (alreadyFired) return false;
  if (SKIP_PATH_PREFIXES.some(p => pathname.startsWith(p))) return false;
  if (!isApexHost(hostname)) return false;

  return true;
}
