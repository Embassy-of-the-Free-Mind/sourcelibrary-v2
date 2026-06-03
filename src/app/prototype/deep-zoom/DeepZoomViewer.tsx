'use client';

/**
 * Deep-zoom gallery prototype (OpenSeadragon).
 *
 * Works like the gallery image viewer — page left/right between images with the
 * edge chevrons, arrow keys, or the thumbnail rail — except every image is a
 * tiled deep-zoom canvas. Scroll/pinch/double-click to zoom into the original;
 * only the tiles in view at the current zoom are fetched, so a 40-megapixel
 * sheet stays sharp and fast.
 *
 * Tiles are DZI pyramids on R2 (`images.sourcelibrary.org/deepzoom/<id>/...`),
 * generated with sharp from the full-resolution IIIF masters. The tileSource is
 * an inline DZI descriptor, so tiles load as plain <img> requests under the
 * existing img-src CSP (no .dzi XHR, no CORS dependency).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Home,
} from 'lucide-react';

export interface DeepZoomItem {
  id: string;
  title: string;
  book: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: string;
  /** R2 public base, e.g. https://images.sourcelibrary.org/deepzoom/blaeu-world-map */
  tileBase: string;
  /** Original IIIF master, for the "source record" link. */
  source: string;
  blurb: string;
}

// Inline DZI ("Deep Zoom Image") descriptor. OpenSeadragon's bundled types model
// this shape imperfectly, so we hand it back as a plain tile-source object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tileSourceFor(item: DeepZoomItem): any {
  return {
    Image: {
      xmlns: 'http://schemas.microsoft.com/deepzoom/2008',
      Url: `${item.tileBase}/`,
      Format: item.format,
      Overlap: String(item.overlap),
      TileSize: String(item.tileSize),
      Size: { Width: item.width, Height: item.height },
    },
  };
}

/**
 * The DZI level whose single 0_0 tile contains the whole image — a free
 * whole-image thumbnail straight from the pyramid (no extra assets).
 */
function thumbUrl(item: DeepZoomItem): string {
  const maxLevel = Math.ceil(Math.log2(Math.max(item.width, item.height)));
  // Largest level whose whole image still fits in a single 0_0 tile — the
  // sharpest free thumbnail from the pyramid.
  let level = 0;
  for (let L = maxLevel; L >= 0; L--) {
    const scale = Math.pow(2, maxLevel - L);
    if (item.width / scale <= item.tileSize && item.height / scale <= item.tileSize) {
      level = L;
      break;
    }
  }
  return `${item.tileBase}/${level}/0_0.${item.format}`;
}

