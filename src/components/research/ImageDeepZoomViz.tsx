'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface ImageItem {
  id: string;
  type: string;
  quality: number;
  thumbnail: string;
  book_title: string;
  book_author: string;
  book_year: number | null;
  book_id: string;
  book_slug?: string;
  subjects: string[];
  x: number;
  y: number;
  z: number;
  cluster: number;
}

interface ClusterInfo {
  id: number;
  size: number;
  label: string;
  top_type: string;
  top_subjects: string[];
  cx: number;
  cy: number;
  cz: number;
}

interface ConstellationData {
  meta: {
    total_images: number;
    n_clusters: number;
    quality_threshold: number;
    generated_at: string;
  };
  clusters: Record<string, ClusterInfo>;
  images: ImageItem[];
}

// ────────────────────────────────────────────────────────────
// QuadTree
// ────────────────────────────────────────────────────────────

interface QTPoint { x: number; y: number; idx: number }
interface QTBounds { x: number; y: number; w: number; h: number }

class QuadTree {
  bounds: QTBounds;
  points: QTPoint[] = [];
  children: QuadTree[] | null = null;

  constructor(bounds: QTBounds, private capacity = 64) {
    this.bounds = bounds;
  }

  insert(p: QTPoint): boolean {
    const { x, y, w, h } = this.bounds;
    if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) return false;
    if (!this.children && this.points.length < this.capacity) {
      this.points.push(p);
      return true;
    }
    if (!this.children) this.subdivide();
    for (const c of this.children!) if (c.insert(p)) return true;
    return false;
  }

  private subdivide() {
    const { x, y, w, h } = this.bounds;
    const hw = w / 2, hh = h / 2;
    this.children = [
      new QuadTree({ x, y, w: hw, h: hh }, this.capacity),
      new QuadTree({ x: x + hw, y, w: hw, h: hh }, this.capacity),
      new QuadTree({ x, y: y + hh, w: hw, h: hh }, this.capacity),
      new QuadTree({ x: x + hw, y: y + hh, w: hw, h: hh }, this.capacity),
    ];
    for (const p of this.points) for (const c of this.children) if (c.insert(p)) break;
    this.points = [];
  }

  query(range: QTBounds, result: QTPoint[] = []): QTPoint[] {
    const { x, y, w, h } = this.bounds;
    if (range.x + range.w < x || range.x > x + w || range.y + range.h < y || range.y > y + h)
      return result;
    for (const p of this.points)
      if (p.x >= range.x && p.x <= range.x + range.w && p.y >= range.y && p.y <= range.y + range.h)
        result.push(p);
    if (this.children) for (const c of this.children) c.query(range, result);
    return result;
  }
}

// ────────────────────────────────────────────────────────────
// Colors
// ────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  emblem: '#c9a86c', woodcut: '#8b9a7d', engraving: '#607d8b',
  portrait: '#9e4a3a', frontispiece: '#d4924a', diagram: '#7c5db5',
  map: '#1abc9c', symbol: '#e91e63', decorative: '#795548',
  musical_score: '#5d8fb5', illustration: '#4a9e7c', chart: '#00bcd4',
  botanical: '#4caf50', anatomical: '#e74c3c', coat_of_arms: '#673ab7',
};

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff9800', '#673ab7',
  '#4caf50', '#795548', '#607d8b', '#ff5722', '#009688',
  '#8bc34a', '#c9a86c', '#5d8fb5', '#d4924a', '#a067a0',
];

type ColorMode = 'type' | 'cluster' | 'century';

function getCenturyColor(year: number | null): string {
  if (!year) return '#666';
  if (year < 500) return '#c9a86c';
  if (year < 1000) return '#9e4a3a';
  if (year < 1200) return '#b5835d';
  if (year < 1400) return '#7c5db5';
  if (year < 1500) return '#5d8fb5';
  if (year < 1600) return '#8b9a7d';
  if (year < 1700) return '#4a9e7c';
  if (year < 1800) return '#5e6d52';
  return '#6a7a5a';
}

function getColor(img: ImageItem, mode: ColorMode): string {
  switch (mode) {
    case 'type': return TYPE_COLORS[img.type] || '#666';
    case 'cluster': return CLUSTER_COLORS[img.cluster % CLUSTER_COLORS.length];
    case 'century': return getCenturyColor(img.book_year);
  }
}

// ────────────────────────────────────────────────────────────
// Tile renderer constants
// ────────────────────────────────────────────────────────────

