'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { trackEvent } from '@/lib/track-event';
import { getConsent } from '@/lib/consent';
import { useIsEmbedded, isTenantSubdomain } from '@/hooks/useEmbedContext';

/**
 * Year-end giving appeal on book pages, in the manner of Wikipedia's and the
 * Internet Archive's December banners: a short, direct note from the people who
 * run the library, shown where the readers are. Over the 30 days to 2026-10-29
 * /book/* drew 302,821 views and /give 89; the header button cannot close that
 * gap on its own.
 *
 * WHEN IT SHOWS — every condition must hold, and all are checked in the browser
 * after mount, so ISR-cached HTML never carries the banner and the date check
 * never freezes into a cached render:
 *   - inside SEASON (or `?giving_banner=1`, for previews);
 *   - not embedded: partner subdomain, /embed, /rooms or an iframe
 *     (tenant-lockdown.md — a partner's reading room must never ask for money
 *     on our behalf);
 *   - the cookie bar has been answered, so two bottom bars never stack;
 *   - from the reader's SECOND book page this session, so it meets people who
 *     are reading, not every bounce;
 *   - not dismissed in the last DISMISS_DAYS.
 *
 * Copy is the vision letter's facts (src/app/articles/vision/content.ts):
 * volunteer-built, over $120,000 spent, $60,000 given, 73,000 books waiting.
 * It deliberately names no campaign goal: the Wisdom Frontiers campaign is in
 * its quiet phase until 2027, and this asks only for ordinary gifts via /give.
 *
 * Pinned to the bottom, not the top, because the reader is a full-height layout
 * (Reader2C) and an in-flow top banner would push it off screen.
 */

const SEASON = { start: '2026-11-24', end: '2027-01-01' }; // end is exclusive
const DISMISS_KEY = 'sl_giving_banner_dismissed_at';
const VIEWS_KEY = 'sl_giving_banner_book_views';
const DISMISS_DAYS = 14;

function inSeason(now: Date): boolean {
  const t = now.toISOString().slice(0, 10);
  return t >= SEASON.start && t < SEASON.end;
}

// Storage can throw (private mode, blocked site data); the banner then simply
// behaves as if nothing was stored, which errs toward showing it once.
function read(store: Storage | undefined, key: string): string | null {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
function write(store: Storage | undefined, key: string, value: string) {
  try { store?.setItem(key, value); } catch { /* ignore */ }
}

export default function GivingSeasonBanner() {
  // useIsEmbedded sees /embed and /rooms paths on the first render, but learns
  // about a partner subdomain or an iframe only in its own effect, one render
  // later. Checking the host here as well means the banner can never flash on a
  // partner's reading room in that gap.
  const embedded = useIsEmbedded();
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (embedded || isTenantSubdomain(window.location.host) || window.self !== window.top) {
      setShow(false);
      return;
    }
    if (show) return;
    const forced = new URLSearchParams(window.location.search).get('giving_banner') === '1';
    if (!forced && !inSeason(new Date())) return;
    if (!forced && getConsent() === null) return;

    const views = Number(read(window.sessionStorage, VIEWS_KEY) || '0') + 1;
    write(window.sessionStorage, VIEWS_KEY, String(views));
    if (!forced && views < 2) return;

    const dismissedAt = Number(read(window.localStorage, DISMISS_KEY) || '0');
    if (!forced && Date.now() - dismissedAt < DISMISS_DAYS * 864e5) return;

    setShow(true);
    trackEvent('giving_banner_view', { source: 'book_banner' });
    // Counts every book page the reader opens (pathname), once shown stays put.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, pathname]);

  if (!show) return null;

  const dismiss = () => {
    write(window.localStorage, DISMISS_KEY, String(Date.now()));
    trackEvent('giving_banner_dismiss', { source: 'book_banner' });
    setShow(false);
  };

  return (
    <aside
      aria-label="A note from Source Library"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="pointer-events-auto relative mx-auto max-w-3xl bg-[#f6f3ee] border border-stone-300 shadow-2xl px-5 py-5 sm:px-8 sm:py-6">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-2 right-2 w-9 h-9 flex items-center justify-center text-stone-500 hover:text-stone-900"
        >
          <X className="w-4 h-4" />
        </button>
        <p className="font-display text-xl sm:text-2xl text-stone-900 leading-snug pr-8 mb-2">
          This library is free, and volunteers built it.
        </p>
        <p className="text-sm sm:text-base text-stone-700 leading-relaxed mb-4">
          No ads, no paywall: every translation sits beside the page it came from,
          for anyone to read and quote. Running it has cost over $120,000 so far,
          and donors have given $60,000. Another 73,000 scanned books are waiting
          to be read in English. If this library is useful to you, please give
          before the year ends.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/give"
            onClick={() => trackEvent('give_nav_click', { source: 'book_banner', url: '/give' })}
            className="inline-flex items-center bg-accent-rust hover:bg-accent-gold-dark text-white font-semibold px-6 py-2.5 transition-colors"
          >
            Donate
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-stone-600 hover:text-stone-900 underline underline-offset-2"
          >
            Not now
          </button>
          <span className="text-xs text-stone-500 ml-auto">
            Derek Lomas, founder · Embassy of the Free Mind, Amsterdam
          </span>
        </div>
      </div>
    </aside>
  );
}
