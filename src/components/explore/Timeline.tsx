'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';

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

// Distinct from every tradition hue so switching color modes never reuses a
// color with a different meaning.
const TYPE_COLORS: Record<string, string> = {
  person: '#4338ca',
  concept: '#b45309',
};

// European (the majority class, ~80% of entities) is deliberately the warm
// NEUTRAL so the vivid hues go to the minority traditions — at overview zoom
// the cross-cultural figures pop out of the European field instead of the
// whole canvas reading purple. The 7 vivid hues pass the dataviz validator
// (lightness band, chroma floor, CVD ΔE ≥ 12 on adjacent pairs, 3:1 contrast
// on the cream surface); keep legend order in sync with this object's order.
const TRADITION_COLORS: Record<string, { color: string; label: string }> = {
  european:     { color: '#8b8178', label: 'European' },
  classical:    { color: '#a16207', label: 'Classical Greek' },
  islamic:      { color: '#15803d', label: 'Islamic' },
  indian:       { color: '#c2410c', label: 'Indian' },
  jewish:       { color: '#2563eb', label: 'Jewish' },
  east_asian:   { color: '#dc2626', label: 'East Asian' },
  near_eastern: { color: '#0891b2', label: 'Near Eastern' },
  indigenous:   { color: '#7c3aed', label: 'Indigenous' },
  other:        { color: '#a8a29e', label: 'Other' },
};

// Featured tier: label above a thin bar, both inside one lane.
const F_LABEL_SIZE = 11.5;
const F_BAR_HEIGHT = 7;
const F_LANE_HEIGHT = 26;
const F_LABEL_CHAR_PX = 6.4; // ≈ average glyph width at 11.5px sans
const F_LABEL_PAD_PX = 14;   // breathing room after each label
const FEATURED_CAP = 120;    // max labeled figures per viewport

// Context tier: thin unlabeled strips.
const C_BAR_HEIGHT = 4;
const C_LANE_HEIGHT = 7;
const C_MAX_LANES = 40;

const HISTOGRAM_HEIGHT = 80;
const HEADER_HEIGHT = 30;
const ERA_HEIGHT = 20;
const MIN_BAR_WIDTH_PX = 3;

const ERAS: { start: number; end: number; label: string }[] = [
  { start: -3000, end: 500,  label: 'Antiquity' },
  { start: 500,   end: 1000, label: 'Early Middle Ages' },
  { start: 1000,  end: 1300, label: 'High Middle Ages' },
  { start: 1300,  end: 1450, label: 'Late Middle Ages' },
  { start: 1450,  end: 1600, label: 'Renaissance' },
  { start: 1600,  end: 1800, label: 'Early Modern' },
  { start: 1800,  end: 2030, label: 'Modern' },
];

/** Format year for display — shows BCE for negative years */
function formatYear(y: number): string {
  if (y < 0) return `${Math.abs(y)} BCE`;
  return String(y);
}

/**
 * Collapse obvious duplicate entities — the index extraction yields variants
 * like "Cicero" / "Marcus Tullius Cicero" or "Basil Valentine" / "Basilius
 * Valentinus" as separate rows. Deliberately conservative: only merge when the
 * lifespan years are IDENTICAL and the names contain each other or share a
 * 5-character prefix; the best-attested variant survives. Real fix is the
 * canonical-entities layer (#2979) — this just keeps the timeline presentable.
 */
function dedupeEntities(list: TimelineEntity[]): TimelineEntity[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const byYears = new Map<string, TimelineEntity[]>();
  const out: TimelineEntity[] = [];

  for (const e of list) {
    if (e.birth_year === null) { out.push(e); continue; }
    const key = `${e.birth_year}|${e.death_year ?? ''}`;
    const group = byYears.get(key);
    if (group) group.push(e);
    else byYears.set(key, [e]);
  }

  for (const group of byYears.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const sorted = [...group].sort((a, b) => b.book_count - a.book_count);
    const kept: { entity: TimelineEntity; name: string }[] = [];
    for (const e of sorted) {
      const n = norm(e.name);
      const dup = kept.some(({ name }) => {
        const [shorter, longer] = n.length <= name.length ? [n, name] : [name, n];
        return (shorter.length >= 4 && longer.includes(shorter)) ||
          (n.length >= 5 && name.length >= 5 && n.slice(0, 5) === name.slice(0, 5));
      });
      if (!dup) kept.push({ entity: e, name: n });
    }
    out.push(...kept.map((k) => k.entity));
  }

  return out;
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
  labelWidthPx: number;
}

