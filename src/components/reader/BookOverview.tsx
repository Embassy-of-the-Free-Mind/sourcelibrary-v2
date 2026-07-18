'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

export interface OverviewPage {
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
  has_illustration?: boolean;
}

interface BookOverviewProps {
  bookId: string;
  bookSlug?: string;
  bookTitle?: string;
  pages: OverviewPage[];
  /** When provided, renders a "Contents" button that switches back to the grid view */
  onShowContents?: () => void;
}

// Two-tier image URLs: fast thumbnail for overview, mid-res for zoom.
// Split-page handling MUST come first — page.photo and page.archived_photo
// both point at the full uncropped spread for split pages, so falling
// through to them renders the wrong image. cropped_photo is the half-page
// crop and is the canonical source for split pages.
export function getThumbUrl(page: OverviewPage): string | null {
  if (page.split_from_spread || page.crop) {
    return page.thumbnail_blob || page.cropped_photo || null;
  }
  if (page.thumbnail_blob) return page.thumbnail_blob;
  if (page.thumbnail) return page.thumbnail;
  if (page.archived_photo) return page.archived_photo;
  if (page.photo) return page.photo;
  return null;
}

// display_photo (the reader's display copy, a few hundred KB) comes first —
// the archival master (archived_photo, multi-MB at native res) is overkill
// for overview zoom and saturates bandwidth when several pages load at once.
function getHiresUrl(page: OverviewPage): string | null {
  if (page.split_from_spread || page.crop) {
    return page.cropped_photo || page.photo || null;
  }
  if (page.display_photo) return page.display_photo;
  if (page.archived_photo) return page.archived_photo;
  if (page.cropped_photo) return page.cropped_photo;
  if (page.photo_original) return page.photo_original;
  if (page.photo) return page.photo;
  return null;
}

// Layout constants — world-space sizes (large so hi-res images render crisply when zoomed)
const THUMB_W = 400;
const THUMB_H = 560;
const GAP = 24;
const MAX_ZOOM = 2;
const ZOOM_SPEED = 0.002;

// Hi-res loading policy: fetch only after the camera has settled, only for
// cells that are actually large on screen, nearest-to-center first, a few at
// a time, cancelling anything that is no longer relevant to the viewport.
const HIRES_MIN_CELL_PX = 350; // on-screen cell width before hi-res is worth fetching
const HIRES_SETTLE_MS = 150; // camera must be still this long before hi-res loads start
const HIRES_CONCURRENCY = 3;

