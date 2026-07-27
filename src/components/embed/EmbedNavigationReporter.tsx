'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface Props {
  book?: string | null;
  page?: string | null;
}

// Internal-only iframe params that must not be mirrored to the parent URL.
// `host_path` is appended by embed/v1.js so the iframe knows the parent path;
// `_r` is the popstate-fallback reload cache-buster.
const INTERNAL_PARAMS = new Set(['host_path', '_r']);

/**
 * Fires a postMessage to the parent frame when Source Library pages are
 * embedded via embed.js on partner sites (e.g. Webflow).
 *
 * The parent embed.js listens for { type: 'sl-navigate' } and mirrors the
 * iframe's URL state onto the host page URL so visitors can bookmark and
 * share their current filter/sort/view selection. `book`/`page` cover the
 * book deep-link contract; `filters` carries everything else (q, sort,
 * view, display, c-prefixed catalogue filters, language, offset, ...).
 *
 * Only fires when inside an iframe — no-ops when loaded directly.
 *
 * useSearchParams() must stay inside this component's own Suspense boundary:
 * on statically prerendered routes (the book page is ISR) an unwrapped call
 * throws a CSR bailout that gets caught by the *page's* outer Suspense,
 * replacing the entire server-rendered body with its skeleton fallback in the
 * served HTML — invisible to users (the client re-renders), but crawlers see
 * a content-free page (issue #2266).
 */
export default function EmbedNavigationReporter(props: Props) {
  return (
    <Suspense fallback={null}>
      <EmbedNavigationReporterInner {...props} />
    </Suspense>
  );
}

function EmbedNavigationReporterInner({ book = null, page = null }: Props) {
  const searchParams = useSearchParams();
  // searchParams identity can change between renders without contents changing;
  // depend on the string form so the effect re-fires exactly when the iframe
  // URL's query actually changes (filter clicks, sort changes, pagination).
  const searchKey = searchParams.toString();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.self === window.top) return; // not in an iframe

    const filters: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) {
      if (INTERNAL_PARAMS.has(k)) continue;
      if (v) filters[k] = v;
    }

    window.parent.postMessage(
      { type: 'sl-navigate', book, page, filters },
      '*'
    );

    // Signal to EmbedNavigationOverlay that the new page has begun rendering.
    window.dispatchEvent(new Event('embed:nav-end'));
  }, [book, page, searchKey, searchParams]);

  return null;
}
