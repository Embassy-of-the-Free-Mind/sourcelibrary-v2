'use client';

import { useEffect, useRef } from 'react';

/**
 * Fire-and-forget "this book showed a fallback cover — save it" ping.
 *
 * Mounted by the book page only when the book has no stored, renderable cover
 * and the page therefore rendered a page-scan in its place. One POST to
 * `/api/books/[id]/ensure-cover` persists that same page as the book's cover so
 * the catalogue, sliders, search results and related rails stop showing a blank
 * placeholder for a book that visibly has a cover.
 *
 * Renders nothing and never blocks paint. The route is a no-op for books that
 * already have a usable cover, so a duplicate call costs one indexed lookup.
 * Deliberately not a server-side write during render: the book page is ISR
 * (`revalidate = 86400`), and writing from a cached render is exactly the
 * side-effect-in-a-cached-path shape CLAUDE.md warns about.
 */
export default function EnsureCover({ bookId }: { bookId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    // React 18 StrictMode double-mounts effects in dev; the route is idempotent
    // but there's no reason to send the request twice.
    if (fired.current) return;
    fired.current = true;

    const controller = new AbortController();
    fetch(`/api/books/${encodeURIComponent(bookId)}/ensure-cover`, {
      method: 'POST',
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {
      // Best-effort: a failed ping just means the cover stays unsaved until the
      // next view or until Phase 8.9 picks the book up. Never surface an error.
    });

    return () => controller.abort();
  }, [bookId]);

  return null;
}
