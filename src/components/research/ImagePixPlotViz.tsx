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
// QuadTree for spatial indexing (thumbnail-zoom only)
// ────────────────────────────────────────────────────────────

interface QTPoint { x: number; y: number; idx: number }
interface QTBounds { x: number; y: number; w: number; h: number }

class QuadTree {
  bounds: QTBounds;
  points: QTPoint[] = [];
  children: QuadTree[] | null = null;

  constructor(bounds: QTBounds, private capacity = 32) {
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
// Colors — stored as RGB tuples for direct pixel writing
// ────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, [number, number, number]> = {
  emblem: [201, 168, 108],
  woodcut: [139, 154, 125],
  engraving: [96, 125, 139],
  portrait: [158, 74, 58],
  frontispiece: [212, 146, 74],
  diagram: [124, 93, 181],
  map: [26, 188, 156],
  symbol: [233, 30, 99],
  decorative: [121, 85, 72],
  musical_score: [93, 143, 181],
  illustration: [74, 158, 124],
  chart: [0, 188, 212],
  botanical: [76, 175, 80],
  anatomical: [231, 76, 60],
  coat_of_arms: [103, 58, 183],
};

const CLUSTER_COLORS: [number, number, number][] = [
  [231,76,60],[52,152,219],[46,204,113],[243,156,18],[155,89,182],
  [26,188,156],[233,30,99],[0,188,212],[255,152,0],[103,58,183],
  [76,175,80],[121,85,72],[96,125,139],[255,87,34],[0,150,136],
  [139,195,74],[201,168,108],[93,143,181],[212,146,74],[160,103,160],
  [94,109,82],[181,131,93],[124,93,181],[158,74,58],[74,158,124],
];

const DEFAULT_COLOR: [number, number, number] = [102, 102, 102];

type ColorMode = 'type' | 'cluster' | 'century';

function getCenturyColorRgb(year: number | null): [number, number, number] {
  if (!year) return DEFAULT_COLOR;
  if (year < 0) return [212, 146, 74];
  if (year < 500) return [201, 168, 108];
  if (year < 1000) return [158, 74, 58];
  if (year < 1200) return [181, 131, 93];
  if (year < 1400) return [124, 93, 181];
  if (year < 1500) return [93, 143, 181];
  if (year < 1600) return [139, 154, 125];
  if (year < 1700) return [74, 158, 124];
  if (year < 1800) return [94, 109, 82];
  return [106, 122, 90];
}

function getColorRgb(img: ImageItem, mode: ColorMode): [number, number, number] {
  switch (mode) {
    case 'type': return TYPE_COLORS[img.type] || DEFAULT_COLOR;
    case 'cluster': return CLUSTER_COLORS[img.cluster % CLUSTER_COLORS.length];
    case 'century': return getCenturyColorRgb(img.book_year);
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DOT_MAP_SIZE = 4096; // Offscreen dot map resolution
const WORLD_SIZE = 8000;
const THUMB_SIZE = 60;
const ZOOM_THUMB_THRESHOLD = 0.18;
const ZOOM_LABEL_THRESHOLD = 0.05;
const MAX_CONCURRENT_LOADS = 8;
const MIN_ZOOM = 0.015;
const MAX_ZOOM = 4;

// ────────────────────────────────────────────────────────────
// Image cache with LIFO priority
// ────────────────────────────────────────────────────────────

class ImageCache {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private queue: string[] = [];
  private onLoad: () => void;

  constructor(onLoad: () => void) { this.onLoad = onLoad; }
  get(url: string): HTMLImageElement | null { return this.cache.get(url) || null; }

  request(url: string) {
    if (this.cache.has(url) || this.loading.has(url)) return;
    this.queue.push(url);
    this.flush();
  }

  private flush() {
    while (this.loading.size < MAX_CONCURRENT_LOADS && this.queue.length > 0) {
      const url = this.queue.pop()!;
      if (this.cache.has(url) || this.loading.has(url)) continue;
      this.loading.add(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { this.cache.set(url, img); this.loading.delete(url); this.flush(); this.onLoad(); };
      img.onerror = () => { this.loading.delete(url); this.flush(); };
      img.src = url;
    }
  }

  get size() { return this.cache.size; }
}

// ────────────────────────────────────────────────────────────
// Pre-render dot map via ImageData (direct pixel writes, no draw calls)
// ────────────────────────────────────────────────────────────

function buildDotMap(
  images: ImageItem[],
  colorMode: ColorMode,
  searchMatches: Set<number> | null,
  selectedCluster: number | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = DOT_MAP_SIZE;
  canvas.height = DOT_MAP_SIZE;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(DOT_MAP_SIZE, DOT_MAP_SIZE);
  const pixels = imageData.data;
  const hasFilter = (searchMatches && searchMatches.size > 0) || selectedCluster !== null;
  const radius = 2;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const cx = Math.round(img.x * (DOT_MAP_SIZE - 1));
    const cy = Math.round(img.y * (DOT_MAP_SIZE - 1));
    const [r, g, b] = getColorRgb(img, colorMode);
    const isMatch = (!searchMatches || searchMatches.has(i)) &&
      (selectedCluster === null || img.cluster === selectedCluster);
    const alpha = hasFilter ? (isMatch ? 220 : 12) : 200;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius + 1) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= DOT_MAP_SIZE || py < 0 || py >= DOT_MAP_SIZE) continue;
        const off = (py * DOT_MAP_SIZE + px) * 4;
        const oldA = pixels[off + 3] / 255;
        const newA = alpha / 255;
        const outA = newA + oldA * (1 - newA);
        if (outA > 0) {
          pixels[off] = Math.round((r * newA + pixels[off] * oldA * (1 - newA)) / outA);
          pixels[off + 1] = Math.round((g * newA + pixels[off + 1] * oldA * (1 - newA)) / outA);
          pixels[off + 2] = Math.round((b * newA + pixels[off + 2] * oldA * (1 - newA)) / outA);
          pixels[off + 3] = Math.round(outA * 255);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function ImagePixPlotViz({ data }: { data: ConstellationData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, zoom: MIN_ZOOM * 2.5 });
  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
  const imageCacheRef = useRef<ImageCache | null>(null);
  const quadTreeRef = useRef<QuadTree | null>(null);
  const dotMapRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const needsDrawRef = useRef(true);

  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);

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
          label: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          color: rgbToHex(...(TYPE_COLORS[type] || DEFAULT_COLOR)),
          count,
        }));
    }
    if (colorMode === 'cluster') {
      return Object.values(data.clusters).sort((a, b) => b.size - a.size).slice(0, 10)
        .map((c) => ({
          label: c.label,
          color: rgbToHex(...CLUSTER_COLORS[c.id % CLUSTER_COLORS.length]),
          count: c.size,
        }));
    }
    return [
      { label: 'Before 500', color: rgbToHex(...getCenturyColorRgb(100)), count: 0 },
      { label: '500-999', color: rgbToHex(...getCenturyColorRgb(700)), count: 0 },
      { label: '1000-1399', color: rgbToHex(...getCenturyColorRgb(1200)), count: 0 },
      { label: '1400-1499', color: rgbToHex(...getCenturyColorRgb(1450)), count: 0 },
      { label: '1500-1599', color: rgbToHex(...getCenturyColorRgb(1550)), count: 0 },
      { label: '1600-1699', color: rgbToHex(...getCenturyColorRgb(1650)), count: 0 },
      { label: '1700+', color: rgbToHex(...getCenturyColorRgb(1750)), count: 0 },
    ];
  }, [colorMode, data]);

  // Build quadtree once
  useEffect(() => {
    const qt = new QuadTree({ x: 0, y: 0, w: WORLD_SIZE, h: WORLD_SIZE });
    for (let i = 0; i < data.images.length; i++) {
      qt.insert({ x: data.images[i].x * WORLD_SIZE, y: data.images[i].y * WORLD_SIZE, idx: i });
    }
    quadTreeRef.current = qt;
  }, [data.images]);

  // Rebuild dot map when color/filter changes
  useEffect(() => {
    dotMapRef.current = buildDotMap(data.images, colorMode, searchMatches, selectedCluster);
    needsDrawRef.current = true;
  }, [data.images, colorMode, searchMatches, selectedCluster]);

  // Setup canvas, cache, animation loop
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const cache = new ImageCache(() => {
      needsDrawRef.current = true;
      setLoadedCount(imageCacheRef.current?.size || 0);
    });
    imageCacheRef.current = cache;

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

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      if (!needsDrawRef.current) return;
      needsDrawRef.current = false;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const cam = cameraRef.current;
      const dotMap = dotMapRef.current;

      ctx.fillStyle = '#08080d';
      ctx.fillRect(0, 0, w, h);

      const scale = cam.zoom * dpr;
      const toScreen = (wx: number, wy: number) => ({
        sx: (wx - cam.x) * scale + w / 2,
        sy: (wy - cam.y) * scale + h / 2,
      });

      // ── Tier 1: Dot map — single drawImage call ──
      if (dotMap) {
        const pixelScale = (WORLD_SIZE / DOT_MAP_SIZE) * scale;
        const { sx: ox, sy: oy } = toScreen(0, 0);
        ctx.imageSmoothingEnabled = cam.zoom < 0.3;
        ctx.drawImage(dotMap, ox, oy, DOT_MAP_SIZE * pixelScale, DOT_MAP_SIZE * pixelScale);
        ctx.imageSmoothingEnabled = true;
      }

      // ── Tier 2: Thumbnails — only when zoomed in ──
      const showThumbs = cam.zoom >= ZOOM_THUMB_THRESHOLD;
      const qt = quadTreeRef.current;

      if (showThumbs && qt) {
        const viewW = w / scale;
        const viewH = h / scale;
        const margin = THUMB_SIZE * 2;
        const visible = qt.query({
          x: cam.x - viewW / 2 - margin,
          y: cam.y - viewH / 2 - margin,
          w: viewW + margin * 2,
          h: viewH + margin * 2,
        });

        const thumbScreen = THUMB_SIZE * scale;
        const halfThumb = thumbScreen / 2;
        const hasFilter = (searchMatches && searchMatches.size > 0) || selectedCluster !== null;

        for (const p of visible) {
          const img = data.images[p.idx];
          const isMatch = (!searchMatches || searchMatches.has(p.idx)) &&
            (selectedCluster === null || img.cluster === selectedCluster);
          const isSelected = p.idx === selectedIdx;
          const isHovered = p.idx === hoveredIdx;

          if (hasFilter && !isMatch && !isSelected && !isHovered) continue;

          const { sx, sy } = toScreen(p.x, p.y);
          const cachedImg = cache.get(img.thumbnail);

          if (cachedImg) {
            ctx.globalAlpha = hasFilter && !isMatch ? 0.15 : 1;

            if (thumbScreen > 30) {
              ctx.shadowColor = 'rgba(0,0,0,0.6)';
              ctx.shadowBlur = 3 * dpr;
              ctx.shadowOffsetY = 1 * dpr;
            }

            ctx.drawImage(cachedImg, sx - halfThumb, sy - halfThumb, thumbScreen, thumbScreen);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;

            if (isSelected || isHovered) {
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2 * dpr;
              ctx.globalAlpha = 1;
              ctx.strokeRect(sx - halfThumb - 2 * dpr, sy - halfThumb - 2 * dpr,
                thumbScreen + 4 * dpr, thumbScreen + 4 * dpr);
            } else if (thumbScreen > 24) {
              const [cr, cg, cb] = getColorRgb(img, colorMode);
              ctx.strokeStyle = rgbToHex(cr, cg, cb);
              ctx.lineWidth = 1.5 * dpr;
              ctx.globalAlpha = 0.5;
              ctx.strokeRect(sx - halfThumb, sy - halfThumb, thumbScreen, thumbScreen);
            }
            ctx.globalAlpha = 1;
          } else {
            const [cr, cg, cb] = getColorRgb(img, colorMode);
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = rgbToHex(cr, cg, cb);
            ctx.fillRect(sx - halfThumb, sy - halfThumb, thumbScreen, thumbScreen);
            ctx.globalAlpha = 1;
            cache.request(img.thumbnail);
          }
        }
      }

      // ── Cluster labels ──
      if (cam.zoom >= ZOOM_LABEL_THRESHOLD) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const cluster of Object.values(data.clusters)) {
          const { sx, sy } = toScreen(cluster.cx * WORLD_SIZE, cluster.cy * WORLD_SIZE);
          if (sx < -300 || sx > w + 300 || sy < -50 || sy > h + 50) continue;

          const isActive = selectedCluster === cluster.id;
          const fontSize = Math.min(Math.max(13, 11 / cam.zoom), 26) * dpr;
          ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
          const tw = ctx.measureText(cluster.label).width;
          const pad = 6 * dpr;
          const pillH = fontSize + pad * 2;

          ctx.globalAlpha = isActive ? 0.85 : 0.5;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.beginPath();
          ctx.roundRect(sx - tw / 2 - pad, sy - pillH / 2, tw + pad * 2, pillH, pillH / 3);
          ctx.fill();

          ctx.fillStyle = '#fff';
          ctx.globalAlpha = isActive ? 0.95 : 0.6;
          ctx.fillText(cluster.label, sx, sy + 1 * dpr);
          ctx.globalAlpha = 1;
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, colorMode, searchMatches, selectedCluster, selectedIdx, hoveredIdx]);

  // ── Interaction helpers ──
  const getWorldPos = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { wx: 0, wy: 0 };
    const cam = cameraRef.current;
    return {
      wx: (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x,
      wy: (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y,
    };
  }, []);

  const findImageAt = useCallback((wx: number, wy: number): number | null => {
    const qt = quadTreeRef.current;
    if (!qt) return null;
    const cam = cameraRef.current;
    const hitRadius = cam.zoom >= ZOOM_THUMB_THRESHOLD ? THUMB_SIZE / 2 : 30 / cam.zoom;
    const nearby = qt.query({ x: wx - hitRadius, y: wy - hitRadius, w: hitRadius * 2, h: hitRadius * 2 });
    let closest: number | null = null;
    let closestDist = Infinity;
    for (const p of nearby) {
      const d = (p.x - wx) ** 2 + (p.y - wy) ** 2;
      if (d < closestDist) { closestDist = d; closest = p.idx; }
    }
    return closest;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cam = cameraRef.current;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.88 : 1.14;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
    const worldX = (mx - rect.width / 2) / cam.zoom + cam.x;
    const worldY = (my - rect.height / 2) / cam.zoom + cam.y;
    cam.x = worldX - (mx - rect.width / 2) / newZoom;
    cam.y = worldY - (my - rect.height / 2) / newZoom;
    cam.zoom = newZoom;
    needsDrawRef.current = true;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, camX: cameraRef.current.x, camY: cameraRef.current.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const cam = cameraRef.current;
      cam.x = drag.camX - (e.clientX - drag.startX) / cam.zoom;
      cam.y = drag.camY - (e.clientY - drag.startY) / cam.zoom;
      needsDrawRef.current = true;
      setHoveredIdx(null);
    } else {
      const { wx, wy } = getWorldPos(e.clientX, e.clientY);
      const idx = findImageAt(wx, wy);
      if (idx !== hoveredIdx) setHoveredIdx(idx);
    }
  }, [getWorldPos, findImageAt, hoveredIdx]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 5) {
      const { wx, wy } = getWorldPos(e.clientX, e.clientY);
      setSelectedIdx(findImageAt(wx, wy));
    }
  }, [getWorldPos, findImageAt]);

  const flyToCluster = useCallback((clusterId: number) => {
    const cluster = data.clusters[String(clusterId)];
    if (!cluster) return;
    cameraRef.current.x = cluster.cx * WORLD_SIZE;
    cameraRef.current.y = cluster.cy * WORLD_SIZE;
    cameraRef.current.zoom = 0.3;
    setSelectedCluster((prev) => (prev === clusterId ? null : clusterId));
    setSelectedIdx(null);
    needsDrawRef.current = true;
  }, [data.clusters]);

  const resetView = useCallback(() => {
    cameraRef.current = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, zoom: MIN_ZOOM * 2.5 };
    setSearchQuery(''); setSelectedCluster(null); setSelectedIdx(null); setHoveredIdx(null);
    needsDrawRef.current = true;
  }, []);

  const selectedImage = selectedIdx !== null ? data.images[selectedIdx] : null;
  const hoveredImage = hoveredIdx !== null && hoveredIdx !== selectedIdx ? data.images[hoveredIdx] : null;

  // ── Render ──
  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: dragRef.current ? 'grabbing' : hoveredIdx !== null ? 'pointer' : 'grab' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Top-left: branding */}
      <div className="absolute top-4 left-5 z-10 pointer-events-none">
        <a href="/" className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors pointer-events-auto">Source Library</a>
        <div className="text-white/70 font-serif text-xl leading-tight">Image Atlas</div>
        <div className="text-white/25 text-xs mt-0.5 font-mono">{stats.totalImages.toLocaleString()} illustrations from {stats.nBooks.toLocaleString()} books</div>
        {loadedCount > 0 && <div className="text-white/15 text-xs mt-0.5 font-mono">{loadedCount.toLocaleString()} thumbnails loaded</div>}
      </div>

      {/* Top-right: controls */}
      <div className="absolute top-4 right-5 z-10 flex items-center gap-2">
        <div className="relative">
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..."
            className="w-48 pl-7 pr-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white/80 placeholder:text-white/25 placeholder:font-mono focus:outline-none focus:border-white/25 transition-colors" />
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchMatches && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">{searchMatches.size}</span>}
        </div>
        {(['type', 'cluster', 'century'] as ColorMode[]).map((mode) => (
          <button key={mode} onClick={() => setColorMode(mode)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${colorMode === mode ? 'bg-white/10 border-white/20 text-white/80' : 'bg-transparent border-white/8 text-white/30 hover:text-white/50 hover:border-white/15'}`}>
            {mode === 'type' ? 'Type' : mode === 'cluster' ? 'Topic' : 'Century'}
          </button>
        ))}
        <button onClick={() => setShowInfo(!showInfo)}
          className={`w-7 h-7 flex items-center justify-center rounded border text-sm font-serif italic transition-colors ${showInfo ? 'bg-white/10 border-white/20 text-white/70' : 'bg-transparent border-white/8 text-white/30 hover:text-white/50'}`}>i</button>
        <button onClick={resetView} className="px-2.5 py-1 text-xs rounded border border-white/8 text-white/30 hover:text-white/50 hover:border-white/15 transition-colors">Reset</button>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div className="absolute top-14 right-5 w-[300px] bg-white/95 backdrop-blur-md border border-black/10 rounded-md p-4 z-20 max-h-[85vh] overflow-y-auto shadow-lg">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><div className="text-gray-800 font-mono text-xl">{stats.totalImages.toLocaleString()}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Images</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.nClusters}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Clusters</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.nTypes}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Image Types</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.nBooks.toLocaleString()}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Books</div></div>
          </div>
          <div className="border-t border-gray-200 pt-3 text-gray-500 text-sm leading-relaxed space-y-2">
            <p>Each point is an illustration extracted from a pre-modern text. Position reflects visual/thematic similarity — AI descriptions are embedded and projected with UMAP.</p>
            <p><strong className="text-gray-600">Zoom in</strong> to see actual thumbnails. Click any image for details.</p>
            <p><strong className="text-gray-600">Embeddings:</strong> <span className="font-mono text-xs">paraphrase-multilingual-MiniLM-L12-v2</span></p>
          </div>
          <div className="border-t border-gray-200 mt-3 pt-3">
            <a href="/research/atlas" className="text-gray-400 text-sm hover:text-gray-600 transition-colors">View Book Atlas &rarr;</a>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredImage && <HoverTooltip image={hoveredImage} />}

      {/* Selected image panel */}
      {selectedImage && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md border border-black/10 rounded-lg p-4 z-20 shadow-2xl max-w-[400px] w-full" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setSelectedIdx(null)} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          <div className="flex gap-4">
            {selectedImage.thumbnail && (
              <div className="shrink-0 rounded overflow-hidden bg-gray-100 w-[140px] h-[140px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedImage.thumbnail} alt={selectedImage.subjects.join(', ') || selectedImage.type} className="w-full h-full object-contain" loading="lazy" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 font-medium">{selectedImage.type.replace(/_/g, ' ')}</span>
                <span className="px-1.5 py-0.5 text-xs rounded bg-amber-50 text-amber-700 font-mono">q{selectedImage.quality.toFixed(2)}</span>
              </div>
              {selectedImage.subjects.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedImage.subjects.slice(0, 4).map((s) => (
                    <span key={s} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{s}</span>
                  ))}
                </div>
              )}
              <a href={`/book/${selectedImage.book_slug || selectedImage.book_id}`} target="_blank" rel="noopener noreferrer"
                className="font-serif text-sm text-gray-900 hover:text-black leading-tight block mb-1">{selectedImage.book_title}</a>
              <div className="text-sm text-gray-500">
                {selectedImage.book_author !== 'Unknown' ? selectedImage.book_author : ''}
                {selectedImage.book_author !== 'Unknown' && selectedImage.book_year ? ' · ' : ''}
                {selectedImage.book_year || ''}
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <a href={`/gallery?book=${selectedImage.book_id}`} target="_blank" rel="noopener noreferrer"
                  className="text-gray-400 hover:text-gray-600 transition-colors">View in Gallery &rarr;</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom-left: legend */}
      <div className="absolute bottom-12 left-5 z-10 bg-black/50 backdrop-blur-sm border border-white/8 rounded p-2.5 max-w-[200px]">
        <div className="grid grid-cols-1 gap-y-0.5">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-xs text-white/50">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.label}</span>
              {item.count > 0 && <span className="ml-auto text-white/25 font-mono">{item.count}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: cluster pills */}
      <div className="absolute bottom-3 left-5 right-5 z-10">
        <ClusterPills clusters={data.clusters} selectedCluster={selectedCluster} onSelect={flyToCluster}
          onClear={() => { setSelectedCluster(null); needsDrawRef.current = true; }} />
      </div>

      <div className="absolute bottom-12 right-5 z-10 text-xs text-white/20 font-mono">
        Scroll to zoom · Drag to pan · Click to inspect
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Hover Tooltip
// ────────────────────────────────────────────────────────────

function HoverTooltip({ image }: { image: ImageItem }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  return (
    <div className="fixed pointer-events-none bg-black/80 backdrop-blur-md border border-white/10 rounded-md p-2.5 max-w-[260px] z-30"
      style={{ left: pos.x + 16, top: pos.y - 40 }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="px-1.5 py-0.5 text-xs rounded bg-white/10 text-white/70">{image.type.replace(/_/g, ' ')}</span>
        {image.subjects.slice(0, 2).map((s) => (
          <span key={s} className="px-1.5 py-0.5 text-xs rounded bg-white/5 text-white/40">{s}</span>
        ))}
      </div>
      <div className="text-sm text-white/60 leading-tight">{image.book_title}{image.book_year ? ` (${image.book_year})` : ''}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Cluster Pills
// ────────────────────────────────────────────────────────────

function ClusterPills({ clusters, selectedCluster, onSelect, onClear }: {
  clusters: Record<string, ClusterInfo>; selectedCluster: number | null;
  onSelect: (id: number) => void; onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => Object.values(clusters).sort((a, b) => b.size - a.size), [clusters]);
  const visible = expanded ? sorted : sorted.slice(0, 20);

  return (
    <div className="flex flex-wrap gap-1">
      <button onClick={onClear}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${selectedCluster === null ? 'bg-white/10 border-white/20 text-white/70' : 'bg-transparent border-white/8 text-white/25 hover:text-white/40'}`}>All</button>
      {visible.map((c) => (
        <button key={c.id} onClick={() => onSelect(c.id)}
          className={`px-2 py-0.5 rounded text-xs border transition-colors ${selectedCluster === c.id ? 'bg-white/10 border-white/20 text-white/70' : 'bg-transparent border-white/8 text-white/25 hover:text-white/40'}`}>
          {c.label}<span className="ml-1 text-white/15 font-mono">{c.size}</span>
        </button>
      ))}
      {sorted.length > 20 && (
        <button onClick={() => setExpanded(!expanded)}
          className="px-2 py-0.5 rounded text-[10px] border border-white/8 text-white/25 hover:text-white/40 transition-colors">
          {expanded ? 'fewer' : `+${sorted.length - 20}`}
        </button>
      )}
    </div>
  );
}
