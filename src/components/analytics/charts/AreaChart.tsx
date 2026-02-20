'use client';

import { linearScale, areaPath, linePath, niceTicks, compactNumber, type Point } from './chart-utils';

interface AreaChartProps {
  data: Array<{ x: string; y: number }>;
  width?: number;
  height?: number;
  color?: string;
  xLabel?: (v: string) => string;
  yLabel?: (v: number) => string;
}

/**
 * Filled area chart with gradient, Y-axis ticks, and native <title> tooltips.
 */
export function AreaChart({
  data,
  width = 600,
  height = 200,
  color = 'var(--accent-sage)',
  xLabel,
  yLabel = compactNumber,
}: AreaChartProps) {
  if (data.length === 0) return null;

  const margin = { top: 8, right: 12, bottom: 28, left: 48 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const yValues = data.map(d => d.y);
  const yMin = 0;
  const yMax = Math.max(...yValues, 1);

  const xScale = linearScale(0, data.length - 1, 0, w);
  const yScale = linearScale(yMin, yMax, h, 0);

  const points: Point[] = data.map((d, i) => ({ x: xScale(i), y: yScale(d.y) }));
  const ticks = niceTicks(yMin, yMax, 4);

  // Show ~5 evenly spaced x labels
  const xStep = Math.max(1, Math.floor(data.length / 5));

  const id = `area-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
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

        {/* Area fill */}
        <path d={areaPath(points, h)} fill={`url(#${id})`} />

        {/* Line */}
        <path d={linePath(points)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />

        {/* Data point tooltips */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} opacity={0}>
            <title>{`${data[i].x}: ${yLabel(data[i].y)}`}</title>
          </circle>
        ))}

        {/* Hover targets (wider) */}
        {points.map((p, i) => (
          <rect
            key={`h-${i}`}
            x={p.x - w / data.length / 2}
            y={0}
            width={w / data.length}
            height={h}
            fill="transparent"
          >
            <title>{`${data[i].x}: ${yLabel(data[i].y)}`}</title>
          </rect>
        ))}

        {/* X labels */}
        {data.map((d, i) =>
          i % xStep === 0 ? (
            <text key={i} x={xScale(i)} y={h + 18} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
              {xLabel ? xLabel(d.x) : d.x}
            </text>
          ) : null
        )}
      </g>
    </svg>
  );
}
