'use client';

/**
 * Deep-zoom viewer prototype (OpenSeadragon).
 *
 * Streams tiled DZI pyramids from R2 (`images.sourcelibrary.org/deepzoom/<id>/...`)
 * rather than loading a whole master image. Only the tiles in view at the current
 * zoom are fetched, so a 33-megapixel folio stays sharp and fast on any device.
 *
 * The tile pyramids were generated with sharp (`.tile({layout:'dz'})`) from the
 * full-resolution IIIF masters and uploaded under the `deepzoom/` prefix. The
 * tileSource is passed as an inline DZI descriptor object, so no `.dzi` XHR is
 * needed — tiles load as plain <img> requests governed by the existing img-src CSP.
 */

import { useEffect, useRef, useState } from 'react';

export interface DeepZoomItem {
  id: string;
  title: string;
  book: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: string;
  /** R2 public base, e.g. https://images.sourcelibrary.org/deepzoom/khunrath-oratory */
  tileBase: string;
  /** Original IIIF master, for the "view source record" link. */
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
        prefixUrl: '', // we provide our own SVG controls below; hide default nav images
        showNavigationControl: false,
        showNavigator: true,
        navigatorPosition: 'BOTTOM_RIGHT',
        navigatorHeight: 90,
        navigatorWidth: 120,
        navigatorBorderColor: 'rgba(255,255,255,0.25)',
        navigatorBackground: 'rgba(20,18,15,0.6)',
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
        animationTime: 0.8,
        springStiffness: 7,
        minZoomImageRatio: 0.7,
        maxZoomPixelRatio: 2.5, // allow zooming past 1:1 to inspect the engraving grain
        visibilityRatio: 1,
        constrainDuringPan: true,
        zoomPerScroll: 1.4,
        // No crossOriginPolicy: the tiles are served without CORS headers, and
        // requesting them with `crossorigin` would leave the canvas blank. We
        // only display (never read pixels back), so a tainted canvas is fine.
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

  // Swap image when the active tab changes.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setReady(false);
    viewer.open(tileSourceFor(items[active]));
  }, [active, items]);

  const item = items[active];

  const zoomBy = (factor: number) => {
    const v = viewerRef.current;
    if (!v) return;
    v.viewport.zoomBy(factor);
    v.viewport.applyConstraints();
  };
  const home = () => viewerRef.current?.viewport.goHome();
  const fullscreen = () => viewerRef.current?.setFullScreen(true);

  return (
    <div className="flex flex-col gap-4">
      {/* Image switcher */}
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setActive(i)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              i === active
                ? 'border-amber-700 bg-amber-800 text-amber-50'
                : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-900'
            }`}
          >
            {it.book}
          </button>
        ))}
      </div>

      {/* Viewer */}
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[68vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-stone-300 bg-[#141210]"
        />

        {!ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-stone-400">
            <span className="animate-pulse text-sm">Loading tiles…</span>
          </div>
        )}

        {/* Custom controls */}
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <ControlButton label="Zoom in" onClick={() => zoomBy(1.5)}>＋</ControlButton>
          <ControlButton label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>－</ControlButton>
          <ControlButton label="Reset view" onClick={home}>⤾</ControlButton>
          <ControlButton label="Fullscreen" onClick={fullscreen}>⤢</ControlButton>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/45 px-2.5 py-1 text-xs text-stone-200 backdrop-blur-sm">
          Scroll or pinch to zoom · drag to pan · double-click to zoom in
        </div>
      </div>

      {/* Caption */}
      <div className="text-sm text-stone-600">
        <p className="text-base font-medium text-stone-900">
          {item.title}
          <span className="font-normal text-stone-500"> — {item.book}</span>
        </p>
        <p className="mt-1 max-w-2xl leading-relaxed">{item.blurb}</p>
        <p className="mt-2 text-xs text-stone-500">
          {item.width.toLocaleString()} × {item.height.toLocaleString()} px master ·{' '}
          <a
            href={item.source}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-700"
          >
            source record
          </a>
        </p>
      </div>
    </div>
  );
}

function ControlButton({
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
      className="flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-black/45 text-lg leading-none text-stone-100 backdrop-blur-sm transition-colors hover:bg-black/65"
    >
      {children}
    </button>
  );
}
