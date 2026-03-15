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

type YMode = 'umap' | 'year';

// 48 distinct colors for taxonomy clusters
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
const PADDING = 40;

export default function TaxonomyScatter({ data }: { data: ScatterData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [yMode, setYMode] = useState<YMode>('umap');
  const [hoveredPoint, setHoveredPoint] = useState<Point | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Year normalization: map year to 0-1
  const yearNorm = useCallback((year: number | null) => {
    if (!year) return 0.5;
    const clamped = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
    return (clamped - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
  }, []);

  // Get Y coordinate based on mode
  const getY = useCallback((p: Point) => {
    return yMode === 'umap' ? p.u : yearNorm(p.y);
  }, [yMode, yearNorm]);

  // Canvas → data coordinate mapping
  const toCanvas = useCallback((px: number, py: number) => {
    const { w, h } = size;
    return {
      cx: PADDING + px * (w - 2 * PADDING),
      cy: PADDING + (1 - py) * (h - 2 * PADDING), // flip y
    };
  }, [size]);

  const fromCanvas = useCallback((cx: number, cy: number) => {
    const { w, h } = size;
    return {
      px: (cx - PADDING) / (w - 2 * PADDING),
      py: 1 - (cy - PADDING) / (h - 2 * PADDING),
    };
  }, [size]);

  // Precompute cluster color map
  const clusterColors = useMemo(() => {
    const map: Record<number, string> = {};
    data.clusters.forEach((c) => {
      map[c.id] = COLORS[c.id % COLORS.length];
    });
    return map;
  }, [data.clusters]);

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

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, size.w, size.h);

    // Year axis labels (when in year mode)
    if (yMode === 'year') {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      const years = [-500, 0, 500, 1000, 1200, 1400, 1500, 1600, 1700, 1800, 1900];
      for (const yr of years) {
        const norm = (yr - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
        const { cy } = toCanvas(0, norm);
        ctx.fillText(String(yr), PADDING - 5, cy + 3);
        // Grid line
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.moveTo(PADDING, cy);
        ctx.lineTo(size.w - PADDING, cy);
        ctx.stroke();
      }
    }

    // Draw points
    const hasSelection = selectedCluster !== null;
    for (const p of data.points) {
      const { cx, cy } = toCanvas(p.x, getY(p));
      const color = clusterColors[p.ci] || '#666';
      const [r, g, b] = hexToRgb(color);
      const isActive = !hasSelection || p.ci === selectedCluster;
      const alpha = isActive ? 0.7 : 0.06;
      const radius = isActive ? 2 : 1.2;

      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw cluster labels
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const c of data.clusters) {
      if (c.count < 20) continue;
      if (hasSelection && c.id !== selectedCluster) continue;

      // Compute centroid in current y-mode
      let sumX = 0, sumY = 0, count = 0;
      for (const p of data.points) {
        if (p.ci !== c.id) continue;
        sumX += p.x;
        sumY += getY(p);
        count++;
      }
      if (count === 0) continue;
      const { cx, cy } = toCanvas(sumX / count, sumY / count);

      const color = clusterColors[c.id] || '#666';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.fillText(c.name, cx, cy);
      ctx.globalAlpha = 1;
    }
  }, [data, size, yMode, selectedCluster, getY, toCanvas, clusterColors]);

  // Hit testing on hover
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { px, py } = fromCanvas(mx, my);

    // Find nearest point within threshold
    let best: Point | null = null;
    let bestDist = 0.015; // threshold in normalized space
    for (const p of data.points) {
      if (selectedCluster !== null && p.ci !== selectedCluster) continue;
      const dx = p.x - px;
      const dy = getY(p) - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }

    setHoveredPoint(best);
    setTooltipPos(best ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
  }, [data.points, fromCanvas, getY, selectedCluster]);

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
        {selectedCluster !== null && (
          <button
            onClick={() => setSelectedCluster(null)}
            className="ml-auto text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            Clear filter: {data.clusters.find(c => c.id === selectedCluster)?.name}
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
      <div ref={containerRef} className="w-full h-[500px] rounded-lg overflow-hidden border border-stone-800 bg-[#0a0a0a]">
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ width: size.w, height: size.h }}
          className="cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoveredPoint(null); setTooltipPos(null); }}
          onClick={() => {
            if (hoveredPoint) {
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
            top: tooltipPos.y - 10,
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
        <span>{data.total.toLocaleString()} books · 48 taxonomy clusters · UMAP projection of 768D embeddings</span>
        <Link href="/research/atlas?mode=taxonomy" className="hover:text-stone-400 transition-colors">
          View in 3D Atlas →
        </Link>
      </div>
    </div>
  );
}
