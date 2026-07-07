/**
 * ReaderPresence — the quiet "N people are reading right now" live line
 * (issue #3059). Inspired by TownSquare's felt-presence, kept dignified for a
 * reading room: a soft pulse dot, a warm sentence, and an ambient sample of
 * which books are open right now.
 *
 * Two variants:
 *   - "hero"  display-only line under the homepage tagline (light-on-dark).
 *   - "chip"  compact line in the global footer; ALSO sends the heartbeat.
 *             The footer renders on every global page, so mounting the
 *             heartbeat here covers the whole site with one beat per browser.
 *
 * Privacy / scope invariants (see src/lib/presence.ts):
 *   - Anonymous random visitor id in localStorage; never tied to a login,
 *     never displayed, never sent anywhere but our own heartbeat.
 *   - Aggregate counts only. Book titles are resolved SERVER-SIDE from
 *     visible books — the client only sends a slug/id, never a title.
 *   - Nothing renders and no heartbeat fires on tenant subdomains / embeds
 *     (BPH/EFM stay closed systems) — gated via useEmbedContext.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useEmbedContext, isTenantSubdomain } from '@/hooks/useEmbedContext';
import { HEARTBEAT_MS, VISITOR_ID_RE, type PresenceSnapshot } from '@/lib/presence';

const PRESENCE_ID_KEY = 'sl-presence-id';
const COUNT_POLL_MS = 30_000;
// Don't show a lonely "1 reading" — that's just you (or nobody yet).
const DISPLAY_FLOOR = 2;
const MAX_TITLES_SHOWN = 4;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getOrCreatePresenceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(PRESENCE_ID_KEY);
    if (existing && VISITOR_ID_RE.test(existing)) return existing;
    const id = uuid();
    window.localStorage.setItem(PRESENCE_ID_KEY, id);
    return id;
  } catch {
    // Private-mode / blocked storage — fall back to an ephemeral id so the
    // heartbeat still works for this page load.
    return uuid();
  }
}

/**
 * Synchronous embed/tenant check for the heartbeat. useEmbedContext's
 * `isEmbedded` only upgrades to true in a post-mount effect, so on a tenant
 * subdomain the very first render reads false — we must NOT send even one beat
 * from bph.sourcelibrary.org. This mirrors useEmbedContext's own signals and
 * settles synchronously so no beat leaks in that first-render gap.
 */
function isEmbeddedNow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.self !== window.top) return true;
    if (window.location.pathname.startsWith('/embed/')) return true;
    return isTenantSubdomain(window.location.host);
  } catch {
    return false;
  }
}

/** Pull the slug-or-id out of a `/book/<seg>` reader URL, if we're on one. */
function bookKeyFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/book\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function formatTitleList(titles: string[]): string {
  const shown = titles.slice(0, MAX_TITLES_SHOWN);
  if (shown.length === 0) return '';
  if (typeof Intl !== 'undefined' && 'ListFormat' in Intl) {
    return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(shown);
  }
  return shown.join(', ');
}

export default function ReaderPresence({ variant }: { variant: 'hero' | 'chip' }) {
  const { isEmbedded } = useEmbedContext();
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const isChip = variant === 'chip';

  // Heartbeat — only the chip variant beats (it's in the footer, on every
  // page), so we never double-count from the homepage's hero + footer.
  useEffect(() => {
    if (isEmbedded || !isChip) return;
    const visitorId = getOrCreatePresenceId();
    if (!visitorId) return;

    const beat = () => {
      // Never beat from a tenant subdomain / embed, even in the first-render
      // gap before useEmbedContext settles (see isEmbeddedNow).
      if (isEmbeddedNow()) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const payload = JSON.stringify({ visitor_id: visitorId, book: bookKeyFromPath(pathRef.current) });
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon('/api/presence', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/presence', { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
        }
      } catch { /* presence is best-effort */ }
    };

    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isEmbedded, isChip]);

  // Count — both variants poll so each shows the live number.
  useEffect(() => {
    if (isEmbedded) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/presence/count');
        if (!res.ok) return;
        const data = (await res.json()) as PresenceSnapshot;
        if (alive && typeof data?.count === 'number') {
          setSnapshot({ count: data.count, titles: Array.isArray(data.titles) ? data.titles : [] });
        }
      } catch { /* leave last known snapshot */ }
    };
    load();
    const interval = setInterval(load, COUNT_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isEmbedded]);

  // Nothing to show: embedded, not loaded yet, or below the display floor
  // (deterministic null on SSR + first render → no hydration mismatch).
  if (isEmbedded || !snapshot || snapshot.count < DISPLAY_FLOOR) return null;

  const { count, titles } = snapshot;
  const titleList = formatTitleList(titles);

  const dotColor = isChip ? 'bg-emerald-500' : 'bg-emerald-400';
  const wrapClass = isChip
    ? 'inline-flex items-center gap-2 text-sm text-white/50'
    : 'inline-flex items-center gap-2.5 text-base md:text-lg text-white/80';

  return (
    <div className={wrapClass} aria-label={`${count} people are reading right now`}>
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className={`motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full ${dotColor} opacity-60`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
      </span>
      <span className="leading-snug">
        <span className="tabular-nums font-medium">{count.toLocaleString()}</span>{' '}
        {isChip ? 'reading now' : 'people are reading right now'}
        {!isChip && titleList && (
          <span className="text-white/60">
            {' '}— including <span className="italic">{titleList}</span>
          </span>
        )}
      </span>
    </div>
  );
}
