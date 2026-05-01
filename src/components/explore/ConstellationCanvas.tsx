'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConstellationPoint } from './ConstellationLoader';

// Color palette by language family
const LANG_COLORS: Record<string, string> = {
  Latin: '#8b5cf6',
  German: '#3b82f6',
  English: '#10b981',
  French: '#f59e0b',
  Italian: '#ef4444',
  Greek: '#06b6d4',
  Arabic: '#ec4899',
  Hebrew: '#f97316',
  Dutch: '#6366f1',
  Spanish: '#14b8a6',
  Sanskrit: '#a855f7',
  Japanese: '#e11d48',
  Korean: '#be185d',
  Chinese: '#7c3aed',
  Egyptian: '#d97706',
  Persian: '#059669',
  Coptic: '#ca8a04',
  Akkadian: '#b45309',
};
const DEFAULT_COLOR = '#94a3b8';

function getColor(lang: string | null): string {
  if (!lang) return DEFAULT_COLOR;
  return LANG_COLORS[lang] || DEFAULT_COLOR;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface HoveredPoint {
  point: ConstellationPoint;
  screenX: number;
  screenY: number;
}

export default function ConstellationCanvas({ points }: { points: ConstellationPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const draggingRef = useRef(false);
  const dragDistRef = useRef(0);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIds, setHighlightedIds] = useState<Set<string> | null>(null);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const router = useRouter();

  // Build spatial index for hover detection
  const gridRef = useRef<Map<string, number[]>>(new Map());
  const GRID_CELL = 0.02;

  useEffect(() => {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < points.length; i++) {
      const gx = Math.floor(points[i].x / GRID_CELL);
      const gy = Math.floor(points[i].z / GRID_CELL);
      const key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }
    gridRef.current = grid;
  }, [points]);

  // Search handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setHighlightedIds(null);
      return;
    }
    const q = searchQuery.toLowerCase();
    const ids = new Set<string>();
    for (const p of points) {
      if (p.t?.toLowerCase().includes(q) || p.a?.toLowerCase().includes(q)) {
        ids.add(p.id);
      }
    }
    setHighlightedIds(ids.size > 0 ? ids : null);
  }, [searchQuery, points]);

  const toScreen = useCallback((px: number, py: number, canvas: HTMLCanvasElement, t: Transform) => {
    const size = Math.min(canvas.width, canvas.height) * 0.45;
    return {
      sx: canvas.width / 2 + (px * size + t.x) * t.scale,
      sy: canvas.height / 2 + (py * size + t.y) * t.scale,
    };
  }, []);

  const fromScreen = useCallback((sx: number, sy: number, canvas: HTMLCanvasElement, t: Transform) => {
    const size = Math.min(canvas.width, canvas.height) * 0.45;
    return {
      px: (sx - canvas.width / 2) / t.scale / size - t.x / size,
      py: (sy - canvas.height / 2) / t.scale / size - t.y / size,
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t = transformRef.current;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const baseRadius = Math.max(1, 1.5 * t.scale * dpr);
    const hasHighlight = highlightedIds !== null;
    const hasLangFilter = selectedLang !== null;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const { sx, sy } = toScreen(p.x, p.z, canvas, t);

      // Cull off-screen
      if (sx < -10 || sx > canvas.width + 10 || sy < -10 || sy > canvas.height + 10) continue;

      const isHighlighted = hasHighlight && highlightedIds!.has(p.id);
      const isLangMatch = hasLangFilter && p.l === selectedLang;
      const dimmed = (hasHighlight && !isHighlighted) || (hasLangFilter && !isLangMatch);

      ctx.beginPath();
      const r = isHighlighted ? baseRadius * 2.5 : baseRadius;
      ctx.arc(sx, sy, r, 0, Math.PI * 2);

      if (dimmed) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
      } else {
        const color = getColor(p.l);
        ctx.fillStyle = isHighlighted ? color : color + (hasHighlight || hasLangFilter ? 'cc' : '99');
      }
      ctx.fill();
    }

    // Draw hovered point on top
    if (hovered) {
      const { sx, sy } = toScreen(hovered.point.x, hovered.point.z, canvas, t);
      ctx.beginPath();
      ctx.arc(sx, sy, baseRadius * 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = getColor(hovered.point.l);
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
    }
  }, [points, toScreen, highlightedIds, selectedLang, hovered]);

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  // Redraw on state changes
  useEffect(() => { draw(); }, [draw]);

  // Wheel zoom — must be a native non-passive listener so preventDefault works
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.3, Math.min(100, t.scale * factor));

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const mx = (e.clientX - rect.left) * dpr;
      const my = (e.clientY - rect.top) * dpr;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      t.x = (mx - cx) / newScale + t.x - (mx - cx) / t.scale;
      t.y = (my - cy) / newScale + t.y - (my - cy) / t.scale;
      t.scale = newScale;
      draw();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Touch support: drag and pinch-zoom
    let lastTouches: { x: number; y: number }[] = [];
    let lastPinchDist = 0;
    let touchDragDist = 0;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      touchDragDist = 0;
      lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      if (e.touches.length === 2) {
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      const dpr = window.devicePixelRatio || 1;

      if (e.touches.length === 1 && lastTouches.length >= 1) {
        const dx = (e.touches[0].clientX - lastTouches[0].x) * dpr;
        const dy = (e.touches[0].clientY - lastTouches[0].y) * dpr;
        touchDragDist += Math.abs(dx) + Math.abs(dy);
        t.x += dx / t.scale;
        t.y += dy / t.scale;
        draw();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (lastPinchDist > 0) {
          const factor = dist / lastPinchDist;
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const rect = canvas.getBoundingClientRect();
          const mx = (midX - rect.left) * dpr;
          const my = (midY - rect.top) * dpr;
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          const newScale = Math.max(0.3, Math.min(100, t.scale * factor));
          t.x = (mx - cx) / newScale + t.x - (mx - cx) / t.scale;
          t.y = (my - cy) / newScale + t.y - (my - cy) / t.scale;
          t.scale = newScale;
          draw();
        }
        lastPinchDist = dist;
      }
      lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // Tap to select — single finger, minimal drag
      if (e.changedTouches.length === 1 && touchDragDist < 10) {
        const touch = e.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const sx = (touch.clientX - rect.left) * dpr;
        const sy = (touch.clientY - rect.top) * dpr;
        const tt = transformRef.current;
        const size = Math.min(canvas.width, canvas.height) * 0.45;
        const px = (sx - canvas.width / 2) / tt.scale / size - tt.x / size;
        const py = (sy - canvas.height / 2) / tt.scale / size - tt.y / size;
        const searchRadius = 12 / (tt.scale * size);

        let nearest: { idx: number; dist: number } | null = null;
        const gx = Math.floor(px / GRID_CELL);
        const gy = Math.floor(py / GRID_CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const indices = gridRef.current.get(`${gx + dx},${gy + dy}`);
            if (!indices) continue;
            for (const i of indices) {
              const p = points[i];
              const d = Math.hypot(p.x - px, p.z - py);
              if (d < searchRadius && (!nearest || d < nearest.dist)) {
                nearest = { idx: i, dist: d };
              }
            }
          }
        }
        if (nearest) {
          window.location.href = `/book/${points[nearest.idx].id}`;
        }
      }
      lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      if (e.touches.length < 2) lastPinchDist = 0;
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [draw, points]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    dragDistRef.current = 0;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    if (draggingRef.current) {
      const dx = (e.clientX - lastMouseRef.current.x) * dpr;
      const dy = (e.clientY - lastMouseRef.current.y) * dpr;
      dragDistRef.current += Math.abs(dx) + Math.abs(dy);
      transformRef.current.x += dx / transformRef.current.scale;
      transformRef.current.y += dy / transformRef.current.scale;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setHovered(null);
      draw();
      return;
    }

    // Hover detection using spatial grid
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * dpr;
      const sy = (e.clientY - rect.top) * dpr;
      const t = transformRef.current;
      const size = Math.min(canvas.width, canvas.height) * 0.45;
      const px = (sx - canvas.width / 2) / t.scale / size - t.x / size;
      const py = (sy - canvas.height / 2) / t.scale / size - t.y / size;

      const searchRadius = 5 / (t.scale * size); // 5px in data space
      let nearest: { idx: number; dist: number } | null = null;

      const gx = Math.floor(px / GRID_CELL);
      const gy = Math.floor(py / GRID_CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const indices = gridRef.current.get(`${gx + dx},${gy + dy}`);
          if (!indices) continue;
          for (const i of indices) {
            const p = points[i];
            const d = Math.hypot(p.x - px, p.z - py);
            if (d < searchRadius && (!nearest || d < nearest.dist)) {
              nearest = { idx: i, dist: d };
            }
          }
        }
      }

      if (nearest) {
        const p = points[nearest.idx];
        setHovered({ point: p, screenX: e.clientX, screenY: e.clientY });
      } else {
        setHovered(null);
      }
    });
  }, [points, draw]);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
    setIsDragging(false);
  }, []);

  const findNearestPoint = useCallback((clientX: number, clientY: number): ConstellationPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) * dpr;
    const sy = (clientY - rect.top) * dpr;
    const t = transformRef.current;
    const size = Math.min(canvas.width, canvas.height) * 0.45;
    const px = (sx - canvas.width / 2) / t.scale / size - t.x / size;
    const py = (sy - canvas.height / 2) / t.scale / size - t.y / size;
    const searchRadius = 8 / (t.scale * size);

    let nearest: { idx: number; dist: number } | null = null;
    const gx = Math.floor(px / GRID_CELL);
    const gy = Math.floor(py / GRID_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const indices = gridRef.current.get(`${gx + dx},${gy + dy}`);
        if (!indices) continue;
        for (const i of indices) {
          const p = points[i];
          const d = Math.hypot(p.x - px, p.z - py);
          if (d < searchRadius && (!nearest || d < nearest.dist)) {
            nearest = { idx: i, dist: d };
          }
        }
      }
    }
    return nearest ? points[nearest.idx] : null;
  }, [points]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Ignore if this was a drag
    if (dragDistRef.current > 5) return;
    const point = findNearestPoint(e.clientX, e.clientY);
    if (point) {
      router.push(`/book/${point.id}`);
    }
  }, [findNearestPoint, router]);

  // Collect unique languages for legend
  const langCounts = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const counts = new Map<string, number>();
    for (const p of points) {
      const l = p.l || 'Unknown';
      counts.set(l, (counts.get(l) || 0) + 1);
    }
    langCounts.current = counts;
  }, [points]);

  const topLangs = Array.from(langCounts.current.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
      {/* Search bar */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search books..."
          className="bg-white/90 backdrop-blur-sm border border-stone-200 rounded-lg px-3 py-1.5 text-sm w-56 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        {searchQuery && highlightedIds && (
          <span className="self-center text-xs text-stone-500 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1.5 shadow-sm">
            {highlightedIds.size.toLocaleString()} matches
          </span>
        )}
      </div>

      {/* Language legend */}
      <div className="absolute top-4 right-4 z-20 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-sm border border-stone-200 max-w-[180px]">
        <p className="text-xs font-medium text-stone-600 mb-2">Languages</p>
        <div className="flex flex-wrap gap-1">
          {topLangs.map(([lang, count]) => (
            <button
              key={lang}
              onClick={() => setSelectedLang(selectedLang === lang ? null : lang)}
              className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
                selectedLang === lang
                  ? 'bg-stone-200 text-stone-900'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: getColor(lang) }}
              />
              {lang}
              <span className="text-stone-400">{count > 999 ? `${(count/1000).toFixed(1)}k` : count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="absolute bottom-4 left-4 z-20 text-xs text-stone-400 bg-white/80 backdrop-blur-sm rounded px-2 py-1">
        {points.length.toLocaleString()} items &middot; scroll to zoom &middot; drag to pan &middot; click to open
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute z-30 pointer-events-none bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 px-3 py-2 max-w-xs"
          style={{
            left: Math.min(hovered.screenX + 12, (containerRef.current?.getBoundingClientRect().right ?? window.innerWidth) - 300),
            top: hovered.screenY - (containerRef.current?.getBoundingClientRect().top ?? 0) + 12,
          }}
        >
          <p className="text-sm font-medium text-stone-900 line-clamp-2">{hovered.point.t}</p>
          {hovered.point.a && (
            <p className="text-xs text-stone-500 mt-0.5">{hovered.point.a}</p>
          )}
          <div className="flex gap-2 mt-1 text-xs text-stone-400">
            {hovered.point.y && <span>{hovered.point.y}</span>}
            {hovered.point.l && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getColor(hovered.point.l) }} />
                {hovered.point.l}
              </span>
            )}
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`w-full h-full ${isDragging ? 'cursor-grabbing' : hovered ? 'cursor-pointer' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />
    </div>
  );
}
