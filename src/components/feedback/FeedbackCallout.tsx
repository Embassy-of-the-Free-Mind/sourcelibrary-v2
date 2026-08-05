'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import FeedbackWidget from './FeedbackWidget';
import { useLocale, FEEDBACK_STRINGS } from '@/lib/i18n';

// Pages with their own "get involved" / feedback section opt out of this global
// callout to avoid a duplicate. (Redesigned collection pages, mycology for now.)
const HIDE_ON = ['/collections/mycology'];
// Homepage editions opt out entirely — they carry their own "Be part of this"
// band. Matched exactly, since every path startsWith('/').
const HIDE_EXACT = ['/', '/es'];

/**
 * A warm callout section inviting visitors to share feedback.
 * Rendered above the footer on every page via GlobalFooter.
 */
export default function FeedbackCallout() {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  // /es/support renders this band; without a locale the Spanish page carried an
  // English heading over a Spanish footer.
  const t = FEEDBACK_STRINGS[useLocale()];

  // Gate on client mount, and read the dismissed flag from localStorage. Gating
  // matters because the homepage (and other pages) are ISR-prerendered, where
  // `usePathname()` is null — so a render-time path check can't keep the callout
  // out of the STATIC HTML, and it would flash in before hydration hides it.
  // Rendering nothing until mounted keeps it out of the prerender entirely; it
  // then appears on the client only where the path isn't excluded.
  useEffect(() => {
    setMounted(true);
    if (localStorage.getItem('sl_feedback_callout_dismissed') === '1') {
      setDismissed(true);
    }
  }, []);

  if (!mounted || dismissed) return null;
  if (pathname && (HIDE_EXACT.includes(pathname) || HIDE_ON.some((p) => pathname.startsWith(p)))) return null;

  return (
    <section
      className="border-t"
      style={{
        background: 'var(--bg-warm, #f5f3f0)',
        borderColor: 'var(--border-light, #e8e5e0)',
      }}
    >
      <div className="max-w-2xl mx-auto px-6 py-12 text-center">
        <p
          className="font-serif text-xl sm:text-2xl leading-relaxed mb-2"
          style={{ color: 'var(--text-primary, #2c2824)' }}
        >
          {t.calloutHeading}
        </p>
        <p
          className="text-sm sm:text-base mb-6 max-w-lg mx-auto"
          style={{ color: 'var(--text-muted, #8a8480)' }}
        >
          {t.calloutIntro}
        </p>
        <div className="flex items-center justify-center gap-4">
          <FeedbackWidget
            label={t.calloutButton}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: 'var(--text-primary, #2c2824)' }}
          />
          <button
            onClick={() => {
              localStorage.setItem('sl_feedback_callout_dismissed', '1');
              setDismissed(true);
            }}
            className="text-xs transition-colors"
            style={{ color: 'var(--text-faint, #c4c0b8)' }}
          
          >
            {t.calloutDismiss}
          </button>
        </div>
      </div>
    </section>
  );
}
