'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface Book {
  id: string;
  title: string;
  author: string;
  year: number | null;
  language: string;
  category: string;
  categories: string[];
  keywords: string[];
  thumbnail: string | null;
  slug: string;
  pages: number;
  first_translation: boolean;
  x: number;
  y: number;
  cluster: number;
}

interface ClusterInfo {
  id: number;
  size: number;
  top_category: string;
  label_keywords: string[];
  cx: number;
  cy: number;
}

interface ConstellationData {
  meta: {
    total_books: number;
    n_clusters: number;
    model: string;
    generated_at: string;
  };
  clusters: Record<string, ClusterInfo>;
  books: Book[];
}

// ────────────────────────────────────────────────────────────
// Color Maps
// ────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  alchemy: '#c9a86c',
  theology: '#7c5db5',
  philosophy: '#5d8fb5',
  hermeticism: '#9e4a3a',
  history: '#8b9a7d',
  'natural-philosophy': '#5e6d52',
  mysticism: '#a067a0',
  astrology: '#d4924a',
  medicine: '#4a9e7c',
  kabbalah: '#b5835d',
  magic: '#8a4a6a',
  mathematics: '#5d7ab5',
  science: '#4a8a8a',
  literature: '#7a6a5a',
  astronomy: '#4a6a9e',
  freemasonry: '#6a7a4a',
  rosicrucianism: '#9a5a5a',
  occultism: '#6a4a8a',
  art: '#b56a5d',
  music: '#5a8a6a',
};

const LANGUAGE_COLORS: Record<string, string> = {
  Latin: '#9e4a3a',
  English: '#5d8fb5',
  German: '#8b9a7d',
  French: '#7c5db5',
  Chinese: '#c9a86c',
  Sanskrit: '#d4924a',
  Italian: '#4a9e7c',
  Dutch: '#5e6d52',
  Hebrew: '#b5835d',
  Arabic: '#a067a0',
  Greek: '#5d7ab5',
};

type ColorMode = 'category' | 'language' | 'century';

function getCenturyColor(year: number | null): string {
  if (!year) return '#aaa';
  if (year < 0) return '#d4924a';
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

function getBookColor(book: Book, mode: ColorMode): string {
  switch (mode) {
    case 'category':
      return CATEGORY_COLORS[book.category] || '#888';
    case 'language':
      return LANGUAGE_COLORS[book.language] || '#888';
    case 'century':
      return getCenturyColor(book.year);
  }
}

// ────────────────────────────────────────────────────────────
// Spatial index for fast hover lookup
// ────────────────────────────────────────────────────────────

class GridIndex {
  private cells: Map<string, number[]> = new Map();
  private cellSize: number;

  constructor(
    private books: Book[],
    cellSize = 0.02,
  ) {
    this.cellSize = cellSize;
    for (let i = 0; i < books.length; i++) {
      const key = this.key(books[i].x, books[i].y);
      const cell = this.cells.get(key);
      if (cell) cell.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  findNearest(x: number, y: number, maxDist: number): number | null {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    let bestIdx: number | null = null;
    let bestDist = maxDist * maxDist;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.cells.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const idx of cell) {
          const bx = this.books[idx].x - x;
          const by = this.books[idx].y - y;
          const d2 = bx * bx + by * by;
          if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = idx;
          }
        }
      }
    }
    return bestIdx;
  }
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

const POINT_RADIUS = 3;
const HOVER_RADIUS = 6;

