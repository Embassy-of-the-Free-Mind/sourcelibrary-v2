'use client';

import { linePath, linearScale, type Point } from './chart-utils';

interface SparkLineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/**
 * Tiny inline trend line for KPI cards.
 * Accepts a simple number[] and renders an SVG polyline.
 */
export function SparkLine({ data, width = 80, height = 24, color = 'var(--accent-sage)', className }: SparkLineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = 2;

  const xScale = linearScale(0, data.length - 1, pad, width - pad);
  const yScale = linearScale(min, max, height - pad, pad);

  const points: Point[] = data.map((v, i) => ({ x: xScale(i), y: yScale(v) }));

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <path
        d={linePath(points)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
