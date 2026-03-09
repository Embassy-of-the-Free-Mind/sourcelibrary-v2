'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  linearScale,
  niceTicks,
  linePath,
  areaPath,
} from '@/components/analytics/charts/chart-utils';

interface Keyword {
  term: string;
  n: number;
  cat: string;
  cv: number;
  peak: number;
  periods: Record<string, number>;
}

interface Corpus {
  totalBooks: number;
  periodTotals: Record<string, number>;
  periods: number[];
}

interface Suggestions {
  rising: string[];
  earlyPeakers: string[];
  persistent: string[];
}

// Distinct colors for up to 10 selected concepts
const LINE_COLORS = [
  'var(--accent-rust)',
  'var(--accent-violet)',
  'var(--accent-sage)',
  '#4a90d9',
  '#d4873c',
  '#c4564c',
  '#6b8e5a',
  '#8b6db5',
  '#b5856d',
  '#5a8e8b',
];

const CATEGORY_COLORS: Record<string, string> = {
  Theology: 'var(--accent-rust)',
  Hermeticism: 'var(--accent-violet)',
  Alchemy: 'var(--accent-gold-dark)',
  Philosophy: '#4a90d9',
  'Natural Philosophy': 'var(--accent-sage)',
  History: '#b5856d',
  Medicine: '#c4564c',
  Astrology: '#8b6db5',
  Mysticism: '#5a8e8b',
  Astronomy: '#6b8e5a',
};

interface TooltipData {
  x: number;
  y: number;
  period: number;
  values: { term: string; count: number; normalized: number; color: string }[];
  totalBooks: number;
}

