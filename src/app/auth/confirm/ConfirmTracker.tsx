'use client';

import { useEffect, useRef } from 'react';
import { trackEvent } from '@/lib/track-event';

/**
 * Instrumentation for the magic-link interstitial.
 *
 * The interstitial (see ../page.tsx) exists so mail-client prefetchers cannot
 * burn a single-use token before the human clicks. It works — but it also means
 * signing in now costs TWO clicks, and we had no way to see what that costs us.
 * An unconsumed `verification_tokens` row is silent about which step was missed:
 * never-opened mail, abandoned interstitial, and a link mangled by a corporate
 * URL-rewriter all leave exactly the same trace.
 *
 * `confirm_view` on mount and `confirm_click` on the button close that gap:
 * views tell us the mail arrived and was opened, and views-minus-clicks is the
 * interstitial's true drop-off. `safe` records whether the `next` parameter
 * survived transit, which separates "changed their mind" from "the link broke".
 *
 * Renders nothing. Tracking must never be able to block a sign-in, so this is a
 * sibling of the button rather than a wrapper around it.
 */
export function ConfirmTracker({ safe }: { safe: boolean }) {
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current) return; // StrictMode double-invokes effects in dev
    logged.current = true;
    trackEvent('confirm_view', { safe });
  }, [safe]);

  useEffect(() => {
    const btn = document.getElementById('confirm-signin');
    if (!btn) return;
    const onClick = () => trackEvent('confirm_click', { safe });
    btn.addEventListener('click', onClick);
    return () => btn.removeEventListener('click', onClick);
  }, [safe]);

  return null;
}
