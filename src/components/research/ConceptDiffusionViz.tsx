'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { linearScale, niceTicks, linePath, areaPath } from '@/components/analytics/charts/chart-utils';

interface ConceptPeriod {
  concept: string;
  period: number;
  count: number;
  normalized: number;
  languages: string[];
}

interface PeriodTotal {
  period: number;
  count: number;
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

// Group colors
const GROUP_COLORS: Record<string, string> = {
  'Alchemical Processes': 'var(--accent-rust)',
  'Alchemical Goals': 'var(--accent-gold-dark)',
  'Esoteric Traditions': 'var(--accent-violet)',
  'Natural Philosophy': 'var(--accent-sage)',
};

interface TooltipData {
  x: number;
  y: number;
  period: number;
  values: { concept: string; count: number; normalized: number; color: string }[];
  totalBooks: number;
}

export default function ConceptDiffusionViz({
  data,
  totals,
  groups,
}: {
  data: ConceptPeriod[];
  totals: PeriodTotal[];
  groups: Record<string, string[]>;
}) {
  const [selected, setSelected] = useState<string[]>(["Philosopher's Stone", 'Transmutation', 'Distillation', 'Natural Magic']);
  const [normalized, setNormalized] = useState(true);
  const [filled, setFilled] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const allConcepts = useMemo(() => Object.values(groups).flat(), [groups]);

  // Toggle a concept
  const toggle = useCallback(
    (concept: string) => {
      setSelected((prev) =>
        prev.includes(concept) ? prev.filter((c) => c !== concept) : [...prev, concept].slice(-10),
      );
    },
    [],
  );

  // Select all in a group
  const selectGroup = useCallback((groupConcepts: string[]) => {
    setSelected(groupConcepts.slice(0, 10));
  }, []);

  // Build per-concept time series
  const totalMap = useMemo(() => new Map(totals.map((t) => [t.period, t.count])), [totals]);

  const periods = useMemo(() => {
    const all = new Set<number>();
    for (const t of totals) all.add(t.period);
    return [...all].sort((a, b) => a - b);
  }, [totals]);

  const series = useMemo(() => {
    const byConceptPeriod = new Map<string, Map<number, ConceptPeriod>>();
    for (const d of data) {
      if (!byConceptPeriod.has(d.concept)) byConceptPeriod.set(d.concept, new Map());
      byConceptPeriod.get(d.concept)!.set(d.period, d);
    }

    return selected.map((concept, i) => {
      const periodMap = byConceptPeriod.get(concept) || new Map();
      const points = periods.map((p) => {
        const d = periodMap.get(p);
        return {
          period: p,
          value: d ? (normalized ? d.normalized : d.count) : 0,
          count: d?.count || 0,
          normalized: d?.normalized || 0,
          languages: d?.languages || [],
        };
      });
      return { concept, color: LINE_COLORS[i % LINE_COLORS.length], points };
    });
  }, [data, selected, periods, normalized]);

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

  // Mouse interaction
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || series.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left - margin.left;

      // Find nearest period
      const scaledX = xMin + (mx / plotW) * (xMax - xMin);
      let nearestPeriod = periods[0];
      let nearestDist = Infinity;
      for (const p of periods) {
        const midpoint = p + 25; // center of 50-year period
        const dist = Math.abs(scaledX - midpoint);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPeriod = p;
        }
      }

      const values = series.map((s) => {
        const pt = s.points.find((p) => p.period === nearestPeriod);
        return {
          concept: s.concept,
          count: pt?.count || 0,
          normalized: pt?.normalized || 0,
          color: s.color,
        };
      }).filter((v) => v.count > 0);

      if (values.length > 0) {
        setTooltip({
          x: margin.left + xScale(nearestPeriod + 25),
          y: e.clientY - rect.top,
          period: nearestPeriod,
          values,
          totalBooks: totalMap.get(nearestPeriod) || 0,
        });
      } else {
        setTooltip(null);
      }
    },
    [series, periods, xScale, xMin, xMax, plotW, margin.left, totalMap],
  );

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={normalized}
            onChange={(e) => setNormalized(e.target.checked)}
            className="rounded"
          />
          Normalize by corpus size
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

      {/* Concept groups */}
      <div className="space-y-2 mb-4">
        {Object.entries(groups).map(([groupName, concepts]) => (
          <div key={groupName} className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => selectGroup(concepts)}
              className="text-xs font-medium px-2 py-0.5 rounded"
              style={{ color: GROUP_COLORS[groupName] || 'var(--text-secondary)' }}
            >
              {groupName}:
            </button>
            {concepts.map((concept) => {
              const isSelected = selected.includes(concept);
              const idx = selected.indexOf(concept);
              const color = isSelected ? LINE_COLORS[idx % LINE_COLORS.length] : 'var(--text-muted)';
              return (
                <button
                  key={concept}
                  onClick={() => toggle(concept)}
                  className="px-2 py-0.5 text-xs rounded-full border transition-all"
                  style={{
                    borderColor: color,
                    backgroundColor: isSelected ? color : 'transparent',
                    color: isSelected ? 'white' : color,
                    opacity: isSelected ? 1 : 0.7,
                  }}
                >
                  {concept}
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
            {totals.map((t) => {
              const maxBooks = Math.max(...totals.map((tt) => tt.count));
              const barH = (t.count / maxBooks) * plotH * 0.15;
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
                x1={xScale(tooltip.period + 25)}
                y1={0}
                x2={xScale(tooltip.period + 25)}
                y2={plotH}
                stroke="var(--text-faint)"
                strokeDasharray="4,4"
                opacity={0.6}
              />
            )}

            {/* Lines/areas */}
            {series.map((s) => {
              const pts = s.points.map((p) => ({
                x: xScale(p.period + 25), // center of period
                y: yScale(p.value),
              }));
              return (
                <g key={s.concept}>
                  {filled && (
                    <path
                      d={areaPath(pts, plotH)}
                      fill={s.color}
                      opacity={0.12}
                    />
                  )}
                  <path
                    d={linePath(pts)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    opacity={0.85}
                  />
                  {/* Dots */}
                  {s.points.map((p) =>
                    p.value > 0 ? (
                      <circle
                        key={`${s.concept}-${p.period}`}
                        cx={xScale(p.period + 25)}
                        cy={yScale(p.value)}
                        r={3}
                        fill={s.color}
                        opacity={0.9}
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
              {normalized ? 'Frequency (% of books)' : 'Books mentioning concept'}
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
                <div key={v.concept} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: v.color }}
                  />
                  <span className="text-[var(--text-secondary)]">{v.concept}</span>
                  <span className="ml-auto text-[var(--text-muted)]">
                    {v.count} ({Math.round(v.normalized * 100)}%)
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Legend showing selected with line color */}
      {series.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {series.map((s) => (
            <div key={s.concept} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span className="w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
              {s.concept}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
