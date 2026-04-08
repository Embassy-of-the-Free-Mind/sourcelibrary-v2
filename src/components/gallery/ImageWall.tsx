'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface WallImage {
  id: string;   // pageId-detectionIndex
  t: string;    // thumbnail_url
  w: number;    // extracted_width
  h: number;    // extracted_height
  b: string;    // book_title
  y?: number;   // book_year
  bi: string;   // book_id
  d?: string;   // description
}

interface ImageWallProps {
  /** If provided, skip the fetch */
  initialData?: { images: WallImage[]; total: number };
}

// Layout constants — world-space
const CELL_W = 100;
const CELL_H = 140;
const GAP = 4;
const CELL_TOTAL_W = CELL_W + GAP;
const CELL_TOTAL_H = CELL_H + GAP;

// Zoom
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 3;
const ZOOM_SPEED = 0.002;

// Image memory management
const MAX_LOADED_IMAGES = 500;

export default function ImageWall({ initialData }: ImageWallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Data
  const [images, setImages] = useState<WallImage[]>(initialData?.images ?? []);
  const [totalInDb, setTotalInDb] = useState(initialData?.total ?? 0);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  // Camera (mutable ref for 60fps)
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);

  // Interaction
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [hoveredImage, setHoveredImage] = useState<WallImage | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [loadedCount, setLoadedCount] = useState(0);

  // Image cache with LRU eviction
  // Key = thumbnail URL, Value = { img, lastUsed (frame counter) }
  const imageCacheRef = useRef<Map<string, { img: HTMLImageElement; lastUsed: number }>>(new Map());
  const loadingSetRef = useRef<Set<string>>(new Set());
  const frameCountRef = useRef(0);

  // Fetch manifest
  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/gallery/wall')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        setImages(data.images);
        setTotalInDb(data.total);
        setLoading(false);
        dirtyRef.current = true;
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [initialData]);

  // Grid layout
  const layout = useMemo(() => {
    const count = images.length;
    if (count === 0) return { cols: 0, rows: 0, totalW: 0, totalH: 0 };
    const cols = Math.min(Math.ceil(Math.sqrt(count * (CELL_W / CELL_H))), 200);
    const rows = Math.ceil(count / cols);
    const totalW = cols * CELL_TOTAL_W;
    const totalH = rows * CELL_TOTAL_H;
    return { cols, rows, totalW, totalH };
  }, [images]);

  // Home zoom
  const getHomeZoom = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || layout.totalW === 0) return 1;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const scaleX = w / (layout.totalW + GAP * 4);
    const scaleY = h / (layout.totalH + GAP * 4);
    return Math.min(scaleX, scaleY, 1);
  }, [layout]);

  // Load image with eviction
  const loadImage = useCallback((url: string) => {
    const cache = imageCacheRef.current;
    const loadingSet = loadingSetRef.current;

    if (cache.has(url) || loadingSet.has(url)) return;

    // Evict if at capacity — remove the entry with the smallest lastUsed
    if (cache.size >= MAX_LOADED_IMAGES) {
      let oldestKey: string | null = null;
      let oldestFrame = Infinity;
      for (const [key, entry] of cache) {
        if (entry.lastUsed < oldestFrame) {
          oldestFrame = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        const entry = cache.get(oldestKey);
        if (entry) {
          // Help GC by clearing the src
          entry.img.src = '';
        }
        cache.delete(oldestKey);
      }
    }

    loadingSet.add(url);
    const img = new Image();
    img.onload = () => {
      loadingSet.delete(url);
      cache.set(url, { img, lastUsed: frameCountRef.current });
      setLoadedCount(c => c + 1);
      dirtyRef.current = true;
    };
    img.onerror = () => {
      loadingSet.delete(url);
    };
    img.src = url;
  }, []);

  // Hit test
  const hitTest = useCallback((sx: number, sy: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return -1;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cam = camRef.current;

    // Screen -> world
    const wx = (sx - w / 2) / cam.zoom + cam.x;
    const wy = (sy - h / 2) / cam.zoom + cam.y;

    const col = Math.floor(wx / CELL_TOTAL_W);
    const row = Math.floor(wy / CELL_TOTAL_H);
    if (col < 0 || row < 0 || col >= layout.cols) return -1;
    const idx = row * layout.cols + col;
    if (idx < 0 || idx >= images.length) return -1;

    // Check within the cell (not gap)
    const localX = wx - col * CELL_TOTAL_W;
    const localY = wy - row * CELL_TOTAL_H;
    if (localX < 0 || localX > CELL_W || localY < 0 || localY > CELL_H) return -1;
    return idx;
  }, [images.length, layout.cols]);

  // Main render loop + event handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || images.length === 0) return;

    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirtyRef.current = true;
    };
    resize();

    // Set initial camera
    const homeZoom = getHomeZoom();
    camRef.current = {
      x: layout.totalW / 2,
      y: layout.totalH / 2,
      zoom: homeZoom,
    };
    setZoomPercent(100);
    dirtyRef.current = true;

    const render = () => {
      if (!dirtyRef.current) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      dirtyRef.current = false;
      frameCountRef.current++;

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

      // Visible cell range
      const colStart = Math.max(0, Math.floor(vpLeft / CELL_TOTAL_W));
      const colEnd = Math.min(layout.cols - 1, Math.ceil(vpRight / CELL_TOTAL_W));
      const rowStart = Math.max(0, Math.floor(vpTop / CELL_TOTAL_H));
      const rowEnd = Math.min(layout.rows - 1, Math.ceil(vpBottom / CELL_TOTAL_H));

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      const cache = imageCacheRef.current;
      const frame = frameCountRef.current;

      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const idx = row * layout.cols + col;
          if (idx >= images.length) continue;

          const img = images[idx];
          const px = col * CELL_TOTAL_W;
          const py = row * CELL_TOTAL_H;

          // Placeholder
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(px, py, CELL_W, CELL_H);

          const cached = cache.get(img.t);
          if (cached) {
            // Update LRU timestamp
            cached.lastUsed = frame;

            // Draw maintaining aspect ratio, centered
            const imgAR = cached.img.naturalWidth / cached.img.naturalHeight;
            const cellAR = CELL_W / CELL_H;
            let dw: number, dh: number, dx: number, dy: number;
            if (imgAR > cellAR) {
              dw = CELL_W;
              dh = CELL_W / imgAR;
              dx = px;
              dy = py + (CELL_H - dh) / 2;
            } else {
              dh = CELL_H;
              dw = CELL_H * imgAR;
              dx = px + (CELL_W - dw) / 2;
              dy = py;
            }
            ctx.drawImage(cached.img, dx, dy, dw, dh);
          } else {
            // Lazy load
            loadImage(img.t);

            // Draw a tinted placeholder based on year
            if (img.y) {
              const hue = ((img.y - 1400) / 600) * 60 + 15; // warm gradient
              ctx.fillStyle = `hsla(${hue}, 30%, 15%, 1)`;
              ctx.fillRect(px, py, CELL_W, CELL_H);
            }
          }
        }
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    // --- Interaction handlers (adapted from BookOverview) ---

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      const delta = -e.deltaY * ZOOM_SPEED;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * (1 + delta)));

      // Zoom toward cursor
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - canvas.width / dpr / 2) / cam.zoom + cam.x;
      const wy = (my - canvas.height / dpr / 2) / cam.zoom + cam.y;

      cam.x = wx - (mx - canvas.width / dpr / 2) / newZoom;
      cam.y = wy - (my - canvas.height / dpr / 2) / newZoom;
      cam.zoom = newZoom;

      setZoomPercent(Math.round((newZoom / getHomeZoom()) * 100));
      dirtyRef.current = true;
    };

    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const cam = camRef.current;
        const dx = (e.clientX - dragRef.current.sx) / cam.zoom;
        const dy = (e.clientY - dragRef.current.sy) / cam.zoom;
        cam.x = dragRef.current.cx - dx;
        cam.y = dragRef.current.cy - dy;
        dirtyRef.current = true;
      } else {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const idx = hitTest(sx, sy);
        if (idx >= 0) {
          setHoveredImage(images[idx]);
          canvas.style.cursor = 'pointer';
        } else {
          setHoveredImage(null);
          canvas.style.cursor = 'grab';
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (dragRef.current) {
        const moved = Math.abs(e.clientX - dragRef.current.sx) + Math.abs(e.clientY - dragRef.current.sy);
        if (moved < 5) {
          // Click — navigate to gallery image
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const idx = hitTest(sx, sy);
          if (idx >= 0) {
            const img = images[idx];
            router.push(`/gallery/image/${img.id}`);
          }
        }
        dragRef.current = null;
        canvas.style.cursor = 'grab';
      }
    };

    const onMouseLeave = () => {
      dragRef.current = null;
      setHoveredImage(null);
      canvas.style.cursor = 'grab';
    };

    // Touch support
    let lastTouchDist = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        dragRef.current = { sx: t.clientX, sy: t.clientY, cx: camRef.current.x, cy: camRef.current.y };
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
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
        dirtyRef.current = true;
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const scale = dist / lastTouchDist;
        const cam = camRef.current;
        cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * scale));
        lastTouchDist = dist;
        setZoomPercent(Math.round((cam.zoom / getHomeZoom()) * 100));
        dirtyRef.current = true;
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
            const img = images[idx];
            router.push(`/gallery/image/${img.id}`);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, layout, getHomeZoom, hitTest, loadImage]);

  const handleZoomIn = () => {
    const cam = camRef.current;
    cam.zoom = Math.min(MAX_ZOOM, cam.zoom * 1.5);
    setZoomPercent(Math.round((cam.zoom / getHomeZoom()) * 100));
    dirtyRef.current = true;
  };

  const handleZoomOut = () => {
    const cam = camRef.current;
    cam.zoom = Math.max(MIN_ZOOM, cam.zoom * 0.67);
    setZoomPercent(Math.round((cam.zoom / getHomeZoom()) * 100));
    dirtyRef.current = true;
  };

  const handleFitAll = () => {
    const homeZoom = getHomeZoom();
    camRef.current = { x: layout.totalW / 2, y: layout.totalH / 2, zoom: homeZoom };
    setZoomPercent(100);
    dirtyRef.current = true;
  };

  // Loading state
  if (loading) {
    return (
      <div className="w-full h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50 text-sm">Loading image manifest...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">Failed to load images</p>
          <p className="text-white/40 text-xs">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-[#0a0a0a]">
      {/* Image count — top-left */}
      <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full
        bg-black/60 backdrop-blur-md border border-white/10 text-white/70 text-sm
        pointer-events-none select-none">
        {images.length.toLocaleString()} images
        {totalInDb > images.length && (
          <span className="text-white/40 ml-1">of {totalInDb.toLocaleString()}</span>
        )}
        {loadedCount > 0 && loadedCount < images.length && (
          <span className="text-white/40 ml-1.5">
            &middot; {loadedCount.toLocaleString()} loaded
          </span>
        )}
      </div>

      {/* Title — top-center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full
        bg-black/60 backdrop-blur-md border border-white/10 text-white/80 text-sm
        pointer-events-none select-none">
        Source Library &mdash; Image Wall
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: 'grab' }} />

      {/* Hover info — top-right */}
      {hoveredImage && (
        <div className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded-xl
          bg-black/70 backdrop-blur-md border border-white/10 text-white/80 text-sm
          pointer-events-none select-none max-w-[300px]">
          {hoveredImage.d && (
            <p className="text-white/90 text-xs leading-snug mb-1 line-clamp-2">{hoveredImage.d}</p>
          )}
          <p className="text-white/50 text-xs truncate">
            {hoveredImage.b}
            {hoveredImage.y ? ` (${hoveredImage.y})` : ''}
          </p>
        </div>
      )}

      {/* Zoom controls — bottom-right */}
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

        <span className="text-white/50 text-xs w-12 text-center tabular-nums select-none">
          {zoomPercent}%
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
          aria-label="Fit all images"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 5h6v6H5z" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" />
          </svg>
        </button>
      </div>

      {/* Back link — bottom-left */}
      <a
        href="/gallery"
        className="absolute bottom-6 left-6 z-20 flex items-center gap-2 px-3 py-1.5
          bg-black/60 backdrop-blur-md border border-white/10 rounded-full
          text-white/70 hover:text-white text-sm transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to gallery
      </a>
    </div>
  );
}
