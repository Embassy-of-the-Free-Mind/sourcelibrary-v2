/**
 * SVG chart utility functions — scales, paths, axes.
 * No dependencies. Uses CSS custom properties for colors.
 */

export interface Point { x: number; y: number }

/** Linear scale: maps [domainMin, domainMax] → [rangeMin, rangeMax] */
export function linearScale(
  domainMin: number, domainMax: number,
  rangeMin: number, rangeMax: number,
) {
  const span = domainMax - domainMin || 1;
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** Build an SVG polyline/path "d" attribute from points */
export function linePath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Build a closed area path (line + baseline fill) */
export function areaPath(points: Point[], baselineY: number): string {
  if (points.length === 0) return '';
  const line = linePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x.toFixed(1)},${baselineY} L${first.x.toFixed(1)},${baselineY} Z`;
}

/** Compute nice axis ticks (3-6 values) */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const range = max - min;
  const rough = range / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  const nice = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10;
  const step = nice * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/** Format a number compactly: 1200 → "1.2K", 3500000 → "3.5M" */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Format a date label from ISO string: "Feb 19" or "19 14:00" */
export function dateLabel(iso: string, showTime = false): string {
  const d = new Date(iso);
  if (showTime) {
    return `${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:00`;
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
