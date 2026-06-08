'use client';

/**
 * Deep-zoom affordance for a book page scan (issue #2411).
 *
 * Desktop: clicking "Deep zoom" turns the image panel itself into a tiled
 * OpenSeadragon viewer (DeepZoomInline, overlaid on the scan) so the reader can
 * zoom/pan the page while the translation stays visible beside it. A fullscreen
 * button escalates to the immersive overlay.
 *
 * Mobile: clicking opens the fullscreen DeepZoomOverlay directly — inline
 * pan/zoom would fight the swipe-between-pages gesture on touch.
 *
 * Kept as a small self-contained client component (owns its own open-state +
 * lazy viewers) rather than wiring state into the 2400-line TranslationEditor —
 * see memory: inline state there silently failed (reactCompiler + IIFE layout).
 */

import { useState, useEffect, lazy, Suspense } from 'react';
import { Search, X, Maximize2 } from 'lucide-react';
import type { DeepZoomManifest } from '@/lib/types/book';

const DeepZoomInline = lazy(() => import('./DeepZoomInline'));
const DeepZoomOverlay = lazy(() => import('@/components/artwork/DeepZoomOverlay'));

export default function PageDeepZoomButton({
  manifest,
  title,
}: {
  manifest: DeepZoomManifest;
  title: string;
}) {
  const [inline, setInline] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Reset when the reader moves to a different page.
  useEffect(() => {
    setInline(false);
    setOverlay(false);
  }, [manifest]);

  return (
    <>
      {!inline && (
        <button
          onClick={() => (isDesktop ? setInline(true) : setOverlay(true))}
          className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/55 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors"
          title="Open deep zoom — stream this page at full resolution"
        >
          <Search className="w-3.5 h-3.5" />
          Deep zoom
        </button>
      )}

      {inline && (
        <div className="absolute inset-0 z-20 bg-[#0d0c0b] rounded-lg overflow-hidden">
          <Suspense fallback={null}>
            <DeepZoomInline manifest={manifest} />
          </Suspense>
          <button
            onClick={() => {
              setInline(false);
              setOverlay(true);
            }}
            title="Fullscreen"
            aria-label="Fullscreen deep zoom"
            className="absolute top-2 right-11 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-stone-100 transition-colors hover:bg-black/80"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setInline(false)}
            title="Exit deep zoom"
            aria-label="Exit deep zoom"
            className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-stone-100 transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {overlay && (
        <Suspense fallback={null}>
          <DeepZoomOverlay manifest={manifest} title={title} onClose={() => setOverlay(false)} />
        </Suspense>
      )}
    </>
  );
}
