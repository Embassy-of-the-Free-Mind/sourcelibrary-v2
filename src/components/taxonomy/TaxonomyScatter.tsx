'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface Point {
  id: string;
  t: string;   // title
  a: string;   // author
  y: number | null; // year
  l: string;   // language
  s: string;   // slug
  x: number;   // umap-x (0-1)
  u: number;   // umap-y (0-1)
  ci: number;  // cluster_id
  cn: string;  // cluster name
  sc: string | null; // subcluster
}

interface ClusterSummary {
  id: number;
  name: string;
  count: number;
  cx: number;
  cy: number;
}

interface ScatterData {
  total: number;
  clusters: ClusterSummary[];
  points: Point[];
}

interface AtlasMap {
  tile_w: number;
  tile_h: number;
  cols: number;
  rows: number;
  atlas_w: number;
  atlas_h: number;
  total: number;
  map: Record<string, { c: number; r: number }>;
}

type YMode = 'umap' | 'year';

// 48 distinct colors
const COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff9800', '#673ab7',
  '#4caf50', '#795548', '#607d8b', '#ff5722', '#009688',
  '#8bc34a', '#c9a86c', '#5d8fb5', '#d4924a', '#a067a0',
  '#5e6d52', '#b5835d', '#7c5db5', '#9e4a3a', '#4a9e7c',
  '#d32f2f', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2',
  '#0097a7', '#c2185b', '#0288d1', '#e64a19', '#00796b',
  '#689f38', '#a1887f', '#78909c', '#bf360c', '#00695c',
  '#9e9d24', '#8d6e63', '#546e7a', '#d84315', '#004d40',
  '#827717', '#5d4037', '#455a64',
];

function hexToRgb(hex: string): [number, number, number] {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [100, 100, 100];
}

const YEAR_MIN = -500;
const YEAR_MAX = 1950;

// Zoom thresholds for LOD
const ZOOM_COVERS = 3;     // show covers above this zoom
const ZOOM_LABELS = 6;     // show title labels above this zoom
const ZOOM_DETAILS = 12;   // show full details above this zoom

