'use client';

/**
 * Deep-zoom fullscreen overlay (issue #2411, phase 3).
 *
 * A single-image OpenSeadragon viewer shown over the artwork hero when the book
 * has a verified `deepzoom` tile-pyramid manifest. Tiles are streamed from R2
 * (`images.sourcelibrary.org/<prefix>/...`) as plain <img> requests via an
 * inline DZI descriptor — no `.dzi` XHR and no CORS dependency, so it loads
 * under the existing img-src CSP. We deliberately do NOT set crossOriginPolicy:
 * R2 tiles carry no ACAO header and a tainted canvas is fine for display-only
 * (see memory: lesson_osd_cors_tainted_canvas — the classic blank-canvas trap).
 *
 * OpenSeadragon (BSD-3-Clause) is dynamically imported so its ~bundle weight
 * only loads when a reader actually opens deep zoom — never in the shared chunk.
 */

import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Home, Loader2 } from 'lucide-react';
import type { DeepZoomManifest } from '@/lib/types/book';

const R2_BASE = 'https://images.sourcelibrary.org';

interface DeepZoomOverlayProps {
  manifest: DeepZoomManifest;
  title: string;
  caption?: string;
  onClose: () => void;
  /**
   * Open framed on a sub-region instead of the whole page (#2714) — used by the
   * gallery to land on the illustration. Normalized 0-1 against the MASTER, not
   * the page-source image; on a split scan those differ, so callers must pass
   * the output of `remapBboxToMaster`, never a raw `gallery_images.bbox`.
   */
  initialBounds?: { x: number; y: number; width: number; height: number } | null;
}

// Inline DZI ("Deep Zoom Image") descriptor. OpenSeadragon's bundled types model
// this imperfectly, so we hand back a plain tile-source object.
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

/**
 * Breathing room left around a focused region, as a fraction of its size, so the
 * illustration doesn't sit edge-to-edge against the viewport.
 */
const FOCUS_PADDING = 0.06;

/**
 * The focused region as an OSD viewport rectangle, padded — or null when there
 * is nothing to focus (whole-page usage, e.g. ArtworkHero).
 *
 * Converts via `imageToViewportRectangle` with PIXEL coordinates rather than by
 * hand: OSD's viewport is normalized by image WIDTH, so feeding it normalized
 * y/height directly is the classic silent vertical-offset bug.
 *
 * Module-level and pure so the viewer effect can call it without taking a
 * changing function identity as a dependency.
 */
function focusRect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewer: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OpenSeadragon: any,
  bounds: { x: number; y: number; width: number; height: number } | null | undefined,
  manifest: DeepZoomManifest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  if (!bounds || !viewer?.viewport || !OpenSeadragon?.Rect) return null;
  const padX = bounds.width * FOCUS_PADDING;
  const padY = bounds.height * FOCUS_PADDING;
  return viewer.viewport.imageToViewportRectangle(
    new OpenSeadragon.Rect(
      Math.max(0, bounds.x - padX) * manifest.width,
      Math.max(0, bounds.y - padY) * manifest.height,
      Math.min(1, bounds.width + padX * 2) * manifest.width,
      Math.min(1, bounds.height + padY * 2) * manifest.height,
    ),
  );
}

/** Frame the focused region. False when there was nothing to focus. */
function fitToBounds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewer: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OpenSeadragon: any,
  bounds: { x: number; y: number; width: number; height: number } | null | undefined,
  manifest: DeepZoomManifest,
  immediate: boolean,
): boolean {
  const rect = focusRect(viewer, OpenSeadragon, bounds, manifest);
  if (!rect) return false;
  viewer.viewport.fitBounds(rect, immediate);
  return true;
}

/**
 * Keep the visible viewport inside the focused region.
 *
 * Pinning `minZoomLevel` alone is not enough: at the minimum zoom the viewport
 * is exactly the size of the illustration, but nothing stops the reader panning
 * that window across the rest of the page scan. The tile source is the whole
 * PAGE (pyramids are built per page, never per illustration — see
 * `deepzoom-tile-pages.mjs`), so without this the surrounding text is reachable.
 *
 * Pans rather than fits, so clamping can never alter the zoom and start a
 * feedback loop with the zoom constraint.
 */
function clampPanToFocus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewer: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OpenSeadragon: any,
  bounds: { x: number; y: number; width: number; height: number } | null | undefined,
  manifest: DeepZoomManifest,
): void {
  const rect = focusRect(viewer, OpenSeadragon, bounds, manifest);
  if (!rect) return;
  const vp = viewer.viewport;
  const view = vp.getBounds();

  // Allowed centre range per axis. When the view is wider than the region there
  // is no room to move, so centre it.
  const axis = (viewStart: number, viewSize: number, regionStart: number, regionSize: number) => {
    const half = Math.min(viewSize, regionSize) / 2;
    const lo = regionStart + half;
    const hi = regionStart + regionSize - half;
    const centre = viewStart + viewSize / 2;
    if (lo > hi) return regionStart + regionSize / 2;
    return Math.min(Math.max(centre, lo), hi);
  };

  const cx = axis(view.x, view.width, rect.x, rect.width);
  const cy = axis(view.y, view.height, rect.y, rect.height);
  const centre = vp.getCenter(true);
  // Sub-pixel drift would thrash panTo on every frame.
  if (Math.abs(cx - centre.x) < 1e-6 && Math.abs(cy - centre.y) < 1e-6) return;
  vp.panTo(new OpenSeadragon.Point(cx, cy), true);
}