export default function BookConstellationViz({ data }: { data: ConstellationData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // View state — pan/zoom
  const [viewState, setViewState] = useState({
    cx: 0.5,
    cy: 0.5,
    scale: 1,
  });

  // Interaction state
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('category');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });

  // Dragging state (refs to avoid re-renders)
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Spatial index
  const gridIndex = useMemo(() => new GridIndex(data.books), [data.books]);

  // Filter books by search
  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    const q = searchQuery.toLowerCase();
    const matches = new Set<number>();
    data.books.forEach((b, i) => {
      if (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.keywords.some((k) => k.toLowerCase().includes(q)) ||
        b.categories.some((c) => c.toLowerCase().includes(q))
      ) {
        matches.add(i);
      }
    });
    return matches;
  }, [searchQuery, data.books]);

  // ── Canvas size tracking ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.max(400, Math.min(w * 0.67, 700));
        setCanvasSize({ w, h });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Coordinate transforms ──
  const dataToCanvas = useCallback(
    (dx: number, dy: number) => {
      const { cx, cy, scale } = viewState;
      const s = Math.min(canvasSize.w, canvasSize.h) * scale;
      return {
        x: canvasSize.w / 2 + (dx - cx) * s,
        y: canvasSize.h / 2 + (dy - cy) * s,
      };
    },
    [viewState, canvasSize],
  );

  const canvasToData = useCallback(
    (px: number, py: number) => {
      const { cx, cy, scale } = viewState;
      const s = Math.min(canvasSize.w, canvasSize.h) * scale;
      return {
        x: cx + (px - canvasSize.w / 2) / s,
        y: cy + (py - canvasSize.h / 2) / s,
      };
    },
    [viewState, canvasSize],
  );

  // ── Render ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#fdfcf9';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    const hasSearch = searchMatches && searchMatches.size > 0;
    const hasClusterFilter = selectedCluster !== null;

    // Draw points
    for (let i = 0; i < data.books.length; i++) {
      const book = data.books[i];
      const pos = dataToCanvas(book.x, book.y);

      // Skip offscreen
      if (pos.x < -10 || pos.x > canvasSize.w + 10 || pos.y < -10 || pos.y > canvasSize.h + 10)
        continue;

      const isMatch = hasSearch ? searchMatches!.has(i) : true;
      const isClusterMatch = hasClusterFilter ? book.cluster === selectedCluster : true;
      const isHighlighted = isMatch && isClusterMatch;
      const isHovered = i === hoveredIdx;

      const color = getBookColor(book, colorMode);
      const r = isHovered ? HOVER_RADIUS : isHighlighted ? POINT_RADIUS : 2;
      const alpha = isHighlighted ? (hasSearch || hasClusterFilter ? 1 : 0.7) : 0.08;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();

      if (isHovered) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#1a1612';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;

    // Draw cluster labels when zoomed out
    if (viewState.scale < 2.5) {
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const [, cluster] of Object.entries(data.clusters)) {
        const pos = dataToCanvas(cluster.cx, cluster.cy);
        if (pos.x < -50 || pos.x > canvasSize.w + 50 || pos.y < -50 || pos.y > canvasSize.h + 50)
          continue;

        const label = cluster.label_keywords.slice(0, 2).join(', ');
        if (!label) continue;

        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#6b6560';
        ctx.fillText(label, pos.x, pos.y);
      }
      ctx.globalAlpha = 1;
    }
  }, [data, viewState, canvasSize, colorMode, hoveredIdx, searchMatches, selectedCluster, dataToCanvas]);

  // ── Mouse handlers ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (isDragging.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };

        const s = Math.min(canvasSize.w, canvasSize.h) * viewState.scale;
        setViewState((prev) => ({
          ...prev,
          cx: prev.cx - dx / s,
          cy: prev.cy - dy / s,
        }));
        return;
      }

      // Hover detection
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dataPos = canvasToData(px, py);

      const hitRadius = 0.015 / viewState.scale;
      const idx = gridIndex.findNearest(dataPos.x, dataPos.y, hitRadius);
      setHoveredIdx(idx);
    },
    [canvasSize, viewState, canvasToData, gridIndex],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false;
    setHoveredIdx(null);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setViewState((prev) => ({
        ...prev,
        scale: Math.max(0.5, Math.min(20, prev.scale * factor)),
      }));
    },
    [],
  );

  const handleClick = useCallback(() => {
    if (hoveredIdx !== null) {
      const book = data.books[hoveredIdx];
      window.open(`/book/${book.slug}`, '_blank');
    }
  }, [hoveredIdx, data.books]);

  // ── Reset view ──
  const resetView = useCallback(() => {
    setViewState({ cx: 0.5, cy: 0.5, scale: 1 });
    setSearchQuery('');
    setSelectedCluster(null);
  }, []);

  // ── Tooltip data ──
  const hoveredBook = hoveredIdx !== null ? data.books[hoveredIdx] : null;
  const tooltipPos = hoveredBook ? dataToCanvas(hoveredBook.x, hoveredBook.y) : null;

  // ── Legend items ──
  const legendItems = useMemo(() => {
    if (colorMode === 'category') {
      const counts: Record<string, number> = {};
      data.books.forEach((b) => {
        counts[b.category] = (counts[b.category] || 0) + 1;
      });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([cat, count]) => ({
          label: cat.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          color: CATEGORY_COLORS[cat] || '#888',
          count,
        }));
    }
    if (colorMode === 'language') {
      const counts: Record<string, number> = {};
      data.books.forEach((b) => {
        counts[b.language] = (counts[b.language] || 0) + 1;
      });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([lang, count]) => ({
          label: lang,
          color: LANGUAGE_COLORS[lang] || '#888',
          count,
        }));
    }
    // century
    return [
      { label: 'Before 500', color: getCenturyColor(100), count: 0 },
      { label: '500–999', color: getCenturyColor(700), count: 0 },
      { label: '1000–1199', color: getCenturyColor(1100), count: 0 },
      { label: '1200–1399', color: getCenturyColor(1300), count: 0 },
      { label: '1400–1499', color: getCenturyColor(1450), count: 0 },
      { label: '1500–1599', color: getCenturyColor(1550), count: 0 },
      { label: '1600–1699', color: getCenturyColor(1650), count: 0 },
      { label: '1700+', color: getCenturyColor(1750), count: 0 },
    ];
  }, [colorMode, data.books]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search books, authors, keywords..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-[var(--border-light)] rounded-lg bg-white focus:outline-none focus:border-[var(--accent-violet)]"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchMatches && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-faint)]">
              {searchMatches.size} found
            </span>
          )}
        </div>

        {/* Color mode */}
        <div className="flex items-center gap-1 text-sm">
          <span className="text-[var(--text-muted)] mr-1">Color:</span>
          {(['category', 'language', 'century'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setColorMode(mode)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                colorMode === mode
                  ? 'bg-[var(--accent-violet)] text-white'
                  : 'bg-[var(--bg-warm)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Reset */}
        <button
          onClick={resetView}
          className="px-2.5 py-1 rounded text-xs bg-[var(--bg-warm)] text-[var(--text-secondary)] hover:bg-[var(--border-light)] transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="relative w-full rounded-lg overflow-hidden border border-[var(--border-light)]">
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.w, height: canvasSize.h, cursor: hoveredIdx !== null ? 'pointer' : 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onClick={handleClick}
        />

        {/* Tooltip */}
        {hoveredBook && tooltipPos && (
          <div
            className="absolute pointer-events-none bg-white border border-[var(--border-medium)] rounded-lg shadow-lg p-3 max-w-[280px] z-10"
            style={{
              left: Math.min(tooltipPos.x + 12, canvasSize.w - 290),
              top: Math.min(tooltipPos.y - 10, canvasSize.h - 100),
            }}
          >
            <div className="font-serif text-sm font-medium text-[var(--text-primary)] leading-tight mb-1">
              {hoveredBook.title}
            </div>
            <div className="text-xs text-[var(--text-muted)] mb-1.5">
              {hoveredBook.author !== 'Unknown' ? hoveredBook.author : ''}
              {hoveredBook.author !== 'Unknown' && hoveredBook.year ? ' · ' : ''}
              {hoveredBook.year || ''}
            </div>
            <div className="flex flex-wrap gap-1">
              {hoveredBook.categories.slice(0, 3).map((cat) => (
                <span
                  key={cat}
                  className="px-1.5 py-0.5 text-[10px] rounded"
                  style={{
                    backgroundColor: (CATEGORY_COLORS[cat] || '#888') + '20',
                    color: CATEGORY_COLORS[cat] || '#888',
                  }}
                >
                  {cat.replace(/-/g, ' ')}
                </span>
              ))}
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-warm)] text-[var(--text-muted)]">
                {hoveredBook.language}
              </span>
            </div>
            {hoveredBook.first_translation && (
              <div className="text-[10px] text-[var(--accent-rust)] mt-1 font-medium">
                First English Translation
              </div>
            )}
            <div className="text-[10px] text-[var(--text-faint)] mt-1">Click to open</div>
          </div>
        )}

        {/* Legend (inside canvas area) */}
        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg p-2 border border-[var(--border-light)] max-w-[200px]">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Zoom hint */}
        <div className="absolute bottom-3 right-3 text-[10px] text-[var(--text-faint)] bg-white/80 px-2 py-1 rounded">
          Scroll to zoom · Drag to pan
        </div>
      </div>

      {/* Cluster pills (below canvas) */}
      {Object.keys(data.clusters).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          <button
            onClick={() => setSelectedCluster(null)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              selectedCluster === null
                ? 'bg-[var(--text-primary)] text-white'
                : 'bg-[var(--bg-warm)] text-[var(--text-muted)] hover:bg-[var(--border-light)]'
            }`}
          >
            All
          </button>
          {Object.values(data.clusters)
            .sort((a, b) => b.size - a.size)
            .slice(0, 15)
            .map((cluster) => {
              const label = cluster.label_keywords.slice(0, 2).join(', ') || `Cluster ${cluster.id}`;
              return (
                <button
                  key={cluster.id}
                  onClick={() => setSelectedCluster(selectedCluster === cluster.id ? null : cluster.id)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    selectedCluster === cluster.id
                      ? 'bg-[var(--accent-violet)] text-white'
                      : 'bg-[var(--bg-warm)] text-[var(--text-muted)] hover:bg-[var(--border-light)]'
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-60">{cluster.size}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
