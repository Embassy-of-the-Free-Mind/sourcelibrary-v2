'use client';

import { useEffect } from 'react';

/**
 * Global broken image reporter. Listens for image load errors
 * across the entire page and reports them to the analytics endpoint.
 *
 * Debounces and deduplicates: reports at most one batch per page load,
 * and never reports the same URL twice per session.
 */

const reported = new Set<string>();
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (pending.length === 0) return;
  const urls = [...pending];
  pending = [];
  flushTimer = null;

  // Fire and forget — never block UI
  fetch('/api/analytics/broken-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls,
      page: window.location.pathname,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {}); // swallow errors
}

function handleError(e: Event) {
  const el = e.target;
  if (!(el instanceof HTMLImageElement)) return;

  const src = el.currentSrc || el.src;
  if (!src || reported.has(src)) return;

  // Only report images from our own domain
  if (!src.includes('images.sourcelibrary.org') && !src.includes('/api/image')) return;

  reported.add(src);
  pending.push(src);

  // Batch: wait 2s after last error to flush (catches cascading failures)
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 2000);
}

export default function BrokenImageReporter() {
  useEffect(() => {
    // Capture phase so we catch errors before any component swallows them
    document.addEventListener('error', handleError, true);
    return () => document.removeEventListener('error', handleError, true);
  }, []);

  return null;
}