export default function DeepZoomOverlay({
  manifest,
  title,
  caption,
  onClose,
  initialBounds = null,
}: DeepZoomOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const osdRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Held in a ref, not an effect dep: callers build this object inline, so a new
  // identity every render would tear down and rebuild the whole viewer.
  const boundsRef = useRef(initialBounds);
  boundsRef.current = initialBounds;

  useEffect(() => {
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any;

    import('openseadragon')
      .then((mod) => {
        // UMD interop: factory may sit on .default or the module root.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const OpenSeadragon = ((mod as any).default ?? mod) as any;
        if (disposed || !containerRef.current) return;
        viewer = OpenSeadragon({
          element: containerRef.current,
          tileSources: tileSourceFor(manifest),
          showNavigationControl: false,
          showNavigator: true,
          navigatorPosition: 'BOTTOM_RIGHT',
          navigatorHeight: 88,
          navigatorWidth: 118,
          navigatorBorderColor: 'rgba(255,255,255,0.25)',
          navigatorBackground: 'rgba(0,0,0,0.55)',
          navigatorAutoFade: true,
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
          gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true },
          animationTime: 0.8,
          springStiffness: 7,
          minZoomImageRatio: 0.8,
          // Never magnify past native into mush — 1:1 keeps every level real detail.
          maxZoomPixelRatio: 1.0,
          visibilityRatio: 1,
          constrainDuringPan: true,
          zoomPerScroll: 1.4,
          immediateRender: false,
        });
        viewerRef.current = viewer;
        osdRef.current = OpenSeadragon;
        viewer.addHandler('open', () => {
          if (disposed) return;
          // Frame the region before the first paint (immediate = no fly-in from
          // the whole page), so the gallery lands on the illustration.
          if (fitToBounds(viewer, OpenSeadragon, boundsRef.current, manifest, true)) {
            // The illustration is now the OUTERMOST view: the pyramid covers the
            // whole page scan, and without a floor the reader could zoom out to
            // the surrounding text. `minZoomLevel` wins over `minZoomImageRatio`
            // in OSD's getMinZoom(), so this supersedes the 0.8 set above.
            viewer.viewport.minZoomLevel = viewer.viewport.getZoom(true);
            viewer.addHandler('viewport-change', () => {
              if (disposed) return;
              clampPanToFocus(viewer, OpenSeadragon, boundsRef.current, manifest);
            });
            // The floor is an absolute zoom value, so a viewport resize would
            // leave it stale (the region no longer fits at the old zoom).
            viewer.addHandler('resize', () => {
              if (disposed) return;
              viewer.viewport.minZoomLevel = null;
              if (fitToBounds(viewer, OpenSeadragon, boundsRef.current, manifest, true)) {
                viewer.viewport.minZoomLevel = viewer.viewport.getZoom(true);
              }
            });
          }
          setReady(true);
        });
        viewer.addHandler('open-failed', () => !disposed && setFailed(true));
      })
      .catch(() => !disposed && setFailed(true));

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

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const zoomBy = (factor: number) => {
    const v = viewerRef.current;
    if (!v) return;
    v.viewport.zoomBy(factor);
    v.viewport.applyConstraints();
  };
  // "Home" means where the reader started. When the gallery opened us framed on
  // an illustration, that's the illustration — not the whole page scan.
  const home = () => {
    const v = viewerRef.current;
    if (!v) return;
    if (!fitToBounds(v, osdRef.current, boundsRef.current, manifest, false)) {
      v.viewport.goHome();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#0b0a09]">
      <div ref={containerRef} className="absolute inset-0" />

      {!ready && !failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-stone-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-sm">Loading deep zoom…</span>
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-stone-300">
          <span className="text-sm">Deep zoom couldn’t load.</span>
          <button onClick={onClose} className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
            Close
          </button>
        </div>
      )}

      {/* Close */}
      <button
        onClick={onClose}
        aria-label="Close deep zoom"
        title="Close (Esc)"
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-stone-100 transition-colors hover:bg-black/80"
      >
        <X className="h-5 w-5" />
      </button>

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
      </div>

      {/* Caption */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-0.5 text-xs text-stone-400">
          {manifest.width.toLocaleString()} × {manifest.height.toLocaleString()} px
          {caption ? ` · ${caption}` : ''} · scroll / pinch to zoom, drag to pan
        </p>
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
      className="flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-stone-100 transition-colors hover:bg-black/80"
    >
      {children}
    </button>
  );
}
