'use client';
import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import estimationData from '@/data/carbon-ledger/estimation-lines.json';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';
import { fmtCO2, toEquivalents, fmtCount } from '@/components/blog/carbon-ledger/format';
import { BurgerIcon, CarIcon, PlaneIcon } from '@/components/blog/carbon-ledger/icons';

type Line = (typeof estimationData.lines)[number];

const FAMILY_COLOR: Record<string, string> = {
  'Roofline': '#2c5282',          // ink blue — bottom-up family
  '+Stack': '#2c5282',
  'v4 model': '#2c5282',
  'Google scaled': '#8b3a3a',     // terracotta — top-down family
  'Mistral LCA': '#8b3a3a',
  '$ proxy': '#8b3a3a',
};

/**
 * Forest plot — six independent estimation methods plotted on a log-scale
 * x-axis. Each row is a horizontal range (low → high) with central dot.
 * Click a row to toggle it; geometric mean re-computes live.
 */
export function ForestPlot() {
  const lines = estimationData.lines as Line[];
  const [enabled, setEnabled] = useState<Set<number>>(
    () => new Set(lines.map((l) => l.id))
  );

  const xMin = 10;
  const xMax = 100_000;
  const w = 760;
  const h = lines.length * 56 + 80;
  const rowH = 56;
  const padL = 200;
  const padR = 24;
  const padT = 32;

  const xScale = useMemo(
    () => d3.scaleLog().domain([xMin, xMax]).range([padL, w - padR]),
    [w]
  );

  const activeLines = lines.filter((l) => enabled.has(l.id));
  const geomMean = useMemo(() => {
    if (activeLines.length === 0) return 0;
    const logSum = activeLines.reduce((s, l) => s + Math.log(l.central_kg), 0);
    return Math.exp(logSum / activeLines.length);
  }, [activeLines]);

  const ticks = [10, 100, 1000, 10_000, 100_000];

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
      <figcaption className="mb-3">
        <div className="text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
          Interactive — Six ways to estimate the same number
        </div>
        <div className="mt-1 text-stone-700 dark:text-stone-300">
          Total project AI footprint, kg CO₂e. Each bar is one method&apos;s low–high range.
          The dot is its central estimate. Toggle to remove a method; the geometric mean recomputes.
        </div>
      </figcaption>

      <div className="w-full">
        <svg viewBox={`0 0 ${w} ${h}`} className="block w-full h-auto max-w-full" preserveAspectRatio="xMinYMin meet">
          {/* x-axis grid + ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={xScale(t)}
                x2={xScale(t)}
                y1={padT}
                y2={h - 28}
                className="stroke-stone-200 dark:stroke-stone-800"
                strokeDasharray="2,2"
              />
              <text
                x={xScale(t)}
                y={h - 12}
                textAnchor="middle"
                className="fill-stone-500 text-xs font-mono"
              >
                {t >= 1000 ? `${t / 1000}k` : t} kg
              </text>
            </g>
          ))}

          {/* Geometric mean reference */}
          {geomMean > 0 && (
            <g>
              <line
                x1={xScale(geomMean)}
                x2={xScale(geomMean)}
                y1={padT - 4}
                y2={h - 28}
                className="stroke-amber-500"
                strokeWidth={2}
              />
              <text
                x={xScale(geomMean)}
                y={padT - 10}
                textAnchor="middle"
                className="fill-amber-700 dark:fill-amber-300 text-xs font-mono font-bold"
              >
                geomean ≈ {fmtCO2(geomMean)}
              </text>
            </g>
          )}

          {/* Rows */}
          {lines.map((line, i) => {
            const y = padT + i * rowH + rowH / 2;
            const active = enabled.has(line.id);
            const color = FAMILY_COLOR[line.short] || '#888';
            return (
              <g key={line.id} className="cursor-pointer"
                 onClick={() => {
                   setEnabled((prev) => {
                     const next = new Set(prev);
                     if (next.has(line.id)) next.delete(line.id);
                     else next.add(line.id);
                     return next;
                   });
                 }}
                 opacity={active ? 1 : 0.3}>
                {/* Label */}
                <text
                  x={padL - 10}
                  y={y + 5}
                  textAnchor="end"
                  className="fill-stone-800 dark:fill-stone-100 text-sm font-medium"
                >
                  {line.id}. {line.short}
                </text>
                {/* Range bar */}
                <line
                  x1={xScale(line.low_kg)}
                  x2={xScale(line.high_kg)}
                  y1={y}
                  y2={y}
                  stroke={color}
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.4}
                />
                {/* Central dot */}
                <circle cx={xScale(line.central_kg)} cy={y} r={6} fill={color} />
                {/* Range labels */}
                <text
                  x={xScale(line.low_kg) - 6}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-stone-500 text-xs font-mono"
                >
                  {fmtCO2(line.low_kg)}
                </text>
                <text
                  x={xScale(line.high_kg) + 6}
                  y={y + 4}
                  className="fill-stone-500 text-xs font-mono"
                >
                  {fmtCO2(line.high_kg)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2 flex gap-4 text-xs font-mono">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-sky-500" /> Bottom-up family
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-600" /> Top-down family
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-amber-500" /> Geometric mean
        </span>
      </div>

      {/* Equivalents readout — compact 4-up using real icons */}
      {geomMean > 0 && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {(
            [
              { k: 'burgers', label: 'quarter-pound burgers', Icon: BurgerIcon, color: 'text-amber-700 dark:text-amber-400' },
              { k: 'amsLhr', label: 'AMS↔LHR economy RT', Icon: PlaneIcon, color: 'text-sky-700 dark:text-sky-400' },
              { k: 'amsNyc', label: 'AMS↔NYC economy RT', Icon: PlaneIcon, color: 'text-indigo-700 dark:text-indigo-400' },
              { k: 'carKm', label: 'km in a mid-size petrol car', Icon: CarIcon, color: 'text-rose-700 dark:text-rose-400' },
            ] as const
          ).map(({ k, label, Icon, color }) => {
            const eq = toEquivalents(geomMean);
            return (
              <div
                key={k}
                className="rounded border border-stone-200 dark:border-stone-800 p-2.5 flex items-center gap-3"
              >
                <Icon size={24} className={color} />
                <div>
                  <div className="font-bold text-base tabular-nums text-stone-900 dark:text-stone-100">
                    {fmtCount(eq[k as keyof ReturnType<typeof toEquivalents>])}
                  </div>
                  <div className="text-stone-500 text-[10px] uppercase tracking-wide leading-tight">
                    {label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DataTray sources={[1, 2, 3, 4, 5, 10]}>
        <p>
          Each method described in detail at <a href="/methodology" className="underline">/methodology</a>.
        </p>
        <div className="space-y-2 text-xs">
          {lines.map((line) => (
            <div
              key={line.id}
              className="grid grid-cols-[24px_1fr_120px] gap-2 items-baseline border-b border-stone-100 dark:border-stone-900 pb-2"
            >
              <div className="font-mono text-amber-700 dark:text-amber-300">{line.id}.</div>
              <div>
                <div className="font-semibold">{line.short}</div>
                <div className="text-stone-600 dark:text-stone-400 text-[11px]">{line.includes}</div>
              </div>
              <div className="font-mono text-right">{fmtCO2(line.central_kg)}</div>
            </div>
          ))}
        </div>
      </DataTray>
    </figure>
  );
}