const TILE_SIZE = 256;
const WORLD_SIZE = 16384; // Virtual coordinate space
const MIN_ZOOM = 0.004;  // See entire world
const MAX_ZOOM = 4;      // Individual images ~240px
const THUMB_ZOOM = 0.15; // Zoom threshold for showing thumbnails
const MAX_TILE_CACHE = 512;
const MAX_CONCURRENT_LOADS = 12;

// ────────────────────────────────────────────────────────────
// Thumbnail cache
// ────────────────────────────────────────────────────────────

class ThumbCache {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private queue: string[] = [];
  private onChange: () => void;

  constructor(onChange: () => void) { this.onChange = onChange; }
  get(url: string): HTMLImageElement | null { return this.cache.get(url) ?? null; }

  request(url: string) {
    if (this.cache.has(url) || this.loading.has(url)) return;
    this.queue.push(url);
    this.flush();
  }

  private flush() {
    while (this.loading.size < MAX_CONCURRENT_LOADS && this.queue.length > 0) {
      const url = this.queue.pop()!; // LIFO: most recent request first
      if (this.cache.has(url) || this.loading.has(url)) continue;
      this.loading.add(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.cache.set(url, img);
        this.loading.delete(url);
        this.flush();
        this.onChange();
      };
      img.onerror = () => { this.loading.delete(url); this.flush(); };
      img.src = url;
    }
  }

  get size() { return this.cache.size; }
}

// ────────────────────────────────────────────────────────────
// Tile cache: key = "level:x:y:colorMode:filterHash" → canvas
// ────────────────────────────────────────────────────────────

class TileCache {
  private cache = new Map<string, HTMLCanvasElement>();
  private order: string[] = []; // LRU order

  get(key: string): HTMLCanvasElement | null {
    const canvas = this.cache.get(key);
    if (canvas) {
      // Move to end (most recently used)
      const idx = this.order.indexOf(key);
      if (idx !== -1) {
        this.order.splice(idx, 1);
        this.order.push(key);
      }
    }
    return canvas ?? null;
  }

  set(key: string, canvas: HTMLCanvasElement) {
    if (this.cache.has(key)) {
      this.cache.set(key, canvas);
      return;
    }
    // Evict oldest if at capacity
    while (this.order.length >= MAX_TILE_CACHE) {
      const oldest = this.order.shift()!;
      this.cache.delete(oldest);
    }
    this.cache.set(key, canvas);
    this.order.push(key);
  }

  invalidate() {
    this.cache.clear();
    this.order = [];
  }

  get size() { return this.cache.size; }
}

// ────────────────────────────────────────────────────────────
// Render a single tile
// ────────────────────────────────────────────────────────────

