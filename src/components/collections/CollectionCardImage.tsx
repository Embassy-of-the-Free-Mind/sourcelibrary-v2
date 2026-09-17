'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { cardFramingStyle, COVER_EVENT, type CardFraming, type CoverEventDetail } from '@/lib/collection-card-image';

/**
 * Collection/pathway card thumbnail with a resilient fallback chain. Tries each
 * candidate source URL in order; if one fails to load (dead source, optimizer
 * error, transient network), it advances to the next. When all candidates are
 * exhausted (or there are none), it renders the warm placeholder instead of a
 * broken image box.
 *
 * `framing` is the editor-chosen crop (see lib/collection-card-image). When
 * `slug` is given the card also listens for a cover saved from the editor on
 * this page and swaps to it in place.
 */
export default function CollectionCardImage({
  candidates,
  alt,
  sizes,
  priority = false,
  framing,
  slug,
}: {
  candidates: string[];
  alt: string;
  sizes: string;
  priority?: boolean;
  framing?: CardFraming;
  slug?: string;
}) {
  const [idx, setIdx] = useState(0);
  const [live, setLive] = useState<CoverEventDetail | null>(null);

  useEffect(() => {
    if (!slug) return;
    const h = (e: Event) => {
      const d = (e as CustomEvent<CoverEventDetail>).detail;
      if (d?.slug === slug) { setLive(d); setIdx(0); }
    };
    window.addEventListener(COVER_EVENT, h);
    return () => window.removeEventListener(COVER_EVENT, h);
  }, [slug]);

  const list = live ? [live.url, ...candidates] : candidates;
  const frame = live ? live.framing : framing;

  if (list.length === 0 || idx >= list.length) {
    return <div className="absolute inset-0 bg-warm" />;
  }

  return (
    // The hover zoom sits on a wrapper so the framing transform on the image
    // itself is not fought over.
    <div className="absolute inset-0 overflow-hidden transition-transform duration-500 ease-out group-hover:scale-105">
      <Image
        src={list[idx]}
        alt={alt}
        fill
        sizes={sizes}
        // Serve the sized R2 variant directly — the metered /_next/image optimizer
        // under-picks small srcset candidates (135px into a 324px slot) and blurs
        // the cards (#2401, CLAUDE.md). The candidate chain is pre-sized on R2.
        unoptimized
        className="object-cover"
        style={cardFramingStyle(frame)}
        priority={priority}
        loading={priority ? 'eager' : 'lazy'}
        onError={() => setIdx((i) => i + 1)}
      />
    </div>
  );
}
