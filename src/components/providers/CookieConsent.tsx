'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConsent, setConsent, type ConsentState } from '@/lib/consent';

/**
 * Minimal cookie consent banner — thin bar at the bottom of the screen.
 * Appears once, stores choice in localStorage.
 * No dark patterns, no "manage 47 categories." Just accept or decline.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if user hasn't made a choice yet
    if (getConsent() === null) {
      // Small delay so it doesn't flash on page load
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  // Also listen for consent changes (e.g. from cookie settings link)
  useEffect(() => {
    const handler = (e: Event) => {
      const state = (e as CustomEvent<ConsentState>).detail;
      if (state === null) {
        setVisible(true);
      } else {
        setVisible(false);
      }
    };
    window.addEventListener('sl_consent_change', handler);
    return () => window.removeEventListener('sl_consent_change', handler);
  }, []);

  function accept() {
    setConsent('accepted');
    setVisible(false);
  }

  function decline() {
    setConsent('declined');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[9999] animate-in slide-in-from-bottom duration-300"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="bg-stone-900/95 backdrop-blur-sm border-t border-white/10 text-white/80">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
          <p className="text-sm text-center sm:text-left flex-1">
            We use cookies for analytics to understand how the library is used.{' '}
            <Link href="/privacy" className="underline text-white/60 hover:text-white/90 transition-colors">
              Privacy policy
            </Link>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={decline}
              className="px-4 py-1.5 text-sm text-white/50 hover:text-white/80 transition-colors rounded"
            >
              Decline
            </button>
            <button
              onClick={accept}
              className="px-4 py-1.5 text-sm bg-white/15 hover:bg-white/25 text-white rounded transition-colors"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