function renderTile(
  images: ImageItem[],
  qt: QuadTree,
  thumbCache: ThumbCache,
  colorMode: ColorMode,
  searchMatches: Set<number> | null,
  selectedCluster: number | null,
  // Tile world bounds
  worldX: number,
  worldY: number,
  tileWorldSize: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#08080d';
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  const scale = TILE_SIZE / tileWorldSize;

  // Query quadtree with margin
  const margin = Math.max(8 / scale, tileWorldSize * 0.02);
  const points = qt.query({
    x: worldX - margin,
    y: worldY - margin,
    w: tileWorldSize + margin * 2,
    h: tileWorldSize + margin * 2,
  });

  if (points.length === 0) return canvas;

  const hasFilter = (searchMatches && searchMatches.size > 0) || selectedCluster !== null;
  const showThumbs = tileWorldSize < 600; // Each tile covers <600 world units → thumbnails visible

  if (showThumbs) {
    // ── Thumbnail mode ──
    const thumbPx = Math.min(TILE_SIZE * 0.4, Math.max(16, 40 * scale));
    const half = thumbPx / 2;

    for (const p of points) {
      const img = images[p.idx];
      const isMatch = (!searchMatches || searchMatches.has(p.idx)) &&
        (selectedCluster === null || img.cluster === selectedCluster);

      const px = (p.x - worldX) * scale;
      const py = (p.y - worldY) * scale;

      // Skip if thumbnail is fully outside this tile
      if (px + half < -2 || px - half > TILE_SIZE + 2 || py + half < -2 || py - half > TILE_SIZE + 2) continue;

      if (hasFilter && !isMatch) {
        ctx.globalAlpha = 0.05;
      } else {
        ctx.globalAlpha = 1;
      }

      const cached = thumbCache.get(img.thumbnail);
      if (cached) {
        if (thumbPx > 24) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 3;
          ctx.shadowOffsetY = 1;
        }
        ctx.drawImage(cached, px - half, py - half, thumbPx, thumbPx);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        if (thumbPx > 16) {
          ctx.strokeStyle = getColor(img, colorMode);
          ctx.lineWidth = 1;
          ctx.globalAlpha = hasFilter && !isMatch ? 0.05 : 0.35;
          ctx.strokeRect(px - half, py - half, thumbPx, thumbPx);
        }
      } else {
        ctx.fillStyle = getColor(img, colorMode);
        ctx.globalAlpha = hasFilter && !isMatch ? 0.03 : 0.15;
        ctx.fillRect(px - half, py - half, thumbPx, thumbPx);
        thumbCache.request(img.thumbnail);
      }
    }
  } else {
    // ── Dot mode ──
    const dotRadius = Math.max(1.2, Math.min(4, 3 * scale));

    for (const p of points) {
      const img = images[p.idx];
      const isMatch = (!searchMatches || searchMatches.has(p.idx)) &&
        (selectedCluster === null || img.cluster === selectedCluster);

      const px = (p.x - worldX) * scale;
      const py = (p.y - worldY) * scale;

      ctx.fillStyle = getColor(img, colorMode);
      ctx.globalAlpha = hasFilter ? (isMatch ? 0.85 : 0.04) : 0.7;

      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  return canvas;
}

// ────────────────────────────────────────────────────────────
// Camera: world-space center + zoom
// ────────────────────────────────────────────────────────────

interface Camera {
  cx: number; // World center X
  cy: number; // World center Y
  zoom: number; // Pixels per world unit
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function ImageDeepZoomViz({ data }: { data: ConstellationData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const qtRef = useRef<QuadTree | null>(null);
  const thumbCacheRef = useRef<ThumbCache | null>(null);
  const tileCacheRef = useRef<TileCache>(new TileCache());
  const cameraRef = useRef<Camera>({ cx: WORLD_SIZE / 2, cy: WORLD_SIZE / 2, zoom: MIN_ZOOM * 3 });
  const dragRef = useRef<{ startX: number; startY: number; camCx: number; camCy: number } | null>(null);
  const rafRef = useRef<number>(0);
  const needsDrawRef = useRef(true);
  const lastPinchDistRef = useRef<number | null>(null);
  const velocityRef = useRef({ vx: 0, vy: 0 });
  const lastDragRef = useRef({ x: 0, y: 0, t: 0 });

  // State refs for tile rendering
  const colorModeRef = useRef<ColorMode>('type');
  const searchMatchesRef = useRef<Set<number> | null>(null);
  const selectedClusterRef = useRef<number | null>(null);
  const filterVersionRef = useRef(0);

  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  // Sync refs
  colorModeRef.current = colorMode;
  selectedClusterRef.current = selectedCluster;

  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    const q = searchQuery.toLowerCase();
    const matches = new Set<number>();
    data.images.forEach((img, i) => {
      if (
        img.book_title.toLowerCase().includes(q) ||
        img.book_author.toLowerCase().includes(q) ||
        img.type.toLowerCase().includes(q) ||
        img.subjects.some((s) => s.toLowerCase().includes(q))
      ) matches.add(i);
    });
    return matches;
  }, [searchQuery, data.images]);

  searchMatchesRef.current = searchMatches;

  // Invalidate tile cache when filters change
  useEffect(() => {
    filterVersionRef.current++;
    tileCacheRef.current.invalidate();
    needsDrawRef.current = true;
  }, [colorMode, searchMatches, selectedCluster]);

  const stats = useMemo(() => ({
    totalImages: data.meta.total_images,
    nClusters: data.meta.n_clusters,
    nTypes: new Set(data.images.map((img) => img.type)).size,
    nBooks: new Set(data.images.map((img) => img.book_id)).size,
  }), [data]);

  const legendItems = useMemo(() => {
    if (colorMode === 'type') {
      const counts: Record<string, number> = {};
      data.images.forEach((img) => { counts[img.type] = (counts[img.type] || 0) + 1; });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([type, count]) => ({
          label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          color: TYPE_COLORS[type] || '#666',
          count,
        }));
    }
    if (colorMode === 'cluster') {
      return Object.values(data.clusters).sort((a, b) => b.size - a.size).slice(0, 10)
        .map((c) => ({
          label: c.label,
          color: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
          count: c.size,
        }));
    }
    return [
      { label: 'Before 500', color: getCenturyColor(100), count: 0 },
      { label: '500-999', color: getCenturyColor(700), count: 0 },
      { label: '1000-1399', color: getCenturyColor(1200), count: 0 },
      { label: '1400-1499', color: getCenturyColor(1450), count: 0 },
      { label: '1500-1599', color: getCenturyColor(1550), count: 0 },
      { label: '1600-1699', color: getCenturyColor(1650), count: 0 },
      { label: '1700+', color: getCenturyColor(1750), count: 0 },
    ];
  }, [colorMode, data]);

  // Build quadtree
  useEffect(() => {
    const qt = new QuadTree({ x: 0, y: 0, w: WORLD_SIZE, h: WORLD_SIZE });
    for (let i = 0; i < data.images.length; i++) {
      qt.insert({
        x: data.images[i].x * WORLD_SIZE,
        y: data.images[i].y * WORLD_SIZE,
        idx: i,
      });
    }
    qtRef.current = qt;
    needsDrawRef.current = true;
  }, [data.images]);

  // ── Main canvas setup + render loop ──
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const thumbCache = new ThumbCache(() => {
      // When a new thumbnail loads, invalidate tiles that might show it
      // For simplicity, just mark dirty — tiles at thumbnail zoom will re-render
      needsDrawRef.current = true;
      setLoadedCount(thumbCacheRef.current?.size || 0);
    });
    thumbCacheRef.current = thumbCache;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      needsDrawRef.current = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // ── Render frame ──
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      // Apply inertia
      const vel = velocityRef.current;
      if (Math.abs(vel.vx) > 0.01 || Math.abs(vel.vy) > 0.01) {
        const cam = cameraRef.current;
        cam.cx -= vel.vx / cam.zoom;
        cam.cy -= vel.vy / cam.zoom;
        vel.vx *= 0.92;
        vel.vy *= 0.92;
        needsDrawRef.current = true;
      }

      if (!needsDrawRef.current) return;
      needsDrawRef.current = false;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const qt = qtRef.current;
      if (!qt) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const cam = cameraRef.current;
      const tileCache = tileCacheRef.current;

      ctx.fillStyle = '#08080d';
      ctx.fillRect(0, 0, w, h);

      const scale = cam.zoom * dpr;
      const fv = filterVersionRef.current;
      const cm = colorModeRef.current;
      const sm = searchMatchesRef.current;
      const sc = selectedClusterRef.current;

      // Determine tile level: find tile size in world units such that
      // each tile covers TILE_SIZE pixels on screen
      const tileWorldSize = TILE_SIZE / scale;

      // Which tiles are visible?
      const viewWorldW = w / scale;
      const viewWorldH = h / scale;
      const viewLeft = cam.cx - viewWorldW / 2;
      const viewTop = cam.cy - viewWorldH / 2;

      const tileStartX = Math.floor(viewLeft / tileWorldSize);
      const tileStartY = Math.floor(viewTop / tileWorldSize);
      const tileEndX = Math.ceil((viewLeft + viewWorldW) / tileWorldSize);
      const tileEndY = Math.ceil((viewTop + viewWorldH) / tileWorldSize);

      // Clamp to world bounds
      const worldTilesMax = Math.ceil(WORLD_SIZE / tileWorldSize);
      const sx = Math.max(0, tileStartX);
      const sy = Math.max(0, tileStartY);
      const ex = Math.min(worldTilesMax, tileEndX);
      const ey = Math.min(worldTilesMax, tileEndY);

      // Quantize tileWorldSize for cache key stability
      const levelKey = Math.round(Math.log2(tileWorldSize) * 4);

      // Draw visible tiles
      for (let ty = sy; ty < ey; ty++) {
        for (let tx = sx; tx < ex; tx++) {
          const worldX = tx * tileWorldSize;
          const worldY = ty * tileWorldSize;

          // Screen position of this tile
          const screenX = (worldX - cam.cx) * scale + w / 2;
          const screenY = (worldY - cam.cy) * scale + h / 2;
          const screenSize = tileWorldSize * scale;

          // Skip if fully offscreen
          if (screenX + screenSize < 0 || screenX > w || screenY + screenSize < 0 || screenY > h) continue;

          // Check cache
          const key = `${levelKey}:${tx}:${ty}:${fv}`;
          let tile = tileCache.get(key);

          if (!tile) {
            tile = renderTile(
              data.images, qt, thumbCache, cm, sm, sc,
              worldX, worldY, tileWorldSize,
            );
            tileCache.set(key, tile);
          }

          ctx.drawImage(tile, screenX, screenY, screenSize, screenSize);
        }
      }

      // ── Cluster labels at intermediate zoom ──
      if (cam.zoom > 0.01 && cam.zoom < 0.5) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const cluster of Object.values(data.clusters)) {
          const wx = cluster.cx * WORLD_SIZE;
          const wy = cluster.cy * WORLD_SIZE;
          const screenX = (wx - cam.cx) * scale + w / 2;
          const screenY = (wy - cam.cy) * scale + h / 2;

          if (screenX < -200 || screenX > w + 200 || screenY < -50 || screenY > h + 50) continue;

          const isActive = sc === cluster.id;
          const fontSize = Math.min(Math.max(11, 8 / cam.zoom / dpr), 22) * dpr;
          ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
          const tw = ctx.measureText(cluster.label).width;
          const pad = 5 * dpr;
          const pillH = fontSize + pad * 2;

          ctx.globalAlpha = isActive ? 0.85 : 0.45;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.beginPath();
          ctx.roundRect(screenX - tw / 2 - pad, screenY - pillH / 2, tw + pad * 2, pillH, pillH / 3);
          ctx.fill();

          ctx.fillStyle = '#fff';
          ctx.fillText(cluster.label, screenX, screenY);
          ctx.globalAlpha = 1;
        }
      }

      // Update zoom level display
      setZoomLevel(Math.round(Math.log2(cam.zoom * 1000)));
    };

    draw();

    // ── Input handlers ──
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const mx = (e.clientX - rect.left) * dpr;
      const my = (e.clientY - rect.top) * dpr;

      // World point under mouse
      const wx = cam.cx + (mx - canvas.width / 2) / (cam.zoom * dpr);
      const wy = cam.cy + (my - canvas.height / 2) / (cam.zoom * dpr);

      const factor = Math.pow(1.001, -e.deltaY);
      cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));

      // Pan so world point stays under mouse
      cam.cx = wx - (mx - canvas.width / 2) / (cam.zoom * dpr);
      cam.cy = wy - (my - canvas.height / 2) / (cam.zoom * dpr);

      velocityRef.current = { vx: 0, vy: 0 };
      needsDrawRef.current = true;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const cam = cameraRef.current;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        camCx: cam.cx,
        camCy: cam.cy,
      };
      lastDragRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      velocityRef.current = { vx: 0, vy: 0 };
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        // Hover detection
        const cam = cameraRef.current;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const mx = (e.clientX - rect.left) * dpr;
        const my = (e.clientY - rect.top) * dpr;
        const wx = cam.cx + (mx - canvas.width / 2) / (cam.zoom * dpr);
        const wy = cam.cy + (my - canvas.height / 2) / (cam.zoom * dpr);

        const searchRadius = 20 / (cam.zoom * dpr);
        const nearby = qtRef.current?.query({
          x: wx - searchRadius, y: wy - searchRadius,
          w: searchRadius * 2, h: searchRadius * 2,
        }) || [];

        if (nearby.length > 0) {
          let closest = nearby[0];
          let closestDist = Infinity;
          for (const p of nearby) {
            const d = Math.hypot(p.x - wx, p.y - wy);
            if (d < closestDist) { closestDist = d; closest = p; }
          }
          setHoveredIdx(closest.idx);
          canvas.style.cursor = 'pointer';
        } else {
          setHoveredIdx(null);
          canvas.style.cursor = 'grab';
        }
        return;
      }

      canvas.style.cursor = 'grabbing';
      const dpr = window.devicePixelRatio || 1;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const cam = cameraRef.current;
      cam.cx = drag.camCx - dx / (cam.zoom * dpr);
      cam.cy = drag.camCy - dy / (cam.zoom * dpr);

      // Track velocity for inertia
      const now = Date.now();
      const dt = now - lastDragRef.current.t;
      if (dt > 0) {
        velocityRef.current = {
          vx: (e.clientX - lastDragRef.current.x) / dt * 16,
          vy: (e.clientY - lastDragRef.current.y) / dt * 16,
        };
      }
      lastDragRef.current = { x: e.clientX, y: e.clientY, t: now };
      needsDrawRef.current = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasDrag = dragRef.current;
      dragRef.current = null;
      canvas.style.cursor = 'grab';
      canvas.releasePointerCapture(e.pointerId);

      // Click detection (no significant drag)
      if (wasDrag) {
        const dist = Math.hypot(e.clientX - wasDrag.startX, e.clientY - wasDrag.startY);
        if (dist < 5) {
          // Click — select image
          velocityRef.current = { vx: 0, vy: 0 };
          const cam = cameraRef.current;
          const rect = container.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const mx = (e.clientX - rect.left) * dpr;
          const my = (e.clientY - rect.top) * dpr;
          const wx = cam.cx + (mx - canvas.width / 2) / (cam.zoom * dpr);
          const wy = cam.cy + (my - canvas.height / 2) / (cam.zoom * dpr);

          const searchRadius = 20 / (cam.zoom * dpr);
          const nearby = qtRef.current?.query({
            x: wx - searchRadius, y: wy - searchRadius,
            w: searchRadius * 2, h: searchRadius * 2,
          }) || [];

          if (nearby.length > 0) {
            let closest = nearby[0];
            let closestDist = Infinity;
            for (const p of nearby) {
              const d = Math.hypot(p.x - wx, p.y - wy);
              if (d < closestDist) { closestDist = d; closest = p; }
            }
            setSelectedIdx(closest.idx);
          } else {
            setSelectedIdx(null);
          }
        }
      }
    };

    // Touch pinch-to-zoom
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDistRef.current = Math.hypot(dx, dy);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / lastPinchDistRef.current;
        lastPinchDistRef.current = dist;

        const cam = cameraRef.current;
        cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
        needsDrawRef.current = true;
      }
    };

    const onTouchEnd = () => {
      lastPinchDistRef.current = null;
    };

    // Double-click to zoom in
    const onDblClick = (e: MouseEvent) => {
      const cam = cameraRef.current;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const mx = (e.clientX - rect.left) * dpr;
      const my = (e.clientY - rect.top) * dpr;

      // World point under mouse
      const wx = cam.cx + (mx - canvas.width / 2) / (cam.zoom * dpr);
      const wy = cam.cy + (my - canvas.height / 2) / (cam.zoom * dpr);

      // Zoom toward that point
      const targetZoom = Math.min(MAX_ZOOM, cam.zoom * 3);
      cam.zoom = targetZoom;
      cam.cx = wx;
      cam.cy = wy;
      needsDrawRef.current = true;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('dblclick', onDblClick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('dblclick', onDblClick);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to image
  const navigateToImage = useCallback((idx: number) => {
    const cam = cameraRef.current;
    const img = data.images[idx];
    cam.cx = img.x * WORLD_SIZE;
    cam.cy = img.y * WORLD_SIZE;
    cam.zoom = 0.5;
    setSelectedIdx(idx);
    needsDrawRef.current = true;
  }, [data.images]);

  // Navigate to cluster
  const navigateToCluster = useCallback((clusterId: number) => {
    const cam = cameraRef.current;
    const cluster = data.clusters[String(clusterId)];
    if (!cluster) return;
    cam.cx = cluster.cx * WORLD_SIZE;
    cam.cy = cluster.cy * WORLD_SIZE;
    cam.zoom = 0.05;
    setSelectedCluster(prev => prev === clusterId ? null : clusterId);
    needsDrawRef.current = true;
  }, [data.clusters]);

  const selectedImage = selectedIdx !== null ? data.images[selectedIdx] : null;
  const hoveredImage = hoveredIdx !== null ? data.images[hoveredIdx] : null;
  const displayImage = selectedImage || hoveredImage;

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ touchAction: 'none' }} />

      {/* ── Top bar ── */}
      <div className="absolute top-4 left-4 right-4 flex items-start gap-3 pointer-events-none z-10">
        <div className="pointer-events-auto">
          <input
            type="text"
            placeholder="Search images..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-black/70 backdrop-blur-sm text-white text-sm px-3 py-2 rounded-lg
              border border-white/10 focus:border-white/30 focus:outline-none w-64
              placeholder:text-white/30"
          />
          {searchMatches && (
            <div className="text-white/50 text-xs mt-1 px-1">
              {searchMatches.size.toLocaleString()} matches
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex gap-1">
          {(['type', 'cluster', 'century'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setColorMode(mode)}
              className={`px-3 py-2 text-xs rounded-lg capitalize transition-colors
                ${colorMode === mode
                  ? 'bg-white/20 text-white border border-white/30'
                  : 'bg-black/50 text-white/50 border border-white/10 hover:bg-white/10'}`}
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowInfo(!showInfo)}
          className="pointer-events-auto ml-auto px-3 py-2 text-xs rounded-lg
            bg-black/50 text-white/50 border border-white/10 hover:bg-white/10"
        >
          {showInfo ? 'Hide' : 'Info'}
        </button>
      </div>

      {/* ── Legend ── */}
      <div className="absolute bottom-4 left-4 pointer-events-auto z-10">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 p-3 max-w-[220px]">
          <div className="text-white/40 text-[10px] uppercase tracking-wider mb-2">
            {colorMode === 'type' ? 'Image Type' : colorMode === 'cluster' ? 'Cluster' : 'Century'}
          </div>
          <div className="space-y-1">
            {legendItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if (colorMode === 'cluster') {
                    const cluster = Object.values(data.clusters).find(c => c.label === item.label);
                    if (cluster) navigateToCluster(cluster.id);
                  }
                }}
                className={`flex items-center gap-2 text-xs w-full text-left
                  ${colorMode === 'cluster' ? 'hover:bg-white/10 rounded px-1 -mx-1 cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-white/70 truncate flex-1">{item.label}</span>
                {item.count > 0 && (
                  <span className="text-white/30 tabular-nums">{item.count.toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Info panel ── */}
      {showInfo && (
        <div className="absolute top-16 right-4 bg-black/70 backdrop-blur-sm rounded-lg
          border border-white/10 p-4 max-w-[280px] z-10 pointer-events-auto">
          <h3 className="text-white text-sm font-medium mb-2">Image Deep Zoom</h3>
          <p className="text-white/50 text-xs leading-relaxed mb-3">
            {stats.totalImages.toLocaleString()} illustrations from {stats.nBooks.toLocaleString()} pre-modern
            texts, clustered by visual similarity using AI embeddings and UMAP.
          </p>
          <div className="space-y-1 text-xs text-white/40">
            <div>{stats.nClusters} clusters, {stats.nTypes} image types</div>
            {loadedCount > 0 && <div>{loadedCount} thumbnails cached</div>}
            <div>{tileCacheRef.current.size} tiles cached</div>
          </div>
          <p className="text-white/30 text-[10px] mt-3">
            Scroll to zoom. Drag to pan. Double-click to zoom in.
            Click an image for details.
          </p>
        </div>
      )}

      {/* ── Image detail ── */}
      {displayImage && (
        <div className="absolute bottom-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg
          border border-white/10 overflow-hidden z-10 pointer-events-auto max-w-[300px]">
          <div className="flex gap-3 p-3">
            <img
              src={displayImage.thumbnail}
              alt=""
              className="w-16 h-16 object-cover rounded flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-white text-sm font-medium truncate">
                {displayImage.book_title}
              </div>
              <div className="text-white/50 text-xs truncate">
                {displayImage.book_author}
              </div>
              {displayImage.book_year && (
                <div className="text-white/40 text-xs">{displayImage.book_year}</div>
              )}
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/60 capitalize">
                  {displayImage.type.replace(/_/g, ' ')}
                </span>
                {displayImage.subjects.slice(0, 2).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/40">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {selectedImage && (
            <div className="border-t border-white/10 p-2 flex gap-2">
              <a
                href={`/gallery/${selectedImage.id}`}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                View in gallery
              </a>
              <a
                href={selectedImage.book_slug ? `/${selectedImage.book_slug}` : `/book/${selectedImage.book_id}`}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Open book
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Active cluster ── */}
      {selectedCluster !== null && data.clusters[String(selectedCluster)] && (
        <div className="absolute top-16 left-4 bg-black/70 backdrop-blur-sm rounded-lg
          border border-white/10 p-3 z-10 pointer-events-auto">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: CLUSTER_COLORS[selectedCluster % CLUSTER_COLORS.length] }}
            />
            <span className="text-white text-sm">{data.clusters[String(selectedCluster)].label}</span>
            <span className="text-white/40 text-xs">
              ({data.clusters[String(selectedCluster)].size})
            </span>
            <button
              onClick={() => setSelectedCluster(null)}
              className="ml-2 text-white/40 hover:text-white text-sm"
            >
              x
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
