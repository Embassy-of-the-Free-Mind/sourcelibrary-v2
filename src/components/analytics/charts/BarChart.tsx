'use client';

import { linearScale, niceTicks, compactNumber } from './chart-utils';

interface BarChartProps {
  data: Array<{ x: string; y: number }>;
  width?: number;
  height?: number;
  color?: string;
  yLabel?: (v: number) => string;
}

/**
 * Vertical bar chart with labels and native tooltips.
 */
export function BarChart({
  data,
  width = 600,
  height = 200,
  color = 'var(--accent-violet)',
  yLabel = compactNumber,
}: BarChartProps) {
  if (data.length === 0) return null;

  const margin = { top: 8, right: 12, bottom: 28, left: 48 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const yMax = Math.max(...data.map(d => d.y), 1);
  const yScale = linearScale(0, yMax, h, 0);
  const ticks = niceTicks(0, yMax, 4);

  const barWidth = Math.max(2, (w / data.length) * 0.7);
  const gap = (w / data.length) * 0.3;

  // Show ~8 evenly spaced x labels
  const xStep = Math.max(1, Math.floor(data.length / 8));

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

        {/* Bars */}
        {data.map((d, i) => {
          const x = (i / data.length) * w + gap / 2;
          const barH = h - yScale(d.y);
          return (
            <g key={i}>
              <rect
                x={x}
                y={yScale(d.y)}
                width={barWidth}
                height={Math.max(0, barH)}
                rx={2}
                fill={color}
                opacity={0.8}
              >
                <title>{`${d.x}: ${yLabel(d.y)}`}</title>
              </rect>
            </g>
          );
        })}

        {/* X labels */}
        {data.map((d, i) =>
          i % xStep === 0 ? (
            <text
              key={i}
              x={(i / data.length) * w + barWidth / 2}
              y={h + 18}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {d.x}
            </text>
          ) : null
        )}
      </g>
    </svg>
  );
}