export default function BookOverview({ bookId, bookSlug, bookTitle, pages, onShowContents }: BookOverviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Book URLs are tenant-agnostic — the proxy resolves the tenant. No prefix here.

  // Camera state (not React state — updated every frame)
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);

  // Interaction state
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [hoveredPage, setHoveredPage] = useState<number | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [loadedCount, setLoadedCount] = useState(0);
  // Viewport aspect ratio drives the column count so the grid fills the screen
  const [viewAspect, setViewAspect] = useState(1.5);

  // Image caches. imageCache holds finished loads; inflightHires holds
  // cancellable in-progress hi-res requests; hiresQueue is center-out ordered.
  const imageCache = useRef<Map<string, HTMLImageElement | 'loading' | 'error'>>(new Map());
  const inflightHires = useRef<Map<string, HTMLImageElement>>(new Map());
  const hiresQueue = useRef<string[]>([]);
  const lastCamMoveRef = useRef(0);
  const hiresPlannedRef = useRef(false);

  // Filter pages with images
  const pagesWithImages = useMemo(() =>
    pages.filter(p => getThumbUrl(p) !== null),
    [pages],
  );

  // Compute grid layout — column count matches the viewport aspect so the
  // fit-all view fills the screen instead of letterboxing.
  const layout = useMemo(() => {
    const count = pagesWithImages.length;
    const cellW = THUMB_W + GAP;
    const cellH = THUMB_H + GAP;
    const ideal = Math.round(Math.sqrt(count * viewAspect * (cellH / cellW)));
    const cols = Math.max(1, Math.min(count, ideal));
    const rows = Math.ceil(count / cols);
    const totalW = cols * cellW;
    const totalH = rows * cellH;

    return { cols, rows, cellW, cellH, totalW, totalH };
  }, [pagesWithImages, viewAspect]);

  // Calculate initial zoom to fit all content
  const getHomeZoom = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const dpr = window.devicePixelRatio || 1;
    const scaleX = canvas.width / dpr / (layout.totalW + GAP * 2);
    const scaleY = canvas.height / dpr / (layout.totalH + GAP * 2);
    return Math.min(scaleX, scaleY, 1);
  }, [layout]);

  // Load a thumbnail immediately — they're a few KB each.
  const loadThumb = useCallback((url: string) => {
    if (imageCache.current.has(url)) return;
    imageCache.current.set(url, 'loading');
    const img = new Image();
    // No crossOrigin — R2 doesn't send CORS headers, and we don't need canvas pixel reads
    img.onload = () => {
      imageCache.current.set(url, img);
      setLoadedCount(c => c + 1);
      dirtyRef.current = true;
    };
    img.onerror = () => {
      imageCache.current.set(url, 'error');
    };
    img.src = url;
  }, []);

  // Start queued hi-res loads up to the concurrency cap.
  const pumpHires = useCallback(() => {
    while (inflightHires.current.size < HIRES_CONCURRENCY && hiresQueue.current.length > 0) {
      const url = hiresQueue.current.shift()!;
      if (imageCache.current.has(url) || inflightHires.current.has(url)) continue;
      const img = new Image();
      inflightHires.current.set(url, img);
      img.onload = () => {
        inflightHires.current.delete(url);
        imageCache.current.set(url, img);
        dirtyRef.current = true;
        pumpHires();
      };
      img.onerror = () => {
        inflightHires.current.delete(url);
        imageCache.current.set(url, 'error');
        pumpHires();
      };
      img.src = url;
    }
  }, []);

  // Decide which hi-res images the settled viewport actually needs:
  // visible cells above the size threshold, nearest to viewport center first.
  // Cancels in-flight loads that no longer qualify.
  const planHiresLoads = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = camRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    const desired: { url: string; d: number }[] = [];
    if (THUMB_W * cam.zoom >= HIRES_MIN_CELL_PX) {
      const vpLeft = cam.x - w / (2 * cam.zoom);
      const vpRight = cam.x + w / (2 * cam.zoom);
      const vpTop = cam.y - h / (2 * cam.zoom);
      const vpBottom = cam.y + h / (2 * cam.zoom);
      const colStart = Math.max(0, Math.floor(vpLeft / layout.cellW));
      const colEnd = Math.min(layout.cols - 1, Math.ceil(vpRight / layout.cellW));
      const rowStart = Math.max(0, Math.floor(vpTop / layout.cellH));
      const rowEnd = Math.min(layout.rows - 1, Math.ceil(vpBottom / layout.cellH));

      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const idx = row * layout.cols + col;
          if (idx >= pagesWithImages.length) continue;
          const page = pagesWithImages[idx];
          const hiresUrl = getHiresUrl(page);
          if (!hiresUrl || hiresUrl === getThumbUrl(page)) continue;
          if (imageCache.current.has(hiresUrl)) continue;
          const cx = col * layout.cellW + THUMB_W / 2;
          const cy = row * layout.cellH + THUMB_H / 2;
          const d = (cx - cam.x) ** 2 + (cy - cam.y) ** 2;
          desired.push({ url: hiresUrl, d });
        }
      }
    }

    desired.sort((a, b) => a.d - b.d);
    const desiredSet = new Set(desired.map(x => x.url));

    // Abort in-flight loads the viewport no longer needs
    for (const [url, img] of inflightHires.current) {
      if (!desiredSet.has(url)) {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        inflightHires.current.delete(url);
      }
    }

    hiresQueue.current = desired.map(x => x.url).filter(u => !inflightHires.current.has(u));
    pumpHires();
  }, [layout, pagesWithImages, pumpHires]);

  // Hit test — which page index is at screen position (sx, sy)?
  const hitTest = useCallback((sx: number, sy: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const dpr = window.devicePixelRatio || 1;
    const cam = camRef.current;
    // Screen → world coords
    const wx = (sx - canvas.width / dpr / 2) / cam.zoom + cam.x;
    const wy = (sy - canvas.height / dpr / 2) / cam.zoom + cam.y;
    // Which cell?
    const col = Math.floor(wx / layout.cellW);
    const row = Math.floor(wy / layout.cellH);
    if (col < 0 || row < 0 || col >= layout.cols) return -1;
    const idx = row * layout.cols + col;
    if (idx < 0 || idx >= pagesWithImages.length) return -1;
    // Check within the thumbnail (not the gap)
    const localX = wx - col * layout.cellW;
    const localY = wy - row * layout.cellH;
    if (localX < 0 || localX > THUMB_W || localY < 0 || localY > THUMB_H) return -1;
    return idx;
  }, [layout, pagesWithImages.length]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirtyRef.current = true;
      const a = container.clientWidth / Math.max(1, container.clientHeight);
      setViewAspect(prev => (Math.abs(prev - a) > 0.05 ? a : prev));
    };
    resize();

    // Set initial camera to center the grid
    const homeZoom = getHomeZoom();
    const minZoom = homeZoom * 0.9;
    camRef.current = {
      x: layout.totalW / 2,
      y: layout.totalH / 2,
      zoom: homeZoom,
    };
    setZoomPercent(100);

    // Any camera movement defers hi-res loading until the view settles
    const touchCamera = () => {
      lastCamMoveRef.current = performance.now();
      hiresPlannedRef.current = false;
      dirtyRef.current = true;
    };

    const render = () => {
      // Settle detection runs every frame, even when nothing is dirty
      if (!hiresPlannedRef.current && performance.now() - lastCamMoveRef.current > HIRES_SETTLE_MS) {
        hiresPlannedRef.current = true;
        planHiresLoads();
      }

      if (!dirtyRef.current) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      dirtyRef.current = false;

      const cam = camRef.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // Viewport bounds in world coords
      const vpLeft = cam.x - w / (2 * cam.zoom);
      const vpRight = cam.x + w / (2 * cam.zoom);
      const vpTop = cam.y - h / (2 * cam.zoom);
      const vpBottom = cam.y + h / (2 * cam.zoom);

      // Only render visible cells
      const colStart = Math.max(0, Math.floor(vpLeft / layout.cellW));
      const colEnd = Math.min(layout.cols - 1, Math.ceil(vpRight / layout.cellW));
      const rowStart = Math.max(0, Math.floor(vpTop / layout.cellH));
      const rowEnd = Math.min(layout.rows - 1, Math.ceil(vpBottom / layout.cellH));

      ctx.save();
      // Transform: world → screen
      ctx.translate(w / 2, h / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const idx = row * layout.cols + col;
          if (idx >= pagesWithImages.length) continue;

          const page = pagesWithImages[idx];
          const px = col * layout.cellW;
          const py = row * layout.cellH;
          const thumbUrl = getThumbUrl(page)!;
          const hiresUrl = getHiresUrl(page);

          // Draw placeholder
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(px, py, THUMB_W, THUMB_H);

          // Thumbnails load eagerly (a few KB each); hi-res only ever loads
          // via planHiresLoads after the camera settles — never from here.
          let drawImg: HTMLImageElement | null = null;
          const thumbCached = imageCache.current.get(thumbUrl);
          if (!thumbCached) {
            loadThumb(thumbUrl);
          } else if (thumbCached instanceof HTMLImageElement) {
            drawImg = thumbCached;
          }

          // Use hi-res whenever it has already arrived
          if (hiresUrl && hiresUrl !== thumbUrl) {
            const hiresCached = imageCache.current.get(hiresUrl);
            if (hiresCached instanceof HTMLImageElement) {
              drawImg = hiresCached;
            }
          }

          if (drawImg) {
            // Draw maintaining aspect ratio, centered in cell
            const imgAR = drawImg.naturalWidth / drawImg.naturalHeight;
            const cellAR = THUMB_W / THUMB_H;
            let dw: number, dh: number, dx: number, dy: number;
            if (imgAR > cellAR) {
              dw = THUMB_W;
              dh = THUMB_W / imgAR;
              dx = px;
              dy = py + (THUMB_H - dh) / 2;
            } else {
              dh = THUMB_H;
              dw = THUMB_H * imgAR;
              dx = px + (THUMB_W - dw) / 2;
              dy = py;
            }
            ctx.drawImage(drawImg, dx, dy, dw, dh);
          }

          // Page number label — only show when zoomed in enough to read
          if (cam.zoom > 0.08) {
            const fontSize = Math.min(20, Math.max(10, 14 / Math.max(cam.zoom, 0.1)));
            ctx.font = `${fontSize}px system-ui, sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.textAlign = 'center';
            ctx.fillText(`${page.page_number}`, px + THUMB_W / 2, py + THUMB_H + fontSize + 2);
          }
        }
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    // --- Interaction handlers ---
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      const delta = -e.deltaY * ZOOM_SPEED;
      const newZoom = Math.min(MAX_ZOOM, Math.max(minZoom, cam.zoom * (1 + delta)));

      // Zoom toward cursor
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - canvas.width / dpr / 2) / cam.zoom + cam.x;
      const wy = (my - canvas.height / dpr / 2) / cam.zoom + cam.y;

      cam.x = wx - (mx - canvas.width / dpr / 2) / newZoom;
      cam.y = wy - (my - canvas.height / dpr / 2) / newZoom;
      cam.zoom = newZoom;

      setZoomPercent(Math.round((newZoom / homeZoom) * 100));
      touchCamera();
    };

    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (dragRef.current) {
        const cam = camRef.current;
        const dx = (e.clientX - dragRef.current.sx) / cam.zoom;
        const dy = (e.clientY - dragRef.current.sy) / cam.zoom;
        cam.x = dragRef.current.cx - dx;
        cam.y = dragRef.current.cy - dy;
        touchCamera();
      } else {
        // Hover detection
        const idx = hitTest(sx, sy);
        if (idx >= 0) {
          setHoveredPage(pagesWithImages[idx].page_number);
          canvas.style.cursor = 'pointer';
        } else {
          setHoveredPage(null);
          canvas.style.cursor = 'grab';
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (dragRef.current) {
        const moved = Math.abs(e.clientX - dragRef.current.sx) + Math.abs(e.clientY - dragRef.current.sy);
        if (moved < 5) {
          // Click — navigate to page
          const rect = canvas.getBoundingClientRect();
          const sx = (e.clientX - rect.left);
          const sy = (e.clientY - rect.top);
          const idx = hitTest(sx, sy);
          if (idx >= 0) {
            const page = pagesWithImages[idx];
            const bookPath = `/book/${bookSlug || bookId}`;
            router.push(`${bookPath}/page/${page.id}`);
          }
        }
        dragRef.current = null;
        canvas.style.cursor = 'grab';
      }
    };

    const onMouseLeave = () => {
      dragRef.current = null;
      setHoveredPage(null);
      canvas.style.cursor = 'grab';
    };

    // Touch support
    let lastTouchDist = 0;
    let lastTouchCenter = { x: 0, y: 0 };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        dragRef.current = { sx: t.clientX, sy: t.clientY, cx: camRef.current.x, cy: camRef.current.y };
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        lastTouchCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
        dragRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragRef.current) {
        const t = e.touches[0];
        const cam = camRef.current;
        const dx = (t.clientX - dragRef.current.sx) / cam.zoom;
        const dy = (t.clientY - dragRef.current.sy) / cam.zoom;
        cam.x = dragRef.current.cx - dx;
        cam.y = dragRef.current.cy - dy;
        touchCamera();
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const center = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
        const cam = camRef.current;
        const newZoom = Math.min(MAX_ZOOM, Math.max(minZoom, cam.zoom * (dist / lastTouchDist)));

        // Zoom toward the pinch center and follow two-finger pan —
        // the world point between the fingers stays under them.
        const rect = canvas.getBoundingClientRect();
        const mx = center.x - rect.left;
        const my = center.y - rect.top;
        const wx = (mx - canvas.width / dpr / 2) / cam.zoom + cam.x;
        const wy = (my - canvas.height / dpr / 2) / cam.zoom + cam.y;
        cam.x = wx - (mx - canvas.width / dpr / 2) / newZoom - (center.x - lastTouchCenter.x) / newZoom;
        cam.y = wy - (my - canvas.height / dpr / 2) / newZoom - (center.y - lastTouchCenter.y) / newZoom;
        cam.zoom = newZoom;

        lastTouchDist = dist;
        lastTouchCenter = center;
        setZoomPercent(Math.round((cam.zoom / homeZoom) * 100));
        touchCamera();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 1 && dragRef.current) {
        const t = e.changedTouches[0];
        const moved = Math.abs(t.clientX - dragRef.current.sx) + Math.abs(t.clientY - dragRef.current.sy);
        if (moved < 10) {
          const rect = canvas.getBoundingClientRect();
          const sx = t.clientX - rect.left;
          const sy = t.clientY - rect.top;
          const idx = hitTest(sx, sy);
          if (idx >= 0) {
            const page = pagesWithImages[idx];
            const bookPath = `/book/${bookSlug || bookId}`;
            router.push(`${bookPath}/page/${page.id}`);
          }
        }
      }
      dragRef.current = null;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(container);

    const inflight = inflightHires.current;
    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      resizeObs.disconnect();
      // Abort any in-flight hi-res loads
      for (const [url, img] of inflight) {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        inflight.delete(url);
      }
      hiresQueue.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesWithImages, layout, getHomeZoom, hitTest, loadThumb, planHiresLoads]);

  const nudgeZoom = (factor: number) => {
    const cam = camRef.current;
    const homeZoom = getHomeZoom();
    cam.zoom = Math.min(MAX_ZOOM, Math.max(homeZoom * 0.9, cam.zoom * factor));
    setZoomPercent(Math.round((cam.zoom / homeZoom) * 100));
    lastCamMoveRef.current = performance.now();
    hiresPlannedRef.current = false;
    dirtyRef.current = true;
  };

  const handleFitAll = () => {
    const homeZoom = getHomeZoom();
    camRef.current = { x: layout.totalW / 2, y: layout.totalH / 2, zoom: homeZoom };
    setZoomPercent(100);
    lastCamMoveRef.current = performance.now();
    hiresPlannedRef.current = false;
    dirtyRef.current = true;
  };

  const bookPath = `/book/${bookSlug || bookId}`;

  return (
    <div ref={containerRef} className="relative w-full h-dvh bg-[#0a0a0a]">
      {/* Top bar: title + page count share one row so they can't overlap on mobile */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between gap-2
        pointer-events-none select-none">
        {bookTitle ? (
          <div className="px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md
            border border-white/10 text-white/80 text-sm truncate">
            {bookTitle}
          </div>
        ) : <div />}
        <div className="shrink-0 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md
          border border-white/10 text-white/70 text-sm">
          {pagesWithImages.length} pages
          {loadedCount < pagesWithImages.length && (
            <span className="text-white/40 ml-1.5">· {loadedCount} loaded</span>
          )}
        </div>
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: 'grab' }} />

      {/* Hover tooltip */}
      {hoveredPage !== null && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full
          bg-black/60 backdrop-blur-md border border-white/10 text-white/80 text-sm
          pointer-events-none select-none">
          Page {hoveredPage}
        </div>
      )}

      {/* Bottom-right controls */}
      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2">
      {onShowContents && (
        <button
          onClick={onShowContents}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
            bg-black/60 backdrop-blur-md border border-white/10
            text-white/70 hover:text-white text-sm transition-colors shadow-lg"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3.5h10M2 7h10M2 10.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Contents
        </button>
      )}
      {/* Zoom controls pill */}
      <div className="flex items-center gap-1
        bg-black/60 backdrop-blur-md border border-white/10 rounded-full
        px-1 py-1 shadow-lg">
        <button
          onClick={() => nudgeZoom(0.67)}
          className="w-8 h-8 flex items-center justify-center rounded-full
            text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Zoom out"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <span className="text-white/50 text-xs w-12 text-center tabular-nums select-none">
          {zoomPercent}%
        </span>

        <button
          onClick={() => nudgeZoom(1.5)}
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
