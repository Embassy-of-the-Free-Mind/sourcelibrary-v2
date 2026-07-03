'use client';

import { useEffect } from 'react';

/**
 * Global broken-image reporter. Listens for image load errors and reports
 * truly-broken images to the analytics endpoint.
 *
 * Why the verify-after-tick logic: cards like BookCard handle errors by
 * swapping to a fallback URL on the same <img> element (display variant →
 * thumb variant). The original error event still fires, but the user ends
 * up seeing a working image. We only want to report when the *final*
 * rendered state is broken, not every intermediate failure.
 *
 * Algorithm:
 *   1. Capture the error event + the src that failed.
 *   2. After ~1s, re-check the element:
 *      - If unmounted → drop (component disappeared, irrelevant).
 *      - If src changed → drop (a fallback swap succeeded or is in-flight).
 *      - If complete && naturalWidth === 0 with the same src → genuinely
 *        broken, queue for batched reporting.
 */

const reported = new Set<string>();
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (pending.length === 0) return;
  const urls = [...pending];
  pending = [];
  flushTimer = null;

  fetch('/api/analytics/broken-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls,
      page: window.location.pathname,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {});
}

function isProductionHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'sourcelibrary.org' || host.endsWith('.sourcelibrary.org');
}

function handleError(e: Event) {
  const el = e.target;
  if (!(el instanceof HTMLImageElement)) return;

  const failedSrc = el.currentSrc || el.src;
  if (!failedSrc || reported.has(failedSrc)) return;

  if (!failedSrc.includes('images.sourcelibrary.org') && !failedSrc.includes('/api/image')) return;

  // Dedup early so we don't queue multiple verify-checks for the same URL.
  reported.add(failedSrc);

  // Verify after a tick: if a component-level fallback (BookCard, PageCard, etc.)
  // swaps the src and loads successfully, drop the report.
  setTimeout(() => {
    if (!el.isConnected) return;
    const currentSrc = el.currentSrc || el.src;
    if (currentSrc !== failedSrc) return; // src swapped, treat as recovered
    // complete=true with naturalWidth=0 is the canonical "fetched but no image" state.
    if (!el.complete || el.naturalWidth !== 0) return;

    pending.push(failedSrc);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 2000);
  }, 1000);
}

export default function BrokenImageReporter() {
  useEffect(() => {
    if (!isProductionHost()) return;
    // Capture phase so we catch errors before any component swallows them
    document.addEventListener('error', handleError, true);
    return () => document.removeEventListener('error', handleError, true);
  }, []);

  return null;
}
