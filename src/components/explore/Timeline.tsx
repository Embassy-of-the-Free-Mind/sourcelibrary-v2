'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';

export interface TimelineEntity {
  name: string;
  type: 'person' | 'concept';
  birth_year: number | null;
  death_year: number | null;
  book_count: number;
  total_mentions: number;
  description?: string;
  tradition?: string;
}

interface TimelineProps {
  entities: TimelineEntity[];
  stats: {
    total: number;
    year_range: [number, number];
    by_century: Record<string, number>;
  };
}

const TYPE_COLORS: Record<string, string> = {
  person: '#9e4a3a',
  concept: '#7c5db5',
};

const TRADITION_COLORS: Record<string, { color: string; label: string }> = {
  hermeticism: { color: '#c9a86c', label: 'Alchemy & Hermeticism' },
  philosophy:  { color: '#7c5db5', label: 'Philosophy' },
  magic:       { color: '#9e4a3a', label: 'Magic & Astrology' },
  mysticism:   { color: '#4a7ab5', label: 'Mysticism & Theology' },
  kabbalah:    { color: '#5b9e8e', label: 'Kabbalah' },
  rosicrucianism: { color: '#b55d7c', label: 'Rosicrucianism' },
  science:     { color: '#8b9a7d', label: 'Science & Medicine' },
  other:       { color: '#999', label: 'Other' },
};

const BAR_HEIGHT = 14;
const BAR_GAP = 2;
const LANE_HEIGHT = BAR_HEIGHT + BAR_GAP;
const HISTOGRAM_HEIGHT = 80;
const HEADER_HEIGHT = 30;
const MIN_BAR_WIDTH_PX = 3;

/** Parse year from date strings like "1572", "0384", "1707-05-23" */
function parseYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const y = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(y) || y <= 0 ? null : y;
}

/** Format year for display — shows BCE for negative years */
function formatYear(y: number): string {
  if (y < 0) return `${Math.abs(y)} BCE`;
  return String(y);
}

interface Lane {
  endYear: number;
}

interface PackedEntity {
  entity: TimelineEntity;
  startYear: number;
  endYear: number;
  lane: number;
  estimated: boolean; // death year was estimated
}

/**
 * Swim-lane packing: assign each entity to the first lane
 * where its start doesn't overlap the previous bar's end.
 */
