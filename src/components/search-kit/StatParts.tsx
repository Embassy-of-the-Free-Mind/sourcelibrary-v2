'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The stats band's parts, shared by /library and /gallery so the two bands
 * cannot drift: the count-up number, the box, the printed chart and the
 * split bar with its legend.
 */

/**
 * A number that runs from its last value to the new one (~0.6s, easing out).
 * Reduced motion: it simply changes.
 */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const dur = still ? 0 : 600;
    let raf = requestAnimationFrame(function step(now) {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const v = Math.round(start + (target - start) * (1 - Math.pow(1 - k, 3)));
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export const fmt = (n: number) => n.toLocaleString('en-GB');
export const yearLabel = (y: number | null) => (y == null ? '' : y < 0 ? `${-y} BCE` : String(y));
const bucketLabel = (from: number | null, to: number | null) =>
  from == null ? `before ${(to ?? 0) + 1}` : to == null ? `${from} and after` : `${from}–${String(to).slice(2)}`;

export const statBox = 'bg-warm border border-border-light px-[18px] pt-4 pb-3.5 min-w-0';
const SWATCHES = ['var(--text-primary)', 'var(--text-secondary)', 'var(--text-muted)'];
const OTHERS = 'var(--border-medium)';

export type PrintedBucket = { from: number | null; to: number | null; count: number };

/** Half-century bars; each narrows to its years. `what` names the things counted ("Works", "Images"). */
export function PrintedBars({ printed, yearMin, yearMax, onYears, what, className }: {
  printed: PrintedBucket[];
  yearMin?: number;
  yearMax?: number;
  onYears: (from: number | null, to: number | null) => void;
  what: string;
  className: string;
}) {
  const maxBucket = Math.max(1, ...printed.map((p) => p.count));
  const bars = printed.map((p, i) => ({
    key: i,
    from: p.from,
    to: p.to,
    height: p.count ? Math.max(2, Math.round((40 * p.count) / maxBucket)) : 1,
    label: `${bucketLabel(p.from, p.to)}: ${fmt(p.count)}`,
    on: (yearMin != null || yearMax != null)
      && (yearMin == null || (p.to ?? 9999) >= yearMin)
      && (yearMax == null || (p.from ?? -9999) <= yearMax),
  }));
  return (
    <div className={`flex items-end gap-0.5 ${className}`} role="group" aria-label={`${what} by half-century printed`}>
      {bars.map((b) => (
        <button
          key={b.key}
          type="button"
          title={b.label}
          aria-label={b.label}
          aria-pressed={b.on}
          onClick={() => onYears(b.from, b.to)}
          className={`flex-1 min-w-0 p-0 border-0 transition-[height,background-color] duration-500 ease-out motion-reduce:transition-none ${b.on ? 'bg-primary' : 'bg-border-medium'} hover:bg-accent-rust`}
          style={{ height: `${(100 * b.height) / 40}%` }}
        />
      ))}
    </div>
  );
}

/** The printed box: its title, the chart, and the first and last dates under it. */
export function PrintedBox({ printed, yearMin, yearMax, onYears, what, first, last }: {
  printed: PrintedBucket[];
  yearMin?: number;
  yearMax?: number;
  onYears: (from: number | null, to: number | null) => void;
  what: string;
  first: string;
  last: string;
}) {
  return (
    <div className={statBox}>
      <div className="text-[13px] text-muted mb-2">Printed</div>
      <PrintedBars printed={printed} yearMin={yearMin} yearMax={yearMax} onYears={onYears} what={what} className="h-10" />
      <div className="flex justify-between text-[11px] text-muted mt-1 tabular-nums">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

/** The top three of a breakdown as a split bar and a legend, the rest as "others". Each named part narrows to it. */
export function ShareBox({ title, parts, selected, onPick }: {
  title: string;
  parts: { value: string; count: number }[];
  selected: string[];
  onPick: (value: string) => void;
}) {
  const nonzero = parts.filter((l) => l.count > 0);
  const top = nonzero.slice(0, 3);
  const rest = nonzero.slice(3).reduce((a, l) => a + l.count, 0);
  const sum = top.reduce((a, l) => a + l.count, 0) + rest || 1;
  const named = top.map((l, i) => ({ value: l.value, pct: Math.round((100 * l.count) / sum), color: SWATCHES[i], flex: l.count, on: selected.includes(l.value) }));
  const restPct = Math.round((100 * rest) / sum);
  return (
    <div className={statBox}>
      <div className="text-[13px] text-muted mb-2">{title}</div>
      <div className="flex h-2.5 gap-0.5" aria-hidden>
        {named.map((l) => <i key={l.value} className="block h-full transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none" style={{ flex: l.flex, background: l.color }} />)}
        {rest > 0 && <i className="block h-full transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none" style={{ flex: rest, background: OTHERS }} />}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2.5 text-[12px] text-secondary">
        {named.map((l) => (
          <button key={l.value} type="button" onClick={() => onPick(l.value)} aria-pressed={l.on} className="inline-flex items-center gap-1.5 p-0 border-0 bg-transparent text-[12px] text-inherit group">
            <span className="w-2 h-2" style={{ background: l.color }} aria-hidden />
            <span className={`group-hover:underline underline-offset-2 ${l.on ? 'font-semibold' : ''}`}>{l.value}</span>
            <span className="text-muted tabular-nums">{l.pct}%</span>
          </button>
        ))}
        {rest > 0 && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="w-2 h-2" style={{ background: OTHERS }} aria-hidden />others {restPct}%
          </span>
        )}
      </div>
    </div>
  );
}
