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

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Search, X, Maximize2 } from 'lucide-react';
import type { DeepZoomManifest } from '@/lib/types/book';
import {
  useFloatingOverlayTop,
  LENS_AVOID_ATTR,
  OVERLAY_CONTROL_Z,
} from '@/hooks/useFloatingOverlayTop';

const DeepZoomInline = lazy(() => import('./DeepZoomInline'));
const DeepZoomOverlay = lazy(() => import('@/components/artwork/DeepZoomOverlay'));

/**
 * A reader who closed the deep zoom that opened by itself has answered the
 * question: it stays closed on later pages, on this browser, until they ask.
 */
const CLOSED_KEY = 'sl-reader-deepzoom-closed';
function closedByReader(): boolean {
  try { return window.localStorage.getItem(CLOSED_KEY) === '1'; } catch { return false; }
}
function rememberClosed(closed: boolean) {
  try {
    if (closed) window.localStorage.setItem(CLOSED_KEY, '1');
    else window.localStorage.removeItem(CLOSED_KEY);
  } catch { /* private mode */ }
}

export default function PageDeepZoomButton({
  manifest,
  title,
  openByDefault = false,
  bed = '#0d0c0b',
  onInlineChange,
}: {
  manifest: DeepZoomManifest;
  title: string;
  /**
   * Desktop only: open the tiled viewer as the page's image instead of waiting
   * for a click. On touch the viewer's pan fights the swipe between pages, so a
   * phone keeps the button.
   */
  openByDefault?: boolean;
  /** What shows behind the image inside the viewer. */
  bed?: string;
  onInlineChange?: (inline: boolean) => void;
}) {
  const [inline, setInlineState] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  // Until the first view has drawn, the scan underneath stays visible, so a
  // page turn never flashes an empty box.
  const [drawn, setDrawn] = useState(false);
  const [openedAutomatically, setOpenedAutomatically] = useState(false);
  const setInline = (next: boolean) => {
    setInlineState(next);
    onInlineChange?.(next);
  };
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Follows the scroll so it stays reachable partway down a tall page scan.
  const buttonTop = useFloatingOverlayTop(buttonRef, !inline);

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
    const open = openByDefault
      && window.matchMedia('(min-width: 1024px)').matches
      && !closedByReader();
    setInlineState(open);
    setOpenedAutomatically(open);
    setDrawn(false);
    setOverlay(false);
    onInlineChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onInlineChange is a fresh closure each render; only a new page resets this.
  }, [manifest, openByDefault]);

  // The button is the way back in after a reader closed the viewer, and the only way in on a phone.
  const openInline = () => {
    if (openByDefault) rememberClosed(false);
    setOpenedAutomatically(false);
    setDrawn(false);
    setInline(true);
  };

  return (
    <>
      {!inline && (
        <button
          ref={buttonRef}
          {...{ [LENS_AVOID_ATTR]: '' }}
          onClick={() => (isDesktop ? openInline() : setOverlay(true))}
          style={{ top: buttonTop, zIndex: OVERLAY_CONTROL_Z }}
          className="absolute right-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/55 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors"
          title="Open deep zoom: stream this page at full resolution"
        >
          <Search className="w-3.5 h-3.5" />
          Deep zoom
        </button>
      )}

      {inline && (
        <div
          className="absolute inset-0 z-20 overflow-hidden"
          style={{ background: drawn || !openedAutomatically ? bed : 'transparent' }}
        >
          <Suspense fallback={null}>
            <DeepZoomInline
              manifest={manifest}
              quiet={openedAutomatically}
              // A real iframe, not useIsEmbedded(): that is also true on a partner's
              // own subdomain, where there is no host page and the wheel should zoom.
              wheelScrollsPage={window.self !== window.top}
              onDrawn={() => setDrawn(true)}
              onFailed={() => setInline(false)}
            />
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
            onClick={() => {
              if (openByDefault) rememberClosed(true);
              setInline(false);
            }}
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