function lifespanOf(e: TimelineEntity): { startYear: number; endYear: number; estimated: boolean } {
  const startYear = e.birth_year!;
  const endYear = e.death_year ?? startYear + 70;
  return { startYear, endYear, estimated: e.death_year === null };
}

function labelTextOf(e: TimelineEntity, withDates: boolean): string {
  if (!withDates || e.birth_year === null) return e.name;
  const b = formatYear(e.birth_year);
  const d = e.death_year !== null ? formatYear(e.death_year) : '';
  return d ? `${e.name} ${b}–${d}` : `${e.name} b. ${b}`;
}

/**
 * First-fit lane packing. When `labeled`, the horizontal footprint of an item
 * is max(bar, its label) so labels can never collide — the single biggest
 * readability lever on a dense timeline.
 */
function packEntities(
  entities: TimelineEntity[],
  pxPerYear: number,
  opts: { labeled: boolean; withDates: boolean; maxLanes?: number }
): { packed: PackedEntity[]; hidden: number } {
  const items = entities
    .filter((e) => e.birth_year !== null)
    .map((e) => {
      const { startYear, estimated } = lifespanOf(e);
      let { endYear } = lifespanOf(e);
      const minYearSpan = MIN_BAR_WIDTH_PX / pxPerYear;
      if (endYear - startYear < minYearSpan) {
        endYear = startYear + minYearSpan;
      }
      const labelWidthPx = opts.labeled
        ? labelTextOf(e, opts.withDates).length * F_LABEL_CHAR_PX + F_LABEL_PAD_PX
        : 0;
      return { entity: e, startYear, endYear, estimated, lane: 0, labelWidthPx };
    })
    .sort((a, b) => a.startYear - b.startYear);

  const lanes: Lane[] = [];
  const gapYears = 2 / pxPerYear;
  const packed: PackedEntity[] = [];
  let hidden = 0;

  for (const item of items) {
    const footprintEnd = Math.max(
      item.endYear,
      item.startYear + item.labelWidthPx / pxPerYear
    );
    let assigned = false;
    for (let i = 0; i < lanes.length; i++) {
      if (item.startYear >= lanes[i].endYear + gapYears) {
        item.lane = i;
        lanes[i].endYear = footprintEnd;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      if (opts.maxLanes && lanes.length >= opts.maxLanes) {
        hidden++;
        continue;
      }
      item.lane = lanes.length;
      lanes.push({ endYear: footprintEnd });
    }
    packed.push(item);
  }

  return { packed, hidden };
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
                fontSize={10}
                fill="var(--text-muted)"
                fontFamily="var(--font-sans)"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      <text x={4} y={12} fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
        figures per century — click to zoom
      </text>
    </g>
  );
}

