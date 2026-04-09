'use client';

import { useEffect } from 'react';

interface Props {
  book?: string | null;
  page?: string | null;
}

/**
 * Fires a postMessage to the parent frame when Source Library pages are
 * embedded via embed.js on partner sites (e.g. Webflow).
 *
 * The parent embed.js listens for { type: 'sl-navigate' } and updates
 * the host page URL (?book=slug&page=pageId) for shareability and back-button support.
 *
 * Only fires when inside an iframe — no-ops when loaded directly.
 */
export default function EmbedNavigationReporter({ book = null, page = null }: Props) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.self === window.top) return; // not in an iframe

    window.parent.postMessage(
      { type: 'sl-navigate', book, page },
      '*'
    );
  }, [book, page]);

  return null;
}