export default function DeepZoomViewer({ items }: { items: DeepZoomItem[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);

  // Create the viewer once.
  useEffect(() => {
    let disposed = false;
    let viewer: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    import('openseadragon').then((mod) => {
      // UMD interop: the factory may sit on .default or on the module root.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const OpenSeadragon = ((mod as any).default ?? mod) as any;
      if (disposed || !containerRef.current) return;
      viewer = OpenSeadragon({
        element: containerRef.current,
        tileSources: tileSourceFor(items[0]),
        showNavigationControl: false,
        showNavigator: true,
        navigatorPosition: 'BOTTOM_RIGHT',
        navigatorHeight: 84,
        navigatorWidth: 112,
        navigatorBorderColor: 'rgba(255,255,255,0.25)',
        navigatorBackground: 'rgba(0,0,0,0.55)',
        navigatorAutoFade: true,
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
        gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true },
        animationTime: 0.8,
        springStiffness: 7,
        minZoomImageRatio: 0.8,
        // Cap zoom at native resolution — past 1:1 the viewer just magnifies
        // source pixels into mush. 1.0 keeps every zoom level showing real detail.
        maxZoomPixelRatio: 1.0,
        visibilityRatio: 1,
        constrainDuringPan: true,
        zoomPerScroll: 1.4,
        immediateRender: false,
      });
      viewerRef.current = viewer;
      viewer.addHandler('open', () => !disposed && setReady(true));
    });

    return () => {
      disposed = true;
      try {
        viewer?.destroy();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the active image (viewer.open resets the viewport to its home).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setReady(false);
    viewer.open(tileSourceFor(items[active]));
  }, [active, items]);

  const navigate = useCallback(
    (delta: number) => {
      setActive((i) => {
        const next = i + delta;
        return next < 0 || next > items.length - 1 ? i : next;
      });
    },
    [items.length],
  );

  // Arrow-key navigation, just like the gallery.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const item = items[active];
  const hasPrev = active > 0;
  const hasNext = active < items.length - 1;

  const zoomBy = (factor: number) => {
    const v = viewerRef.current;
    if (!v) return;
    v.viewport.zoomBy(factor);
    v.viewport.applyConstraints();
  };
  const home = () => viewerRef.current?.viewport.goHome();
  const fullscreen = () => viewerRef.current?.setFullScreen(true);

  return (
    <div className="overflow-hidden rounded-xl bg-[#0d0c0b] ring-1 ring-white/10">
      {/* Stage */}
      <div className="relative h-[72vh] min-h-[440px] w-full">
        <div ref={containerRef} className="absolute inset-0" />

        {!ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-stone-400">
            <span className="animate-pulse text-sm">Loading tiles…</span>
          </div>
        )}

        {/* Counter */}
        {items.length > 1 && (
          <span className="absolute right-4 top-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-xs tabular-nums text-stone-300">
            {active + 1} / {items.length}
          </span>
        )}

        {/* Zoom controls */}
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
          <Ctrl label="Zoom in" onClick={() => zoomBy(1.6)}>
            <ZoomIn className="h-4 w-4" />
          </Ctrl>
          <Ctrl label="Zoom out" onClick={() => zoomBy(1 / 1.6)}>
            <ZoomOut className="h-4 w-4" />
          </Ctrl>
          <Ctrl label="Reset view" onClick={home}>
            <Home className="h-4 w-4" />
          </Ctrl>
          <Ctrl label="Fullscreen" onClick={fullscreen}>
            <Maximize2 className="h-4 w-4" />
          </Ctrl>
        </div>

        {/* Edge navigation — gallery style */}
        {hasPrev && (
          <button
            onClick={() => navigate(-1)}
            title="Previous image (Left arrow)"
            aria-label="Previous image"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/70 transition-all hover:bg-black/80 hover:text-white sm:left-4 sm:p-3"
          >
            <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8" />
          </button>
        )}
        {hasNext && (
          <button
            onClick={() => navigate(1)}
            title="Next image (Right arrow)"
            aria-label="Next image"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/70 transition-all hover:bg-black/80 hover:text-white sm:right-4 sm:p-3"
          >
            <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8" />
          </button>
        )}

        {/* Caption overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10">
          <p className="pointer-events-auto text-sm font-medium text-white">
            {item.title}
            <span className="font-normal text-stone-400"> — {item.book}</span>
          </p>
          <p className="pointer-events-auto mt-0.5 text-xs text-stone-400">
            {item.width.toLocaleString()} × {item.height.toLocaleString()} px ·{' '}
            <a
              href={item.source}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-stone-200"
            >
              source record
            </a>{' '}
            · scroll / pinch to zoom, drag to pan
          </p>
        </div>
      </div>

      {/* Thumbnail rail */}
      <div className="flex gap-2 overflow-x-auto border-t border-white/10 bg-black/40 p-3">
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setActive(i)}
            title={it.book}
            className={`relative h-16 w-20 flex-shrink-0 overflow-hidden rounded-md ring-2 transition-all ${
              i === active ? 'ring-amber-500' : 'ring-transparent opacity-60 hover:opacity-100'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(it)}
              alt={it.book}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function Ctrl({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md bg-black/50 text-stone-100 transition-colors hover:bg-black/80"
    >
      {children}
    </button>
  );
}