function EraRibbon({
  viewStart,
  viewEnd,
  yearToX,
  y,
  width,
  onEraClick,
}: {
  viewStart: number;
  viewEnd: number;
  yearToX: (y: number) => number;
  y: number;
  width: number;
  onEraClick: (start: number, end: number) => void;
}) {
  return (
    <g>
      {ERAS.map((era, i) => {
        const x = Math.max(yearToX(era.start), 0);
        const x2 = Math.min(yearToX(era.end), width);
        const w = x2 - x;
        if (w <= 0) return null;
        const labelFits = w > era.label.length * 6 + 12;
        return (
          <g key={era.label} style={{ cursor: 'pointer' }} onClick={() => onEraClick(era.start, era.end)}>
            <rect
              x={x}
              y={y}
              width={w}
              height={ERA_HEIGHT}
              fill={i % 2 === 0 ? 'var(--bg-warm)' : 'transparent'}
              opacity={0.6}
            />
            {labelFits && (
              <text
                x={x + w / 2}
                y={y + ERA_HEIGHT - 6}
                textAnchor="middle"
                fontSize={10}
                letterSpacing={0.6}
                fill="var(--text-muted)"
                fontFamily="var(--font-sans)"
                style={{ textTransform: 'uppercase' }}
              >
                {era.label}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} x2={width} y1={y + ERA_HEIGHT} y2={y + ERA_HEIGHT} stroke="var(--border-light)" strokeWidth={1} />
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
              y={y + 19}
              textAnchor="middle"
              fontSize={11}
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
  const [minBooks, setMinBooks] = useState(3);
  const [colorMode, setColorMode] = useState<'type' | 'books' | 'tradition'>('tradition');
  const [showTypes, setShowTypes] = useState(new Set(['person', 'concept']));

  // Search
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightName, setHighlightName] = useState<string | null>(null);

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
  const parsed = useMemo(() => dedupeEntities(entities), [entities]);

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

  // Room for "Name 1433–99" labels once a century spans a decent width
  const labelsWithDates = pxPerYear > 3;

  // Two tiers: the most-attested figures in the current viewport get labeled
  // bars; everyone else renders as thin context strips below. Importance
  // (book_count) decides who is featured — not everyone can shout at once.
  const { featured, context } = useMemo(() => {
    const inView = filtered.filter((e) => {
      const { startYear, endYear } = lifespanOf(e);
      return startYear < viewEnd && endYear > viewStart;
    });
    const sorted = [...inView].sort((a, b) => b.book_count - a.book_count);
    const featuredSet = new Set<TimelineEntity>(sorted.slice(0, FEATURED_CAP));
    // A searched-for figure is always featured
    if (highlightName) {
      const hit = inView.find((e) => e.name === highlightName);
      if (hit) featuredSet.add(hit);
    }
    return {
      featured: inView.filter((e) => featuredSet.has(e)),
      context: inView.filter((e) => !featuredSet.has(e)),
    };
  }, [filtered, viewStart, viewEnd, highlightName]);

  const featuredPack = useMemo(
    () => packEntities(featured, pxPerYear, { labeled: true, withDates: labelsWithDates }),
    [featured, pxPerYear, labelsWithDates]
  );
  const contextPack = useMemo(
    () => packEntities(context, pxPerYear, { labeled: false, withDates: false, maxLanes: C_MAX_LANES }),
    [context, pxPerYear]
  );

  const featuredLanes = featuredPack.packed.length > 0
    ? Math.max(...featuredPack.packed.map((p) => p.lane)) + 1 : 0;
  const contextLanes = contextPack.packed.length > 0
    ? Math.max(...contextPack.packed.map((p) => p.lane)) + 1 : 0;

  const axisY = HISTOGRAM_HEIGHT + HEADER_HEIGHT;
  const eraY = axisY + 24;
  const barsY = eraY + ERA_HEIGHT + 10;
  const featuredHeight = featuredLanes * F_LANE_HEIGHT;
  const dividerY = barsY + featuredHeight + 6;
  const contextY = dividerY + (context.length > 0 ? 22 : 0);
  const svgHeight = contextY + contextLanes * C_LANE_HEIGHT + 24;

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

  // Search: rank name matches by attestation, fly to the pick
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return parsed
      .filter((e) => e.birth_year !== null && e.name.toLowerCase().includes(q))
      .sort((a, b) => b.book_count - a.book_count)
      .slice(0, 8);
  }, [parsed, query]);

  const flyTo = useCallback((e: TimelineEntity) => {
    const { startYear, endYear } = lifespanOf(e);
    const pad = Math.max(60, Math.round((endYear - startYear) * 1.5));
    setViewStart(startYear - pad);
    setViewEnd(endYear + pad);
    setHighlightName(e.name);
    setQuery('');
    setSearchOpen(false);
  }, []);

  // Wheel: Ctrl/Cmd+wheel = zoom, horizontal gestures = pan, plain vertical = scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Horizontal pan: Shift+scroll, or trackpad horizontal swipe (deltaX dominant)
      const isHorizontalGesture = e.shiftKey ||
        (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 1);
      if (isHorizontalGesture) {
        e.preventDefault();
        const span = viewEnd - viewStart;
        const rawDelta = e.shiftKey ? e.deltaY : e.deltaX;
        const delta = rawDelta * (span / svgWidth) * 1.5;
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

  const handleEraClick = useCallback((start: number, end: number) => {
    setViewStart(start);
    setViewEnd(end);
  }, []);

  const openEntity = useCallback((e: TimelineEntity) => {
    if (dragRef.current?.moved || touchRef.current?.moved || didScrollRef.current) return;
    window.open(`/encyclopedia/${encodeURIComponent(e.name)}`, '_blank');
  }, []);

  const hoverHandlers = useCallback((p: PackedEntity) => ({
    onMouseEnter: (e: React.MouseEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const container = containerRef.current?.getBoundingClientRect();
      if (container) {
        setTooltip({
          entity: p.entity,
          x: rect.left - container.left + rect.width / 2,
          y: rect.top - container.top - 8,
        });
      }
    },
    onMouseLeave: () => setTooltip(null),
    onClick: () => openEntity(p.entity),
  }), [openEntity]);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]" style={{ background: 'var(--bg-cream)' }}>
      {/* Controls */}
      <div
        className="shrink-0 px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm"
        style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-cream)' }}
      >
        {/* Back nav */}
        <Link
          href="/timeline"
          className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity mr-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Timeline
        </Link>

        <span className="w-px h-5" style={{ background: 'var(--border-light)' }} />

        {/* Search */}
        <div className="relative">
          <input
            type="search"
            value={query}
            placeholder="Find a figure…"
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchResults.length > 0) flyTo(searchResults[0]);
              if (e.key === 'Escape') { setQuery(''); setSearchOpen(false); }
            }}
            className="rounded px-2 py-1 text-sm w-44"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)', background: 'white' }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div
              className="absolute z-20 mt-1 w-72 rounded-lg shadow-lg overflow-hidden"
              style={{ background: 'white', border: '1px solid var(--border-light)' }}
            >
              {searchResults.map((e) => (
                <button
                  key={`${e.name}-${e.birth_year}`}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-100 flex items-baseline gap-2"
                  onMouseDown={(ev) => { ev.preventDefault(); flyTo(e); }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>{e.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {e.birth_year !== null ? formatYear(e.birth_year) : ''} · {e.book_count} books
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="w-px h-5 mx-1" style={{ background: 'var(--border-light)' }} />

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
          {featured.length} named of {(featured.length + context.length).toLocaleString('en-US')} in view
          &nbsp;&middot;&nbsp;
          {formatYear(viewStart)}–{formatYear(viewEnd)}
        </span>

        <div className="ml-auto flex gap-1 flex-wrap">
          <button
            onClick={() => {
              const span = viewEnd - viewStart;
              const shift = Math.round(span * 0.3);
              setViewStart((s) => s - shift);
              setViewEnd((s) => s - shift);
            }}
            className="px-2 py-1 rounded text-xs font-mono"
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
            className="px-2 py-1 rounded text-xs font-mono"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
            title="Pan right"
          >
            &rarr;
          </button>

          <span className="w-px h-5 mx-0.5 hidden sm:block" style={{ background: 'var(--border-light)' }} />

          <button
            onClick={() => {
              const mid = (viewStart + viewEnd) / 2;
              const span = (viewEnd - viewStart) * 0.7;
              setViewStart(Math.round(mid - span / 2));
              setViewEnd(Math.round(mid + span / 2));
            }}
            className="px-2 py-1 rounded text-xs font-mono"
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
            className="px-2 py-1 rounded text-xs font-mono"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
            title="Zoom out"
          >
            &minus;
          </button>

          <span className="w-px h-5 mx-0.5 hidden sm:block" style={{ background: 'var(--border-light)' }} />

          <button
            onClick={() => { setViewStart(-500); setViewEnd(200); }}
            className="hidden sm:inline-block px-2 py-1 rounded text-xs"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
          >
            Antiquity
          </button>
          <button
            onClick={() => { setViewStart(1350); setViewEnd(1750); }}
            className="hidden sm:inline-block px-2 py-1 rounded text-xs"
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
            className="px-2 py-1 rounded text-xs"
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
          >
            All
          </button>
        </div>

        <span className="text-[10px] hidden lg:inline" style={{ color: 'var(--text-faint)' }}>
          Ctrl+scroll to zoom &middot; Scroll sideways or drag to pan
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

          {/* Named eras */}
          <EraRibbon
            viewStart={viewStart}
            viewEnd={viewEnd}
            yearToX={yearToX}
            y={eraY}
            width={svgWidth}
            onEraClick={handleEraClick}
          />

          {/* Featured tier: label above a thin lifespan bar */}
          <g transform={`translate(0, ${barsY})`}>
            {featuredPack.packed.map((p) => {
              const x = yearToX(p.startYear);
              const x2 = yearToX(p.endYear);
              const w = Math.max(x2 - x, MIN_BAR_WIDTH_PX);
              const laneY = p.lane * F_LANE_HEIGHT;
              const color = getBarColor(p.entity);
              const isHighlight = p.entity.name === highlightName;

              if (x + Math.max(w, p.labelWidthPx) < 0 || x > svgWidth) return null;

              // Slide the label to the viewport edge only while the visible
              // part of the bar can still hold it — otherwise labels from
              // off-screen bars pile up at x=0 and overlap their lane-mates.
              const labelX = x < 2 && x2 - 2 > p.labelWidthPx ? 2 : x;

              return (
                <g key={`${p.entity.name}-${p.startYear}-${p.lane}`}>
                  {isHighlight && (
                    <rect
                      x={x - 4}
                      y={laneY - 2}
                      width={Math.max(w, p.labelWidthPx) + 8}
                      height={F_LANE_HEIGHT}
                      fill="var(--accent-rust)"
                      opacity={0.12}
                      rx={4}
                    />
                  )}
                  <text
                    x={labelX}
                    y={laneY + F_LABEL_SIZE}
                    fontSize={F_LABEL_SIZE}
                    fill="var(--text-primary)"
                    fontFamily="var(--font-sans)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {p.entity.name}
                    {labelsWithDates && p.entity.birth_year !== null && (
                      <tspan fill="var(--text-muted)" dx={5} fontSize={10}>
                        {formatYear(p.entity.birth_year)}
                        {p.entity.death_year !== null ? `–${formatYear(p.entity.death_year)}` : ''}
                      </tspan>
                    )}
                  </text>
                  <rect
                    x={x}
                    y={laneY + F_LABEL_SIZE + 4}
                    width={w}
                    height={F_BAR_HEIGHT}
                    fill={color}
                    opacity={p.estimated ? 0.45 : 0.9}
                    rx={2}
                  />
                  {/* Full-lane hit target so hover/click never needs pixel aim */}
                  <rect
                    x={x}
                    y={laneY}
                    width={Math.max(w, p.labelWidthPx)}
                    height={F_LANE_HEIGHT}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    {...hoverHandlers(p)}
                  />
                </g>
              );
            })}
          </g>

          {/* Divider between tiers */}
          {context.length > 0 && (
            <g transform={`translate(0, ${dividerY})`}>
              <line x1={0} x2={svgWidth} y1={0} y2={0} stroke="var(--border-light)" strokeWidth={1} />
              <text x={4} y={14} fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-sans)">
                {context.length.toLocaleString('en-US')} more figures in this range — zoom in or raise Min books to name them
                {contextPack.hidden > 0 && ` (${contextPack.hidden.toLocaleString('en-US')} beyond lane limit)`}
              </text>
            </g>
          )}

          {/* Context tier: thin unlabeled strips, hover for identity */}
          <g transform={`translate(0, ${contextY})`}>
            {contextPack.packed.map((p) => {
              const x = yearToX(p.startYear);
              const x2 = yearToX(p.endYear);
              const w = Math.max(x2 - x, MIN_BAR_WIDTH_PX);
              const laneY = p.lane * C_LANE_HEIGHT;

              if (x + w < 0 || x > svgWidth) return null;

              return (
                <rect
                  key={`${p.entity.name}-${p.startYear}-${p.lane}`}
                  x={x}
                  y={laneY}
                  width={w}
                  height={C_BAR_HEIGHT}
                  fill={getBarColor(p.entity)}
                  opacity={0.45}
                  rx={1}
                  style={{ cursor: 'pointer' }}
                  {...hoverHandlers(p)}
                />
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
        {featured.length === 0 && context.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No figures match the current filters
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
