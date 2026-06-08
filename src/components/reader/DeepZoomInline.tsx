'use client';

/**
 * Inline deep-zoom viewer (issue #2411) — an OpenSeadragon tiled canvas that
 * fills its positioned parent, so a reader can zoom/pan a page scan *in place*
 * while the translation panel stays visible beside it. Used on desktop; mobile
 * uses the fullscreen DeepZoomOverlay instead (inline pan/zoom fights the
 * swipe-between-pages gesture on touch).
 *
 * OSD config is kept in sync with components/artwork/DeepZoomOverlay.tsx (the
 * fullscreen variant) — no crossOriginPolicy (R2 tiles have no ACAO; tainted
 * canvas is fine for display, see lesson_osd_cors_tainted_canvas) and
 * maxZoomPixelRatio 1.0 (never magnify past native).
 */

import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Home, Loader2 } from 'lucide-react';
import type { DeepZoomManifest } from '@/lib/types/book';

const R2_BASE = 'https://images.sourcelibrary.org';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tileSourceFor(m: DeepZoomManifest): any {
  return {
    Image: {
      xmlns: 'http://schemas.microsoft.com/deepzoom/2008',
      Url: `${R2_BASE}/${m.prefix}/`,
      Format: m.format,
      Overlap: String(m.overlap),
      TileSize: String(m.tile_size),
      Size: { Width: m.width, Height: m.height },
    },
  };
}

export default function DeepZoomInline({ manifest }: { manifest: DeepZoomManifest }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any;
    import('openseadragon')
      .then((mod) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const OpenSeadragon = ((mod as any).default ?? mod) as any;
        if (disposed || !containerRef.current) return;
        viewer = OpenSeadragon({
          element: containerRef.current,
          tileSources: tileSourceFor(manifest),
          showNavigationControl: false,
          showNavigator: false,
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
          gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true },
          animationTime: 0.8,
          springStiffness: 7,
          minZoomImageRatio: 0.9,
          maxZoomPixelRatio: 1.0,
          visibilityRatio: 1,
          constrainDuringPan: true,
          zoomPerScroll: 1.4,
          immediateRender: false,
        });
        viewerRef.current = viewer;
        viewer.addHandler('open', () => !disposed && setReady(true));
      })
      .catch(() => {});
    return () => {
      disposed = true;
      try {
        viewer?.destroy();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
  }, [manifest]);

  const zoomBy = (f: number) => {
    const v = viewerRef.current;
    if (!v) return;
    v.viewport.zoomBy(f);
    v.viewport.applyConstraints();
  };
  const home = () => viewerRef.current?.viewport.goHome();

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-stone-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs">Loading deep zoom…</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1.5">
        <Ctrl label="Zoom in" onClick={() => zoomBy(1.6)}>
          <ZoomIn className="h-4 w-4" />
        </Ctrl>
        <Ctrl label="Zoom out" onClick={() => zoomBy(1 / 1.6)}>
          <ZoomOut className="h-4 w-4" />
        </Ctrl>
        <Ctrl label="Reset view" onClick={home}>
          <Home className="h-4 w-4" />
        </Ctrl>
      </div>
    </div>
  );
}

function Ctrl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-stone-100 transition-colors hover:bg-black/80"
    >
      {children}
    </button>
  );
}
