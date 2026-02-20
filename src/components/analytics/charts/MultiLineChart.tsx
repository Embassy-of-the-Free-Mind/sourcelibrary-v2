'use client';

import { linearScale, linePath, niceTicks, compactNumber, type Point } from './chart-utils';

interface Series {
  label: string;
  data: number[];
  color: string;
}

interface MultiLineChartProps {
  series: Series[];
  labels: string[];
  width?: number;
  height?: number;
  yLabel?: (v: number) => string;
  xLabel?: (v: string) => string;
}

/**
 * 2-3 overlaid time-series lines with legend.
 */
export function MultiLineChart({
  series,
  labels,
  width = 600,
  height = 220,
  yLabel = compactNumber,
  xLabel,
}: MultiLineChartProps) {
  if (series.length === 0 || labels.length === 0) return null;

  const margin = { top: 28, right: 12, bottom: 28, left: 48 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const allValues = series.flatMap(s => s.data);
  const yMin = 0;
  const yMax = Math.max(...allValues, 1);

  const xScale = linearScale(0, labels.length - 1, 0, w);
  const yScale = linearScale(yMin, yMax, h, 0);
  const ticks = niceTicks(yMin, yMax, 4);

  const xStep = Math.max(1, Math.floor(labels.length / 5));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Y grid + labels */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={0} y1={yScale(t)} x2={w} y2={yScale(t)} stroke="var(--border-light)" strokeDasharray="3,3" />
            <text x={-8} y={yScale(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {yLabel(t)}
            </text>
          </g>
        ))}

        {/* Series lines */}
        {series.map(s => {
          const points: Point[] = s.data.map((v, i) => ({ x: xScale(i), y: yScale(v) }));
          return (
            <path
              key={s.label}
              d={linePath(points)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          );
        })}

        {/* Hover targets per data point per series */}
        {series.map(s =>
          s.data.map((v, i) => (
            <circle key={`${s.label}-${i}`} cx={xScale(i)} cy={yScale(v)} r={3} fill={s.color} opacity={0}>
              <title>{`${s.label} — ${labels[i]}: ${yLabel(v)}`}</title>
            </circle>
          ))
        )}

        {/* X labels */}
        {labels.map((l, i) =>
          i % xStep === 0 ? (
            <text key={i} x={xScale(i)} y={h + 18} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
              {xLabel ? xLabel(l) : l}
            </text>
          ) : null
        )}
      </g>

      {/* Legend (top) */}
      <g transform={`translate(${margin.left}, 6)`}>
        {series.map((s, i) => {
          const offset = i * 120;
          return (
            <g key={s.label} transform={`translate(${offset}, 0)`}>
              <line x1={0} y1={6} x2={14} y2={6} stroke={s.color} strokeWidth={2} />
              <text x={18} y={10} fontSize={11} fill="var(--text-secondary)">{s.label}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