export default function TaxonomyScatter({ data }: { data: ScatterData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [yMode, setYMode] = useState<YMode>('umap');
  const [hoveredPoint, setHoveredPoint] = useState<Point | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Pan/zoom state: offset in canvas px, scale factor
  const viewRef = useRef({ ox: 0, oy: 0, scale: 1 });
  const [viewVersion, setViewVersion] = useState(0); // trigger redraws
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Atlas state
  const atlasImgRef = useRef<HTMLImageElement | null>(null);
  const atlasMapRef = useRef<AtlasMap | null>(null);
  const [atlasLoaded, setAtlasLoaded] = useState(false);

  // Load texture atlas
  useEffect(() => {
    // Load atlas mapping JSON
    fetch('/atlas/atlas-map.json')
      .then((r) => r.ok ? r.json() : null)
      .then((map: AtlasMap | null) => {
        if (!map) return;
        atlasMapRef.current = map;
        // Load atlas image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          atlasImgRef.current = img;
          setAtlasLoaded(true);
        };
        img.src = '/atlas/covers.jpg';
      })
      .catch(() => {}); // Atlas is optional
  }, []);

  const yearNorm = useCallback((year: number | null) => {
    if (!year) return 0.5;
    const clamped = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
    return (clamped - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
  }, []);

  const getY = useCallback((p: Point) => {
    return yMode === 'umap' ? p.u : yearNorm(p.y);
  }, [yMode, yearNorm]);

  // Data coords (0-1) → canvas px (accounting for pan/zoom)
  const dataToCanvas = useCallback((dx: number, dy: number) => {
    const v = viewRef.current;
    const { w, h } = size;
    // Map data 0-1 to base canvas coords with padding
    const pad = 40;
    const bx = pad + dx * (w - 2 * pad);
    const by = pad + (1 - dy) * (h - 2 * pad);
    // Apply zoom + pan
    return {
      cx: (bx - w / 2) * v.scale + w / 2 + v.ox,
      cy: (by - h / 2) * v.scale + h / 2 + v.oy,
    };
  }, [size]);

  // Canvas px → data coords (0-1)
  const canvasToData = useCallback((cx: number, cy: number) => {
    const v = viewRef.current;
    const { w, h } = size;
    // Reverse zoom + pan
    const bx = (cx - w / 2 - v.ox) / v.scale + w / 2;
    const by = (cy - h / 2 - v.oy) / v.scale + h / 2;
    // Reverse data mapping
    const pad = 40;
    return {
      dx: (bx - pad) / (w - 2 * pad),
      dy: 1 - (by - pad) / (h - 2 * pad),
    };
  }, [size]);

  const clusterColors = useMemo(() => {
    const map: Record<number, string> = {};
    data.clusters.forEach((c) => {
      map[c.id] = COLORS[c.id % COLORS.length];
    });
    return map;
  }, [data.clusters]);

  // Precompute cluster centroids per y-mode
  const clusterCentroids = useMemo(() => {
    const centroids: Record<number, { cx: number; cy: number; count: number }> = {};
    for (const p of data.points) {
      if (!centroids[p.ci]) centroids[p.ci] = { cx: 0, cy: 0, count: 0 };
      centroids[p.ci].cx += p.x;
      centroids[p.ci].cy += (yMode === 'umap' ? p.u : yearNorm(p.y));
      centroids[p.ci].count++;
    }
    for (const c of Object.values(centroids)) {
      c.cx /= c.count;
      c.cy /= c.count;
    }
    return centroids;
  }, [data.points, yMode, yearNorm]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Reset view when y-mode or cluster changes
  useEffect(() => {
    viewRef.current = { ox: 0, oy: 0, scale: 1 };
    setViewVersion((v) => v + 1);
  }, [yMode]);

  // ── DRAW ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.scale(dpr, dpr);

    const v = viewRef.current;
    const { w, h } = size;
    const hasSelection = selectedCluster !== null;
    const showCovers = v.scale >= ZOOM_COVERS && atlasLoaded;
    const showLabels = v.scale >= ZOOM_LABELS;
    const showDetails = v.scale >= ZOOM_DETAILS;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Year axis labels (when in year mode)
    if (yMode === 'year') {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      const years = [-500, 0, 500, 1000, 1200, 1400, 1500, 1600, 1700, 1800, 1900];
      for (const yr of years) {
        const norm = (yr - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
        const { cy } = dataToCanvas(0, norm);
        if (cy < -20 || cy > h + 20) continue;
        ctx.fillText(String(yr), Math.max(30, dataToCanvas(0, norm).cx - 5), cy + 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
      }
    }

    const atlasImg = atlasImgRef.current;
    const atlasMap = atlasMapRef.current;

    // Draw points
    for (const p of data.points) {
      const { cx, cy } = dataToCanvas(p.x, getY(p));

      // Viewport culling
      const margin = showCovers ? 30 : 5;
      if (cx < -margin || cx > w + margin || cy < -margin || cy > h + margin) continue;

      const color = clusterColors[p.ci] || '#666';
      const [r, g, b] = hexToRgb(color);
      const isActive = !hasSelection || p.ci === selectedCluster;

      if (showCovers && atlasImg && atlasMap) {
        // LOD: draw cover thumbnail
        const entry = atlasMap.map[p.id];
        if (entry && isActive) {
          const sx = entry.c * atlasMap.tile_w;
          const sy = entry.r * atlasMap.tile_h;
          // Scale cover size with zoom
          const coverW = Math.min(atlasMap.tile_w * (v.scale / ZOOM_COVERS) * 0.8, 56);
          const coverH = coverW * (atlasMap.tile_h / atlasMap.tile_w);

          // Colored border
          ctx.fillStyle = color;
          ctx.fillRect(cx - coverW / 2 - 1, cy - coverH / 2 - 1, coverW + 2, coverH + 2);

          ctx.drawImage(
            atlasImg,
            sx, sy, atlasMap.tile_w, atlasMap.tile_h,
            cx - coverW / 2, cy - coverH / 2, coverW, coverH,
          );

          // Title label at high zoom
          if (showLabels) {
            const fontSize = Math.min(10, 7 * (v.scale / ZOOM_LABELS));
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.textAlign = 'center';
            const label = p.t.length > 35 ? p.t.slice(0, 33) + '…' : p.t;
            ctx.fillText(label, cx, cy + coverH / 2 + fontSize + 2);

            if (showDetails) {
              ctx.fillStyle = 'rgba(255,255,255,0.4)';
              ctx.font = `${fontSize * 0.8}px Inter, system-ui, sans-serif`;
              const detail = [p.a, p.y].filter(Boolean).join(' · ');
              ctx.fillText(detail, cx, cy + coverH / 2 + fontSize * 2 + 3);
            }
          }
        } else if (!isActive) {
          // Dimmed dot for inactive
          ctx.fillStyle = `rgba(${r},${g},${b},0.05)`;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // No atlas entry, draw colored dot
          ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // LOD: dots only
        const alpha = isActive ? 0.7 : 0.06;
        const radius = isActive ? 2 : 1.2;
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cluster labels (only at low zoom or when not showing per-book labels)
    if (!showLabels) {
      ctx.textAlign = 'center';
      for (const c of data.clusters) {
        if (c.count < 20) continue;
        if (hasSelection && c.id !== selectedCluster) continue;

        const centroid = clusterCentroids[c.id];
        if (!centroid) continue;
        const { cx, cy } = dataToCanvas(centroid.cx, centroid.cy);
        if (cx < -50 || cx > w + 50 || cy < -20 || cy > h + 20) continue;

        const fontSize = Math.max(9, Math.min(14, 11 * v.scale));
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = clusterColors[c.id] || '#666';
        ctx.globalAlpha = 0.6;
        ctx.fillText(c.name, cx, cy);
        ctx.globalAlpha = 1;
      }
    }

    // Zoom indicator
    if (v.scale > 1.05) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${v.scale.toFixed(1)}x`, w - 8, 16);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, size, yMode, selectedCluster, getY, dataToCanvas, clusterColors, clusterCentroids, viewVersion, atlasLoaded]);

  // ── WHEEL ZOOM ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const v = viewRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = size;

    // Zoom toward cursor
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(1, Math.min(50, v.scale * factor));
    const ratio = newScale / v.scale;

    // Adjust offset so zoom centers on cursor
    const cx = w / 2;
    const cy = h / 2;
    v.ox = (v.ox - (mx - cx)) * ratio + (mx - cx);
    v.oy = (v.oy - (my - cy)) * ratio + (my - cy);
    v.scale = newScale;

    setViewVersion((ver) => ver + 1);
  }, [size]);

  // ── DRAG PAN ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (isDraggingRef.current) {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      viewRef.current.ox += dx;
      viewRef.current.oy += dy;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setViewVersion((v) => v + 1);
      setHoveredPoint(null);
      setTooltipPos(null);
      return;
    }

    // Hit testing
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { dx, dy } = canvasToData(mx, my);
    const v = viewRef.current;

    let best: Point | null = null;
    // Threshold scales inversely with zoom
    let bestDist = 0.015 / v.scale;
    for (const p of data.points) {
      if (selectedCluster !== null && p.ci !== selectedCluster) continue;
      const pdx = p.x - dx;
      const pdy = getY(p) - dy;
      const d = Math.sqrt(pdx * pdx + pdy * pdy);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }

    setHoveredPoint(best);
    setTooltipPos(best ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
  }, [data.points, canvasToData, getY, selectedCluster]);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const resetView = useCallback(() => {
    viewRef.current = { ox: 0, oy: 0, scale: 1 };
    setViewVersion((v) => v + 1);
  }, []);

  const zoomLevel = viewRef.current.scale;

  return (
    <div className="relative">
      {/* Controls */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-stone-600 text-xs uppercase tracking-wider">Y-Axis</div>
        <button
          onClick={() => setYMode('umap')}
          className={`px-2.5 py-1 text-xs rounded border transition-colors ${
            yMode === 'umap'
              ? 'bg-stone-800 border-stone-600 text-stone-200'
              : 'bg-transparent border-stone-800 text-stone-500 hover:text-stone-300'
          }`}
        >
          Embedding similarity
        </button>
        <button
          onClick={() => setYMode('year')}
          className={`px-2.5 py-1 text-xs rounded border transition-colors ${
            yMode === 'year'
              ? 'bg-stone-800 border-stone-600 text-stone-200'
              : 'bg-transparent border-stone-800 text-stone-500 hover:text-stone-300'
          }`}
        >
          Year
        </button>
        {zoomLevel > 1.1 && (
          <button
            onClick={resetView}
            className="text-xs text-stone-500 hover:text-stone-300 transition-colors border border-stone-800 rounded px-2 py-0.5"
          >
            Reset zoom
          </button>
        )}
        {selectedCluster !== null && (
          <button
            onClick={() => setSelectedCluster(null)}
            className="ml-auto text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            Clear: {data.clusters.find(c => c.id === selectedCluster)?.name}
          </button>
        )}
      </div>

      {/* Cluster pills */}
      <div className="flex flex-wrap gap-1 mb-3">
        {data.clusters.slice(0, 24).map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCluster(selectedCluster === c.id ? null : c.id)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              selectedCluster === c.id
                ? 'bg-stone-700 border-stone-500 text-stone-100'
                : 'bg-transparent border-stone-800 text-stone-600 hover:text-stone-400'
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-sm mr-1"
              style={{ backgroundColor: clusterColors[c.id] }}
            />
            {c.name}
          </button>
        ))}
        {data.clusters.length > 24 && (
          <span className="text-stone-700 text-[10px] px-1 py-0.5">+{data.clusters.length - 24}</span>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="w-full h-[600px] rounded-lg overflow-hidden border border-stone-800 bg-[#0a0a0a]"
      >
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ width: size.w, height: size.h, touchAction: 'none' }}
          className={isDraggingRef.current ? 'cursor-grabbing' : 'cursor-grab'}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            isDraggingRef.current = false;
            setHoveredPoint(null);
            setTooltipPos(null);
          }}
          onClick={() => {
            if (hoveredPoint && !isDraggingRef.current) {
              window.open(`/book/${hoveredPoint.s}`, '_blank');
            }
          }}
        />
      </div>

      {/* Tooltip */}
      {hoveredPoint && tooltipPos && (
        <div
          className="absolute z-20 pointer-events-none bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm max-w-[320px] shadow-xl"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + 40, // offset below canvas controls
            transform: tooltipPos.x > size.w * 0.7 ? 'translateX(-110%)' : undefined,
          }}
        >
          <div className="text-stone-100 font-medium leading-tight">{hoveredPoint.t}</div>
          <div className="text-stone-400 text-xs mt-0.5">
            {hoveredPoint.a}{hoveredPoint.y ? ` · ${hoveredPoint.y}` : ''} · {hoveredPoint.l}
          </div>
          <div className="text-stone-500 text-xs mt-1 flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-sm"
              style={{ backgroundColor: clusterColors[hoveredPoint.ci] }}
            />
            {hoveredPoint.cn}
            {hoveredPoint.sc && <span className="text-stone-600">/ {hoveredPoint.sc}</span>}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 text-stone-600 text-xs">
        <span>
          {data.total.toLocaleString()} books · Scroll to zoom, drag to pan
          {atlasLoaded && ' · Covers appear at 3x zoom'}
        </span>
        <Link href="/research/atlas?mode=taxonomy" className="hover:text-stone-400 transition-colors">
          View in 3D Atlas →
        </Link>
      </div>
    </div>
  );
}
