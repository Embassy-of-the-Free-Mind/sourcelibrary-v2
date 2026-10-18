import { isPageStatusAdmin, pageStatusFor, PAGE_STATUS, type PageStatusEntry } from '@/lib/page-status';

/**
 * What the proxy does with a request for a page listed in src/lib/page-status.ts.
 * Pure, so it can be tested without a request or a session.
 *
 *   pass          live page, or an admin: render normally
 *   send-to       archived page, not an admin: go to the entry's `sendTo`
 *   sign-in       internal/draft page, signed out: go to sign-in, then back
 *   unauthorized  internal/draft page, signed in but not an admin
 *
 * Every target is a PATH, never a URL: the proxy builds it on the request's
 * own host, so a partner subdomain is never redirected off itself
 * (.claude/docs/invariants/tenant-lockdown.md, invariant 1).
 */
export type PageStatusDecision =
  | { action: 'pass' }
  | { action: 'send-to'; path: string }
  | { action: 'sign-in'; path: string }
  | { action: 'unauthorized'; path: string };

export function pageStatusDecision(
  pathname: string,
  session: { signedIn: boolean; role?: unknown },
  registry: Record<string, PageStatusEntry> = PAGE_STATUS,
): PageStatusDecision {
  const entry = pageStatusFor(pathname, registry);
  if (!entry) return { action: 'pass' };
  if (session.signedIn && isPageStatusAdmin(session.role)) return { action: 'pass' };

  if (entry.state === 'archived') {
    // A missing sendTo is caught by tests/unit/page-status.test.ts; the home
    // page is the safe fallback if one ever ships.
    return { action: 'send-to', path: entry.sendTo || '/' };
  }
  if (!session.signedIn) {
    return { action: 'sign-in', path: `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}` };
  }
  return { action: 'unauthorized', path: '/unauthorized' };
}
