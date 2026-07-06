'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * Collection/pathway card thumbnail with a resilient fallback chain. Tries each
 * candidate source URL in order; if one fails to load (dead source, optimizer
 * error, transient network), it advances to the next. When all candidates are
 * exhausted (or there are none), it renders the warm placeholder instead of a
 * broken image box.
 */
export default function CollectionCardImage({
  candidates,
  alt,
  sizes,
  priority = false,
}: {
  candidates: string[];
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  const [idx, setIdx] = useState(0);

  if (candidates.length === 0 || idx >= candidates.length) {
    return <div className="absolute inset-0 bg-warm" />;
  }

  return (
    <Image
      src={candidates[idx]}
      alt={alt}
      fill
      sizes={sizes}
      // Serve the sized R2 variant directly — the metered /_next/image optimizer
      // under-picks small srcset candidates (135px into a 324px slot) and blurs
      // the cards (#2401, CLAUDE.md). The candidate chain is pre-sized on R2.
      unoptimized
      className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
      priority={priority}
      loading={priority ? 'eager' : 'lazy'}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