export default function ConceptDiffusionViz({
  keywords,
  corpus,
  groups,
  defaultSelected,
  suggestions,
}: {
  keywords: Keyword[];
  corpus: Corpus;
  groups: Record<string, string[]>;
  defaultSelected: string[];
  suggestions: Suggestions;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [normalized, setNormalized] = useState(true);
  const [filled, setFilled] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Index keywords by term for fast lookup
  const keywordMap = useMemo(() => {
    const map = new Map<string, Keyword>();
    for (const k of keywords) map.set(k.term, k);
    return map;
  }, [keywords]);

  // Search results (autocomplete)
  const searchResults = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    return keywords
      .filter((k) => k.term.toLowerCase().includes(q))
      .slice(0, 20);
  }, [keywords, search]);

  // Toggle a concept
  const toggle = useCallback((term: string) => {
    setSelected((prev) =>
      prev.includes(term) ? prev.filter((c) => c !== term) : [...prev, term].slice(-10),
    );
    setSearch('');
    setShowDropdown(false);
  }, []);

  // Select a group
  const selectGroup = useCallback((terms: string[]) => {
    setSelected(terms.slice(0, 10));
  }, []);

  // Build time series for selected keywords
  const { periods } = corpus;

  const series = useMemo(() => {
    return selected
      .map((term, i) => {
        const kw = keywordMap.get(term);
        if (!kw) return null;
        const points = periods.map((p) => {
          const count = kw.periods[String(p)] || 0;
          const total = corpus.periodTotals[String(p)] || 1;
          return {
            period: p,
            value: normalized ? count / total : count,
            count,
            normalized: count / total,
          };
        });
        return { term, color: LINE_COLORS[i % LINE_COLORS.length], points };
      })
      .filter(Boolean) as { term: string; color: string; points: { period: number; value: number; count: number; normalized: number }[] }[];
  }, [selected, keywordMap, periods, corpus.periodTotals, normalized]);

  // Chart dimensions
  const width = 900;
  const height = 450;
  const margin = { top: 20, right: 20, bottom: 50, left: 55 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Scales
  const xMin = periods[0] || 1200;
  const xMax = (periods[periods.length - 1] || 1900) + 50;
  const xScale = useMemo(() => linearScale(xMin, xMax, 0, plotW), [xMin, xMax, plotW]);

  const yMax = useMemo(() => {
    let max = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.value > max) max = p.value;
      }
    }
    return max * 1.1 || 1;
  }, [series]);

  const yScale = useMemo(() => linearScale(0, yMax, plotH, 0), [yMax, plotH]);
  const xTicks = useMemo(() => niceTicks(xMin, xMax, 8), [xMin, xMax]);
  const yTicks = useMemo(() => niceTicks(0, yMax, 6), [yMax]);

  // Period totals for background bars
  const totalsArray = useMemo(
    () => periods.map((p) => ({ period: p, count: corpus.periodTotals[String(p)] || 0 })),
    [periods, corpus.periodTotals],
  );

  // Mouse interaction
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || series.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left - margin.left;

      const scaledX = xMin + (mx / plotW) * (xMax - xMin);
      let nearestPeriod = periods[0];
      let nearestDist = Infinity;
      for (const p of periods) {
        const dist = Math.abs(scaledX - (p + 25));
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPeriod = p;
        }
      }

      const values = series
        .map((s) => {
          const pt = s.points.find((p) => p.period === nearestPeriod);
          return {
            term: s.term,
            count: pt?.count || 0,
            normalized: pt?.normalized || 0,
            color: s.color,
          };
        })
        .filter((v) => v.count > 0);

      if (values.length > 0) {
        setTooltip({
          x: margin.left + xScale(nearestPeriod + 25),
          y: e.clientY - rect.top,
          period: nearestPeriod,
          values,
          totalBooks: corpus.periodTotals[String(nearestPeriod)] || 0,
        });
      } else {
        setTooltip(null);
      }
    },
    [series, periods, xScale, xMin, xMax, plotW, margin.left, corpus.periodTotals],
  );

  // Filter groups by active group
  const visibleGroups = activeGroup
    ? { [activeGroup]: groups[activeGroup] || [] }
    : groups;

  return (
    <div>
      {/* Search + controls */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="relative" ref={searchRef}>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowDropdown(e.target.value.length >= 2);
            }}
            onFocus={() => {
              if (search.length >= 2) setShowDropdown(true);
            }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="Search 5,362 keywords..."
            className="px-3 py-1.5 text-sm border border-[var(--border-light)] rounded-lg bg-white w-56"
          />
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-[var(--border-medium)] rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searchResults.map((k) => (
                <button
                  key={k.term}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(k.term)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-warm)] flex items-center justify-between"
                >
                  <span className={selected.includes(k.term) ? 'font-medium' : ''}>
                    {k.term}
                  </span>
                  <span className="text-xs text-[var(--text-faint)]">
                    {k.n} books · cv {k.cv.toFixed(1)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={normalized}
            onChange={(e) => setNormalized(e.target.checked)}
            className="rounded"
          />
          Normalize
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={filled}
            onChange={(e) => setFilled(e.target.checked)}
            className="rounded"
          />
          Area fill
        </label>
        {selected.length > 0 && (
          <button
            onClick={() => setSelected([])}
            className="px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Suggestion pills */}
      <div className="space-y-1.5 mb-4">
        {suggestions.rising.length > 0 && (
          <SuggestionRow
            label="Late risers"
            terms={suggestions.rising}
            selected={selected}
            toggle={toggle}
          />
        )}
        {suggestions.earlyPeakers.length > 0 && (
          <SuggestionRow
            label="Early peakers"
            terms={suggestions.earlyPeakers}
            selected={selected}
            toggle={toggle}
          />
        )}
        {suggestions.persistent.length > 0 && (
          <SuggestionRow
            label="Persistent"
            terms={suggestions.persistent}
            selected={selected}
            toggle={toggle}
          />
        )}
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        <button
          onClick={() => setActiveGroup(null)}
          className={`text-xs px-2 py-0.5 rounded ${
            !activeGroup
              ? 'bg-[var(--text-primary)] text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          All
        </button>
        {Object.keys(groups).map((name) => (
          <button
            key={name}
            onClick={() => setActiveGroup(activeGroup === name ? null : name)}
            className={`text-xs px-2 py-0.5 rounded ${
              activeGroup === name
                ? 'text-white'
                : 'hover:opacity-100 opacity-70'
            }`}
            style={{
              color: activeGroup === name ? 'white' : CATEGORY_COLORS[name] || 'var(--text-muted)',
              backgroundColor: activeGroup === name ? (CATEGORY_COLORS[name] || 'var(--text-secondary)') : 'transparent',
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Category keywords */}
      <div className="space-y-1.5 mb-4">
        {Object.entries(visibleGroups).map(([groupName, terms]) => (
          <div key={groupName} className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => selectGroup(terms)}
              className="text-xs font-medium px-2 py-0.5 rounded"
              style={{ color: CATEGORY_COLORS[groupName] || 'var(--text-secondary)' }}
            >
              {groupName}:
            </button>
            {terms.map((term) => {
              const isSelected = selected.includes(term);
              const idx = selected.indexOf(term);
              const color = isSelected
                ? LINE_COLORS[idx % LINE_COLORS.length]
                : 'var(--text-muted)';
              return (
                <button
                  key={term}
                  onClick={() => toggle(term)}
                  className="px-2 py-0.5 text-xs rounded-full border transition-all"
                  style={{
                    borderColor: color,
                    backgroundColor: isSelected ? color : 'transparent',
                    color: isSelected ? 'white' : color,
                    opacity: isSelected ? 1 : 0.7,
                  }}
                >
                  {term}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* SVG Chart */}
      <div className="overflow-x-auto relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-[900px]"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid */}
            {xTicks.map((t) => (
              <line
                key={`xg-${t}`}
                x1={xScale(t)} y1={0} x2={xScale(t)} y2={plotH}
                stroke="var(--border-light)" strokeDasharray="2,4"
              />
            ))}
            {yTicks.map((t) => (
              <line
                key={`yg-${t}`}
                x1={0} y1={yScale(t)} x2={plotW} y2={yScale(t)}
                stroke="var(--border-light)" strokeDasharray="2,4"
              />
            ))}

            {/* Corpus size bars (background context) */}
            {totalsArray.map((t) => {
              const maxBooks = Math.max(...totalsArray.map((tt) => tt.count));
              const barH = maxBooks > 0 ? (t.count / maxBooks) * plotH * 0.15 : 0;
              return (
                <rect
                  key={`bg-${t.period}`}
                  x={xScale(t.period)}
                  y={plotH - barH}
                  width={Math.max(1, xScale(t.period + 50) - xScale(t.period) - 1)}
                  height={barH}
                  fill="var(--border-light)"
                  opacity={0.4}
                />
              );
            })}

            {/* Vertical hover line */}
            {tooltip && (
              <line
                x1={xScale(tooltip.period + 25)} y1={0}
                x2={xScale(tooltip.period + 25)} y2={plotH}
                stroke="var(--text-faint)" strokeDasharray="4,4" opacity={0.6}
              />
            )}

            {/* Lines/areas */}
            {series.map((s) => {
              const pts = s.points.map((p) => ({
                x: xScale(p.period + 25),
                y: yScale(p.value),
              }));
              return (
                <g key={s.term}>
                  {filled && (
                    <path d={areaPath(pts, plotH)} fill={s.color} opacity={0.12} />
                  )}
                  <path
                    d={linePath(pts)}
                    fill="none" stroke={s.color} strokeWidth={2} opacity={0.85}
                  />
                  {s.points.map((p) =>
                    p.value > 0 ? (
                      <circle
                        key={`${s.term}-${p.period}`}
                        cx={xScale(p.period + 25)} cy={yScale(p.value)}
                        r={3} fill={s.color} opacity={0.9}
                      />
                    ) : null,
                  )}
                </g>
              );
            })}

            {/* X axis */}
            <line x1={0} y1={plotH} x2={plotW} y2={plotH} stroke="var(--border-medium)" />
            {xTicks.map((t) => (
              <text
                key={`xl-${t}`}
                x={xScale(t)} y={plotH + 20}
                fontSize={11} fill="var(--text-muted)" textAnchor="middle"
              >
                {t}
              </text>
            ))}
            <text
              x={plotW / 2} y={plotH + 42}
              fontSize={12} fill="var(--text-secondary)" textAnchor="middle"
            >
              Publication Period (50-year bins)
            </text>

            {/* Y axis */}
            <line x1={0} y1={0} x2={0} y2={plotH} stroke="var(--border-medium)" />
            {yTicks.map((t) => (
              <text
                key={`yl-${t}`}
                x={-10} y={yScale(t) + 4}
                fontSize={11} fill="var(--text-muted)" textAnchor="end"
              >
                {normalized ? `${Math.round(t * 100)}%` : t}
              </text>
            ))}
            <text
              x={-45} y={plotH / 2}
              fontSize={12} fill="var(--text-secondary)" textAnchor="middle"
              transform={`rotate(-90, -45, ${plotH / 2})`}
            >
              {normalized ? 'Frequency (% of books)' : 'Books mentioning keyword'}
            </text>

            {/* Corpus size label */}
            <text
              x={plotW} y={plotH - 4}
              fontSize={9} fill="var(--text-faint)" textAnchor="end"
            >
              bars = corpus size per period
            </text>
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-50 bg-white border border-[var(--border-medium)] rounded-lg shadow-lg px-3 py-2 max-w-xs"
            style={{
              left: Math.min(
                Math.max(tooltip.x, 100),
                (svgRef.current?.clientWidth || 900) - 220,
              ),
              top: Math.max(0, tooltip.y - 30 - tooltip.values.length * 20),
            }}
          >
            <div className="font-serif text-sm font-medium mb-1">
              {tooltip.period}–{tooltip.period + 50}
            </div>
            <div className="text-xs text-[var(--text-faint)] mb-1">
              {tooltip.totalBooks} books in corpus
            </div>
            {tooltip.values
              .sort((a, b) => b.count - a.count)
              .map((v) => (
                <div key={v.term} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: v.color }}
                  />
                  <span className="text-[var(--text-secondary)]">{v.term}</span>
                  <span className="ml-auto text-[var(--text-muted)]">
                    {v.count} ({Math.round(v.normalized * 100)}%)
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Legend */}
      {series.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {series.map((s) => (
            <button
              key={s.term}
              onClick={() => toggle(s.term)}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:opacity-70"
            >
              <span className="w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
              {s.term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({
  label,
  terms,
  selected,
  toggle,
}: {
  label: string;
  terms: string[];
  selected: string[];
  toggle: (term: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[var(--text-faint)] w-24 shrink-0">{label}:</span>
      {terms.map((term) => {
        const isSelected = selected.includes(term);
        return (
          <button
            key={term}
            onClick={() => toggle(term)}
            className={`px-2 py-0.5 text-xs rounded-full border transition-all ${
              isSelected
                ? 'bg-[var(--text-primary)] text-white border-[var(--text-primary)]'
                : 'border-[var(--border-light)] text-[var(--text-muted)] hover:border-[var(--border-medium)]'
            }`}
          >
            {term}
          </button>
        );
      })}
    </div>
  );
}
