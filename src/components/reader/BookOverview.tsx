'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getPageThumbUrl } from '@/lib/utils';

interface OverviewPage {
  id: string;
  page_number: number;
  photo?: string;
  photo_original?: string;
  archived_photo?: string;
  cropped_photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  split_from_spread?: boolean;
  crop?: { xStart?: number; xEnd?: number };
  display_photo?: string;
}

interface BookOverviewProps {
  bookId: string;
  bookSlug?: string;
  bookTitle?: string;
  pages: OverviewPage[];
}

export default function BookOverview({ bookId, bookSlug, bookTitle, pages }: BookOverviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoveredPage, setHoveredPage] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const router = useRouter();

  const bookPath = `/book/${bookSlug || bookId}`;

  // Filter to pages that have images — memoize to stabilize reference
  const pagesWithImages = useMemo(() =>
    pages.filter(p => getPageThumbUrl(p as Record<string, any>) !== null),
    [pages],
  );

  const initViewer = useCallback(async () => {
    if (!containerRef.current || pagesWithImages.length === 0) return;

    const OpenSeadragon = (await import('openseadragon')).default;

    // Clean up any existing viewer
    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }

    // Calculate grid layout for collection mode
    const cols = Math.min(Math.ceil(Math.sqrt(pagesWithImages.length * 1.5)), 12);
    const rows = Math.ceil(pagesWithImages.length / cols);

    const tileSources = pagesWithImages.map((page) => {
      const thumbUrl = getPageThumbUrl(page as Record<string, any>);
      return {
        type: 'image' as const,
        url: thumbUrl!,
      };
    });

    const viewer = OpenSeadragon({
      element: containerRef.current,
      tileSources: tileSources as any,
      showNavigationControl: false,
      showNavigator: false,
      showSequenceControl: false,
      showZoomControl: false,
      showHomeControl: false,
      showFullPageControl: false,
      collectionMode: true,
      collectionRows: rows,
      collectionColumns: cols,
      collectionTileSize: 256,
      collectionTileMargin: 16,
      defaultZoomLevel: 0,
      minZoomLevel: 0.1,
      maxZoomLevel: 10,
      visibilityRatio: 0.3,
      constrainDuringPan: false,
      animationTime: 0.3,
      springStiffness: 10,
      gestureSettingsMouse: {
        clickToZoom: false,
        dblClickToZoom: true,
        scrollToZoom: true,
      },
      gestureSettingsTouch: {
        pinchToZoom: true,
        dblClickToZoom: true,
        flickEnabled: true,
      },
      // Crossfade for smooth loading
      placeholderFillStyle: '#1a1a1a',
      crossOriginPolicy: 'Anonymous',
      loadTilesWithAjax: false,
    });

    viewerRef.current = viewer;

    // Track zoom level
    viewer.addHandler('zoom', (event: any) => {
      setZoomLevel(event.zoom);
    });

    // Track loading
    viewer.addHandler('open', () => {
      setLoading(false);
    });

    // After a short delay, mark as loaded (collection mode doesn't always fire 'open')
    setTimeout(() => setLoading(false), 1500);

    // Add click handler — find which page was clicked
    viewer.addHandler('canvas-click', (event: any) => {
      // Don't handle if it was a drag
      if (event.quick) {
        const viewportPoint = viewer.viewport.pointFromPixel(event.position);

        // Find which item was clicked by checking bounds
        const tiledImage = viewer.world.getItemCount();
        for (let i = 0; i < tiledImage; i++) {
          const item = viewer.world.getItemAt(i);
          if (item) {
            const bounds = item.getBounds();
            if (viewportPoint.x >= bounds.x &&
                viewportPoint.x <= bounds.x + bounds.width &&
                viewportPoint.y >= bounds.y &&
                viewportPoint.y <= bounds.y + bounds.height) {
              const page = pagesWithImages[i];
              if (page) {
                router.push(`${bookPath}/page/${page.id}`);
              }
              break;
            }
          }
        }
      }
    });

    // Mouse move for hover tooltip
    (viewer as any).addHandler('canvas-move', (event: any) => {
      // Not available in touch
      if (!event.position) return;
      const viewportPoint = viewer.viewport.pointFromPixel(event.position);

      let found = false;
      const itemCount = viewer.world.getItemCount();
      for (let i = 0; i < itemCount; i++) {
        const item = viewer.world.getItemAt(i);
        if (item) {
          const bounds = item.getBounds();
          if (viewportPoint.x >= bounds.x &&
              viewportPoint.x <= bounds.x + bounds.width &&
              viewportPoint.y >= bounds.y &&
              viewportPoint.y <= bounds.y + bounds.height) {
            setHoveredPage(pagesWithImages[i]?.page_number ?? null);
            setTooltipPos({
              x: event.position.x + (containerRef.current?.getBoundingClientRect().left ?? 0),
              y: event.position.y + (containerRef.current?.getBoundingClientRect().top ?? 0),
            });
            found = true;
            break;
          }
        }
      }
      if (!found) {
        setHoveredPage(null);
      }
    });

    // Clear hover on exit
    (viewer as any).addHandler('canvas-exit', () => {
      setHoveredPage(null);
    });
  }, [pagesWithImages, bookPath, router]);

  useEffect(() => {
    initViewer();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [initViewer]);

  const handleZoomIn = () => {
    viewerRef.current?.viewport.zoomBy(1.5);
  };

  const handleZoomOut = () => {
    viewerRef.current?.viewport.zoomBy(0.67);
  };

  const handleFitAll = () => {
    viewerRef.current?.viewport.goHome();
  };

  return (
    <div className="relative w-full h-[calc(100vh-56px)] bg-[#0a0a0a]">
      {/* Page count — top-left */}
      <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full
        bg-black/60 backdrop-blur-md border border-white/10 text-white/70 text-sm
        pointer-events-none select-none">
        {pagesWithImages.length} pages
      </div>

      {/* Book title — top-center */}
      {bookTitle && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full
          bg-black/60 backdrop-blur-md border border-white/10 text-white/80 text-sm
          pointer-events-none select-none max-w-[60vw] truncate">
          {bookTitle}
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0a0a]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            <span className="text-white/50 text-sm">Loading {pagesWithImages.length} pages...</span>
          </div>
        </div>
      )}

      {/* OSD container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ cursor: hoveredPage !== null ? 'pointer' : 'grab' }}
      />

      {/* Hover tooltip */}
      {hoveredPage !== null && (
        <div
          className="fixed z-50 px-2 py-1 rounded bg-black/80 backdrop-blur-sm
            border border-white/20 text-white text-xs pointer-events-none
            -translate-x-1/2 -translate-y-full"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y - 12,
          }}
        >
          Page {hoveredPage}
        </div>
      )}

      {/* Zoom controls — bottom-right pill */}
      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-1
        bg-black/60 backdrop-blur-md border border-white/10 rounded-full
        px-1 py-1 shadow-lg">
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 flex items-center justify-center rounded-full
            text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Zoom out"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <span className="text-white/50 text-xs w-10 text-center tabular-nums select-none">
          {Math.round(zoomLevel * 100)}%
        </span>

        <button
          onClick={handleZoomIn}
          className="w-8 h-8 flex items-center justify-center rounded-full
            text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Zoom in"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <div className="w-px h-5 bg-white/10" />

        <button
          onClick={handleFitAll}
          className="w-8 h-8 flex items-center justify-center rounded-full
            text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Fit all pages"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 5h6v6H5z" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" />
          </svg>
        </button>
      </div>

      {/* Back link — bottom-left */}
      <a
        href={bookPath}
        className="absolute bottom-6 left-6 z-20 flex items-center gap-2 px-3 py-1.5
          bg-black/60 backdrop-blur-md border border-white/10 rounded-full
          text-white/70 hover:text-white text-sm transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to book
      </a>
    </div>
  );
}
