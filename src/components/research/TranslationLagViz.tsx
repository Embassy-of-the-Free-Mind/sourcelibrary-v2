'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { linearScale, niceTicks } from '@/components/analytics/charts/chart-utils';

interface DataPoint {
  title: string;
  author: string;
  slug: string;
  year: number;
  language: string;
  composed: number;
  composed_display: string;
  lag: number;
  is_first_translation: boolean;
  categories: string[];
}

// Major language families with distinct colors
const LANGUAGE_COLORS: Record<string, string> = {
  Latin: 'var(--accent-rust)',
  German: 'var(--accent-sage)',
  Greek: 'var(--accent-violet)',
  French: '#4a90d9',
  Sanskrit: '#d4873c',
  Chinese: '#c4564c',
  Hebrew: '#6b8e5a',
  Syriac: '#8b6db5',
  Armenian: '#b5856d',
  Arabic: '#5a8e8b',
  English: 'var(--text-muted)',
  Dutch: '#7a9eb5',
  Italian: '#b57a6d',
};

function getColor(lang: string): string {
  return LANGUAGE_COLORS[lang] || 'var(--text-faint)';
}

// Unique sorted language list for legend
function getLanguages(data: DataPoint[]): string[] {
  const counts: Record<string, number> = {};
  for (const d of data) {
    counts[d.language] = (counts[d.language] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([lang]) => lang);
}

interface TooltipData {
  x: number;
  y: number;
  point: DataPoint;
}

export default function TranslationLagViz({ data }: { data: DataPoint[] }) {
  const [highlightLang, setHighlightLang] = useState<string | null>(null);
  const [showFirstOnly, setShowFirstOnly] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const languages = useMemo(() => getLanguages(data), [data]);

  const filtered = useMemo(
    () => (showFirstOnly ? data.filter((d) => d.is_first_translation) : data),
    [data, showFirstOnly],
  );

  // Chart dimensions
  const width = 900;
  const height = 600;
  const margin = { top: 20, right: 30, bottom: 50, left: 65 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Scales
  const minYear = Math.min(...filtered.map((d) => d.composed));
  const maxYear = Math.max(...filtered.map((d) => d.year));
  const domainMin = Math.floor(minYear / 100) * 100;
  const domainMax = Math.ceil(maxYear / 100) * 100;

  const xScale = useMemo(() => linearScale(domainMin, domainMax, 0, plotW), [domainMin, domainMax, plotW]);
  const yScale = useMemo(() => linearScale(domainMin, domainMax, plotH, 0), [domainMin, domainMax, plotH]);

  const xTicks = useMemo(() => niceTicks(domainMin, domainMax, 8), [domainMin, domainMax]);
  const yTicks = useMemo(() => niceTicks(domainMin, domainMax, 8), [domainMin, domainMax]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left - margin.left;
      const my = e.clientY - rect.top - margin.top;

      // Find nearest point within 15px
      let closest: DataPoint | null = null;
      let closestDist = 15;
      for (const d of filtered) {
        const px = xScale(d.composed);
        const py = yScale(d.year);
        const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
        if (dist < closestDist) {
          closestDist = dist;
          closest = d;
        }
      }

      if (closest) {
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          point: closest,
        });
      } else {
        setTooltip(null);
      }
    },
    [filtered, xScale, yScale, margin.left, margin.top],
  );

  const handleClick = useCallback(() => {
    if (tooltip) {
      window.open(`/book/${tooltip.point.slug}`, '_blank');
    }
  }, [tooltip]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showFirstOnly}
            onChange={(e) => setShowFirstOnly(e.target.checked)}
            className="rounded"
          />
          First translations only ({data.filter((d) => d.is_first_translation).length})
        </label>
        <div className="flex flex-wrap gap-1.5">
          {languages.map((lang) => (
            <button
              key={lang}
              onClick={() => setHighlightLang(highlightLang === lang ? null : lang)}
              className="px-2 py-0.5 text-xs rounded-full border transition-all"
              style={{
                borderColor: getColor(lang),
                backgroundColor: highlightLang === lang ? getColor(lang) : 'transparent',
                color: highlightLang === lang ? 'white' : getColor(lang),
                opacity: highlightLang && highlightLang !== lang ? 0.4 : 1,
              }}
            >
              {lang}
            </button>
          ))}
          {highlightLang && (
            <button
              onClick={() => setHighlightLang(null)}
              className="px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* SVG chart */}
      <div className="overflow-x-auto relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-[900px]"
          style={{ cursor: tooltip ? 'pointer' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
          onClick={handleClick}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid lines */}
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

            {/* Diagonal "no lag" line */}
            <line
              x1={xScale(domainMin)} y1={yScale(domainMin)}
              x2={xScale(domainMax)} y2={yScale(domainMax)}
              stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="6,4"
              opacity={0.5}
            />
            <text
              x={xScale(domainMax) - 4}
              y={yScale(domainMax) + 14}
              fontSize={10}
              fill="var(--text-faint)"
              textAnchor="end"
            >
              zero lag
            </text>

            {/* Data points */}
            {filtered.map((d, i) => {
              const cx = xScale(d.composed);
              const cy = yScale(d.year);
              const color = getColor(d.language);
              const dimmed = highlightLang && d.language !== highlightLang;
              return (
                <circle
                  key={`${d.slug}-${i}`}
                  cx={cx} cy={cy}
                  r={d.is_first_translation ? 4 : 3}
                  fill={color}
                  opacity={dimmed ? 0.08 : 0.6}
                  stroke={dimmed ? 'none' : color}
                  strokeWidth={0.5}
                />
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
                {t < 0 ? `${Math.abs(t)} BCE` : t}
              </text>
            ))}
            <text
              x={plotW / 2} y={plotH + 42}
              fontSize={12} fill="var(--text-secondary)" textAnchor="middle"
            >
              Composition Date
            </text>

            {/* Y axis */}
            <line x1={0} y1={0} x2={0} y2={plotH} stroke="var(--border-medium)" />
            {yTicks.map((t) => (
              <text
                key={`yl-${t}`}
                x={-10} y={yScale(t) + 4}
                fontSize={11} fill="var(--text-muted)" textAnchor="end"
              >
                {t}
              </text>
            ))}
            <text
              x={-50} y={plotH / 2}
              fontSize={12} fill="var(--text-secondary)" textAnchor="middle"
              transform={`rotate(-90, -50, ${plotH / 2})`}
            >
              Publication Date
            </text>
          </g>
        </svg>

        {/* Tooltip — positioned relative to the chart container */}
        {tooltip && (
        <div
          className="pointer-events-none absolute z-50 bg-white border border-[var(--border-medium)] rounded-lg shadow-lg px-3 py-2 max-w-xs"
          style={{
            left: Math.min(tooltip.x, (svgRef.current?.clientWidth || 900) - 200),
            top: Math.max(0, tooltip.y - 90),
          }}
        >
          <div className="font-serif text-sm font-medium">{tooltip.point.title}</div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">{tooltip.point.author}</div>
          <div className="text-xs mt-1">
            <span className="text-[var(--text-secondary)]">Composed:</span>{' '}
            {tooltip.point.composed_display}
          </div>
          <div className="text-xs">
            <span className="text-[var(--text-secondary)]">Published:</span>{' '}
            {tooltip.point.year} ({tooltip.point.language})
          </div>
          <div className="text-xs font-medium mt-1" style={{ color: 'var(--accent-rust)' }}>
            {tooltip.point.lag.toLocaleString()} year lag
          </div>
          {tooltip.point.is_first_translation && (
            <div className="text-xs text-[var(--accent-gold-dark)] mt-0.5">First English translation</div>
          )}
        </div>
      )}
    </div>
  );
}