function packEntities(
  entities: TimelineEntity[],
  yearToX: (y: number) => number,
  pxPerYear: number
): PackedEntity[] {
  // Filter to entities with at least a birth year, sort by birth
  const withDates = entities
    .filter((e) => e.birth_year !== null)
    .map((e) => {
      const startYear = e.birth_year!;
      let endYear = e.death_year ?? startYear + 70;
      const estimated = e.death_year === null;
      // Ensure minimum visual width
      const minYearSpan = MIN_BAR_WIDTH_PX / pxPerYear;
      if (endYear - startYear < minYearSpan) {
        endYear = startYear + minYearSpan;
      }
      return { entity: e, startYear, endYear, estimated, lane: 0 };
    })
    .sort((a, b) => a.startYear - b.startYear);

  const lanes: Lane[] = [];
  // Minimum gap in pixels between bars in the same lane
  const gapPx = 2;
  const gapYears = gapPx / pxPerYear;

  for (const item of withDates) {
    let assigned = false;
    for (let i = 0; i < lanes.length; i++) {
      if (item.startYear >= lanes[i].endYear + gapYears) {
        item.lane = i;
        lanes[i].endYear = item.endYear;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      item.lane = lanes.length;
      lanes.push({ endYear: item.endYear });
    }
  }

  return withDates;
}

function DensityHistogram({
  byCentury,
  viewStart,
  viewEnd,
  yearToX,
  width,
  onCenturyClick,
}: {
  byCentury: Record<string, number>;
  viewStart: number;
  viewEnd: number;
  yearToX: (y: number) => number;
  width: number;
  onCenturyClick: (century: number) => void;
}) {
  const centuries = Object.entries(byCentury)
    .map(([c, count]) => ({ century: parseInt(c, 10), count }))
    .sort((a, b) => a.century - b.century);

  const maxCount = Math.max(...centuries.map((c) => c.count), 1);

  return (
    <g>
      {/* Background */}
      <rect x={0} y={0} width={width} height={HISTOGRAM_HEIGHT} fill="var(--bg-warm)" opacity={0.5} />

      {centuries.map(({ century, count }) => {
        // Century ranges differ for positive (CE) vs negative (BCE)
        const centuryStart = century > 0
          ? (century - 1) * 100 + 1
          : century * 100;
        const centuryEnd = century > 0
          ? century * 100
          : (century + 1) * 100 - 1;
        const x = yearToX(centuryStart);
        const x2 = yearToX(centuryEnd);
        const barW = x2 - x;

        if (barW < 0.5) return null;

        const barH = (count / maxCount) * (HISTOGRAM_HEIGHT - 20);
        const barY = HISTOGRAM_HEIGHT - barH - 4;

        // Format label: "5 BCE" for negative, "15" for positive
        const label = century < 0 ? `${Math.abs(century)} BCE` : String(century);

        return (
          <g
            key={century}
            style={{ cursor: 'pointer' }}
            onClick={() => onCenturyClick(century)}
          >
            <rect
              x={x}
              y={barY}
              width={Math.max(barW - 1, 1)}
              height={barH}
              fill="var(--accent-rust)"
              opacity={centuryStart >= viewStart && centuryEnd <= viewEnd ? 0.6 : 0.2}
              rx={1}
            />
            {barW > 20 && (
              <text
                x={x + barW / 2}
                y={HISTOGRAM_HEIGHT - 1}
                textAnchor="middle"
                fontSize={9}
                fill="var(--text-muted)"
                fontFamily="var(--font-sans)"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* Label */}
      <text x={4} y={12} fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
        entities per century
      </text>
    </g>
  );
}

function TimelineAxis({
  viewStart,
  viewEnd,
  yearToX,
  y,
}: {
  viewStart: number;
  viewEnd: number;
  yearToX: (y: number) => number;
  y: number;
}) {
  const span = viewEnd - viewStart;
  let step: number;
  if (span > 1000) step = 200;
  else if (span > 500) step = 100;
  else if (span > 200) step = 50;
  else if (span > 100) step = 25;
  else step = 10;

  const firstTick = Math.ceil(viewStart / step) * step;
  const ticks: number[] = [];
  for (let t = firstTick; t <= viewEnd; t += step) {
    ticks.push(t);
  }

  return (
    <g>
      {ticks.map((tick) => {
        const x = yearToX(tick);
        return (
          <g key={tick}>
            <line x1={x} x2={x} y1={y} y2={y + 6} stroke="var(--border-medium)" strokeWidth={1} />
            <text
              x={x}
              y={y + 18}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
              fontFamily="var(--font-sans)"
            >
              {formatYear(tick)}
            </text>
          </g>
        );
      })}
      <line x1={0} x2={yearToX(viewEnd)} y1={y} y2={y} stroke="var(--border-light)" strokeWidth={1} />
    </g>
  );
}

export default function Timeline({ entities, stats }: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);

  // View state (year range currently visible)
  const [viewStart, setViewStart] = useState(1350);
  const [viewEnd, setViewEnd] = useState(1750);

  // Filters
  const [minBooks, setMinBooks] = useState(2);
  const [colorMode, setColorMode] = useState<'type' | 'books' | 'tradition'>('tradition');
  const [showTypes, setShowTypes] = useState(new Set(['person', 'concept']));

  // Tooltip
  const [tooltip, setTooltip] = useState<{
    entity: TimelineEntity;
    x: number;
    y: number;
  } | null>(null);

  // Track scrolling to prevent click-on-scroll
  const didScrollRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(containerRef.current);

    const el = containerRef.current;
    const onScroll = () => {
      didScrollRef.current = true;
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => { didScrollRef.current = false; }, 150);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, []);

  // Entities already have numeric birth_year/death_year from the server
  const parsed = entities;

  // Apply filters
  const filtered = useMemo(() => {
    return parsed.filter((e) => {
      if (!showTypes.has(e.type)) return false;
      if (e.book_count < minBooks) return false;
      if (e.birth_year === null) return false;
      return true;
    });
  }, [parsed, showTypes, minBooks]);

  const svgWidth = containerWidth;
  const pxPerYear = svgWidth / (viewEnd - viewStart);
  const yearToX = useCallback(
    (year: number) => (year - viewStart) * pxPerYear,
    [viewStart, pxPerYear]
  );

  // Pack into swim lanes
  const packed = useMemo(
    () => packEntities(filtered, yearToX, pxPerYear),
    [filtered, yearToX, pxPerYear]
  );

  const maxLane = packed.length > 0 ? Math.max(...packed.map((p) => p.lane)) + 1 : 1;
  const barsHeight = maxLane * LANE_HEIGHT + 20;
  const axisY = HISTOGRAM_HEIGHT + HEADER_HEIGHT;
  const barsY = axisY + 24;
  const svgHeight = barsY + barsHeight + 20;

  // Max book count for gradient coloring
  const maxBookCount = useMemo(
    () => Math.max(...filtered.map((e) => e.book_count), 1),
    [filtered]
  );

  function getBarColor(entity: TimelineEntity): string {
    if (colorMode === 'type') {
      return TYPE_COLORS[entity.type] || '#999';
    }
    if (colorMode === 'tradition') {
      return TRADITION_COLORS[entity.tradition || 'other']?.color || '#999';
    }
    // Book count gradient: light sage → dark rust
    const t = Math.min(entity.book_count / maxBookCount, 1);
    const r = Math.round(139 + t * (158 - 139));
    const g = Math.round(154 + t * (74 - 154));
    const b = Math.round(125 + t * (58 - 125));
    return `rgb(${r},${g},${b})`;
  }

  // Wheel: Ctrl/Cmd+wheel = zoom, Shift+wheel = horizontal pan, plain = vertical scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.shiftKey) {
        // Horizontal pan
        e.preventDefault();
        const span = viewEnd - viewStart;
        const delta = (e.deltaY || e.deltaX) * (span / svgWidth) * 1.5;
        setViewStart((s) => Math.round(s + delta));
        setViewEnd((s) => Math.round(s + delta));
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return; // let normal scroll pass through
      e.preventDefault();
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseYear = viewStart + (mouseX / svgWidth) * (viewEnd - viewStart);

      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newSpan = Math.max(30, Math.min(3000, (viewEnd - viewStart) * zoomFactor));

      const ratio = (mouseYear - viewStart) / (viewEnd - viewStart);
      const newStart = Math.round(mouseYear - ratio * newSpan);
      const newEnd = Math.round(mouseYear + (1 - ratio) * newSpan);

      setViewStart(newStart);
      setViewEnd(newEnd);
    },
    [viewStart, viewEnd, svgWidth]
  );

  // Drag pan — detect direction: horizontal = pan timeline, vertical = scroll page
  // 'pending' = haven't committed to a direction yet
  const dragRef = useRef<{
    startX: number; startY: number;
    startViewStart: number; startViewEnd: number;
    mode: 'pending' | 'pan' | 'scroll';
    moved: boolean;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startViewStart: viewStart,
        startViewEnd: viewEnd,
        mode: 'pending',
        moved: false,
      };
    },
    [viewStart, viewEnd]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      if (dragRef.current.mode === 'pending') {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < 5) return; // wait for meaningful movement
        // Commit to direction: mostly horizontal = pan, mostly vertical = scroll
        dragRef.current.mode = Math.abs(dx) > Math.abs(dy) ? 'pan' : 'scroll';
        dragRef.current.moved = true;
      }

      if (dragRef.current.mode === 'scroll') return; // let browser handle vertical scroll

      // Horizontal pan
      const yearDelta = -(dx / svgWidth) * (dragRef.current.startViewEnd - dragRef.current.startViewStart);
      setViewStart(Math.round(dragRef.current.startViewStart + yearDelta));
      setViewEnd(Math.round(dragRef.current.startViewEnd + yearDelta));
    };
    const handleMouseUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [svgWidth]);

  // Touch pan — same direction detection
  const touchRef = useRef<{
    startX: number; startY: number;
    startViewStart: number; startViewEnd: number;
    mode: 'pending' | 'pan' | 'scroll';
    moved: boolean;
  } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startViewStart: viewStart,
        startViewEnd: viewEnd,
        mode: 'pending',
        moved: false,
      };
    },
    [viewStart, viewEnd]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchRef.current.startX;
      const dy = e.touches[0].clientY - touchRef.current.startY;

      if (touchRef.current.mode === 'pending') {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < 5) return;
        touchRef.current.mode = Math.abs(dx) > Math.abs(dy) ? 'pan' : 'scroll';
        touchRef.current.moved = true;
      }

      if (touchRef.current.mode === 'scroll') return; // let browser scroll

      const yearDelta = -(dx / svgWidth) * (touchRef.current.startViewEnd - touchRef.current.startViewStart);
      setViewStart(Math.round(touchRef.current.startViewStart + yearDelta));
      setViewEnd(Math.round(touchRef.current.startViewEnd + yearDelta));
    },
    [svgWidth]
  );

  const handleCenturyClick = useCallback((century: number) => {
    const start = century > 0 ? (century - 1) * 100 : century * 100;
    const end = century > 0 ? century * 100 : (century + 1) * 100;
    setViewStart(start);
    setViewEnd(end);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]" style={{ background: 'var(--bg-cream)' }}>
      {/* Controls */}
      <div
        className="shrink-0 px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm"
        style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-cream)' }}
      >
        {/* Back nav */}
        <Link
          href="/explore"
          className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity mr-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Explore
        </Link>

        <span className="w-px h-5" style={{ background: 'var(--border-light)' }} />

        {(['person', 'concept'] as const).map((type) => {
          const active = showTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => {
                setShowTypes((s) => {
                  const next = new Set(s);
                  if (next.has(type)) next.delete(type);
                  else next.add(type);
                  return next;
                });
              }}
              className="flex items-center gap-1.5 transition-opacity"
              style={{ opacity: active ? 1 : 0.35 }}
            >
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ background: TYPE_COLORS[type] }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>
                {type === 'person' ? 'People' : 'Concepts'}
              </span>
            </button>
          );
        })}

        <span className="w-px h-5 mx-1" style={{ background: 'var(--border-light)' }} />

        <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Min books
          <select
            value={minBooks}
            onChange={(e) => setMinBooks(Number(e.target.value))}
            className="rounded px-1.5 py-0.5 text-sm"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
          >
            {[1, 2, 3, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </label>

        <span className="w-px h-5 mx-1" style={{ background: 'var(--border-light)' }} />

        <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Color
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as 'type' | 'books' | 'tradition')}
            className="rounded px-1.5 py-0.5 text-sm"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
          >
            <option value="tradition">By tradition</option>
            <option value="type">By type</option>
            <option value="books">By book count</option>
          </select>
        </label>

        <span className="w-px h-5 mx-1 hidden sm:block" style={{ background: 'var(--border-light)' }} />

        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {filtered.length.toLocaleString()} / {parsed.length.toLocaleString()} entities
          &nbsp;&middot;&nbsp;
          {viewStart}–{viewEnd}
        </span>

        <div className="ml-auto flex gap-1">
          <button
            onClick={() => {
              const span = viewEnd - viewStart;
              const shift = Math.round(span * 0.3);
              setViewStart((s) => s - shift);
              setViewEnd((s) => s - shift);
            }}
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
            title="Pan left"
          >
            &larr;
          </button>
          <button
            onClick={() => {
              const span = viewEnd - viewStart;
              const shift = Math.round(span * 0.3);
              setViewStart((s) => s + shift);
              setViewEnd((s) => s + shift);
            }}
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
            title="Pan right"
          >
            &rarr;
          </button>

          <span className="w-px h-5 mx-0.5" style={{ background: 'var(--border-light)' }} />

          <button
            onClick={() => {
              const mid = (viewStart + viewEnd) / 2;
              const span = (viewEnd - viewStart) * 0.7;
              setViewStart(Math.round(mid - span / 2));
              setViewEnd(Math.round(mid + span / 2));
            }}
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => {
              const mid = (viewStart + viewEnd) / 2;
              const span = Math.min((viewEnd - viewStart) * 1.4, 3000);
              setViewStart(Math.round(mid - span / 2));
              setViewEnd(Math.round(mid + span / 2));
            }}
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
            title="Zoom out"
          >
            &minus;
          </button>

          <span className="w-px h-5 mx-0.5" style={{ background: 'var(--border-light)' }} />

          <button
            onClick={() => { setViewStart(-500); setViewEnd(200); }}
            className="px-2 py-0.5 rounded text-xs"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
          >
            Antiquity
          </button>
          <button
            onClick={() => { setViewStart(1350); setViewEnd(1750); }}
            className="px-2 py-0.5 rounded text-xs"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
          >
            Renaissance
          </button>
          <button
            onClick={() => {
              const [lo, hi] = stats.year_range;
              setViewStart(lo - 50);
              setViewEnd(hi + 50);
            }}
            className="px-2 py-0.5 rounded text-xs"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
          >
            All
          </button>
        </div>

        <span className="text-[10px] hidden lg:inline" style={{ color: 'var(--text-faint)' }}>
          Ctrl+scroll to zoom &middot; Shift+scroll or drag to pan
        </span>
      </div>

      {/* Tradition legend */}
      {colorMode === 'tradition' && (
        <div
          className="shrink-0 px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
          style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-cream)' }}
        >
          {Object.entries(TRADITION_COLORS).map(([key, { color, label }]) => (
            <span key={key} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* SVG timeline */}
      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <svg
          width={svgWidth}
          height={svgHeight}
          style={{ cursor: dragRef.current ? 'grabbing' : 'grab', userSelect: 'none' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => { touchRef.current = null; }}
        >
          {/* Density histogram */}
          <DensityHistogram
            byCentury={stats.by_century}
            viewStart={viewStart}
            viewEnd={viewEnd}
            yearToX={yearToX}
            width={svgWidth}
            onCenturyClick={handleCenturyClick}
          />

          {/* Axis */}
          <TimelineAxis viewStart={viewStart} viewEnd={viewEnd} yearToX={yearToX} y={axisY} />

          {/* Lifespan bars */}
          <g transform={`translate(0, ${barsY})`}>
            {packed.map((p, i) => {
              const x = yearToX(p.startYear);
              const x2 = yearToX(p.endYear);
              const w = Math.max(x2 - x, MIN_BAR_WIDTH_PX);
              const y = p.lane * LANE_HEIGHT;
              const color = getBarColor(p.entity);

              // Only render visible bars
              if (x + w < 0 || x > svgWidth) return null;

              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={BAR_HEIGHT}
                    fill={color}
                    opacity={0.8}
                    rx={1.5}
                    style={{ cursor: 'pointer' }}
                    strokeDasharray={p.estimated ? '3 2' : undefined}
                    stroke={p.estimated ? color : undefined}
                    strokeWidth={p.estimated ? 0.5 : undefined}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const container = containerRef.current?.getBoundingClientRect();
                      if (container) {
                        setTooltip({
                          entity: p.entity,
                          x: rect.left - container.left + rect.width / 2,
                          y: rect.top - container.top - 8,
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => {
                      if (dragRef.current?.moved || touchRef.current?.moved || didScrollRef.current) return;
                      window.open(`/encyclopedia/${encodeURIComponent(p.entity.name)}`, '_blank');
                    }}
                  />
                  {/* Show name if bar is wide enough */}
                  {w > 60 && (
                    <text
                      x={x + 4}
                      y={y + BAR_HEIGHT - 3}
                      fontSize={10}
                      fill="white"
                      fontFamily="var(--font-sans)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {p.entity.name.length > w / 6
                        ? p.entity.name.slice(0, Math.floor(w / 6)) + '...'
                        : p.entity.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-10 px-3 py-2 rounded-lg shadow-lg text-sm pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
              background: 'var(--bg-dark)',
              color: 'white',
              maxWidth: 260,
            }}
          >
            <div className="font-semibold" style={{ fontFamily: 'var(--font-serif)' }}>
              {tooltip.entity.name}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {tooltip.entity.birth_year && tooltip.entity.death_year
                ? `${formatYear(tooltip.entity.birth_year)}–${formatYear(tooltip.entity.death_year)}`
                : tooltip.entity.birth_year
                  ? `b. ${formatYear(tooltip.entity.birth_year)}`
                  : tooltip.entity.death_year
                    ? `d. ${formatYear(tooltip.entity.death_year)}`
                    : ''}
              {' '}&middot; {tooltip.entity.book_count} books &middot; {tooltip.entity.total_mentions} mentions
              {tooltip.entity.tradition && tooltip.entity.tradition !== 'other' && (
                <> &middot; {TRADITION_COLORS[tooltip.entity.tradition]?.label || tooltip.entity.tradition}</>
              )}
            </div>
            {tooltip.entity.description && (
              <div className="text-xs opacity-70 mt-1 line-clamp-2">
                {tooltip.entity.description}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No entities match the current filters
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
