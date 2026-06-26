'use client';

import { useEffect } from 'react';

/**
 * Reports the NextAuth (Auth.js v5) error code to PostHog Error Tracking as a
 * real `$exception`, so the auth-failure classes — `Verification` (spent magic
 * link) and `Configuration` (OAuth handshake dying inside an in-app browser
 * webview, e.g. Instagram) — show up grouped, trended, and alertable, not just
 * as `$pageview`s on /auth/error. The page itself is a server component that
 * renders an error STATE rather than throwing, so the global window.onerror /
 * React-boundary funnel never sees it — this is the one place that does.
 *
 * Best-effort and dedup-safe: fires once per mount. Respects the same Decline
 * opt-out that gates all PostHog capture.
 */
export default function AuthErrorCapture({ code }: { code?: string }) {
  useEffect(() => {
    const ph = (window as unknown as {
      posthog?: { captureException?: (e: unknown, p?: Record<string, unknown>) => void };
    }).posthog;
    if (!ph || typeof ph.captureException !== 'function') return;

    const err = new Error(`Auth sign-in failed: ${code || 'unknown'}`);
    err.name = 'AuthError';
    ph.captureException(err, {
      error_source: 'auth_error_page',
      auth_error_code: code || 'unknown',
    });
  }, [code]);

  return null;
}
