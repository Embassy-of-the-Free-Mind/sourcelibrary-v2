'use client';
import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import daily from '@/data/carbon-ledger/daily-activity.json';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';

type Metric = 'calls' | 'output_tokens' | 'cost_usd';

const METRICS: { id: Metric; label: string; color: string; format: (v: number) => string }[] = [
  { id: 'calls', label: 'API calls', color: '#2c5282', format: (v) => v.toLocaleString() },
  { id: 'output_tokens', label: 'Output tokens', color: '#8b3a3a', format: (v) => `${(v / 1e6).toFixed(0)}M` },
  { id: 'cost_usd', label: 'Cost (USD)', color: '#b8860b', format: (v) => `$${v.toFixed(0)}` },
];

/**
 * Daily pipeline activity over the tracking window. Bar per day. Toggle
 * the metric. Reveals the rhythm of the project — the long ramp-up,
 * processing spikes, idle weekends.
 */
export function DailyTimeline() {
  const [metric, setMetric] = useState<Metric>('calls');
  const [hovered, setHovered] = useState<string | null>(null);

  const W = 760;
  const H = 220;
  const padL = 50;
  const padR = 16;
  const padT = 16;
  const padB = 50;

  const m = METRICS.find((x) => x.id === metric)!;

  const { xScale, yScale, maxVal, total } = useMemo(() => {
    const days = daily.days;
    const dates = days.map((d) => new Date(d.date));
    const values = days.map((d) => (d as Record<string, unknown>)[metric] as number);
    const maxVal = Math.max(...values);
    const total = values.reduce((s, v) => s + v, 0);

    const xScale = d3.scaleTime()
      .domain([d3.min(dates)!, d3.max(dates)!])
      .range([padL, W - padR]);

    const yScale = d3.scaleLinear()
      .domain([0, maxVal])
      .range([H - padB, padT]);

    return { xScale, yScale, maxVal, total };
  }, [metric]);

  const yTicks = yScale.ticks(4);
  const xTicks = xScale.ticks(d3.timeMonth.every(1)!);
  const barW = (W - padL - padR) / daily.days.length - 0.5;

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Interactive — Pipeline activity, day by day
      </figcaption>
      <div className="mb-4 text-stone-700 dark:text-stone-300 text-sm">
        Each bar is one day in the tracking window. Toggle the metric.
        The pattern matters: there are clear weekly cycles, ramp-ups when
        new collections were imported, and quiet stretches between them.
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        {METRICS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setMetric(opt.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium border transition-all ${
              metric === opt.id
                ? 'border-stone-900 dark:border-stone-100 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'border-stone-300 dark:border-stone-700 hover:border-stone-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="text-xs font-mono text-stone-500 mb-2">
        Total over window: {m.format(total)} · peak day: {m.format(maxVal)}
      </div>

      <div className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Y-axis grid */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yScale(t)}
                y2={yScale(t)}
                className="stroke-stone-200 dark:stroke-stone-800"
                strokeDasharray="2,2"
              />
              <text
                x={padL - 6}
                y={yScale(t) + 4}
                textAnchor="end"
                className="fill-stone-500 text-[10px] font-mono"
              >
                {m.format(t)}
              </text>
            </g>
          ))}

          {/* X-axis tick labels */}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={xScale(t)}
              y={H - padB + 14}
              textAnchor="middle"
              className="fill-stone-500 text-[10px] font-mono"
            >
              {d3.timeFormat('%b')(t)}
            </text>
          ))}

          {/* Bars */}
          {daily.days.map((d) => {
            const v = (d as Record<string, unknown>)[metric] as number;
            const x = xScale(new Date(d.date));
            const y = yScale(v);
            const isHovered = hovered === d.date;
            return (
              <rect
                key={d.date}
                x={x - barW / 2}
                y={y}
                width={barW}
                height={H - padB - y}
                fill={m.color}
                opacity={isHovered ? 1 : 0.7}
                onMouseEnter={() => setHovered(d.date)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              >
                <title>
                  {d.date}: {m.format(v)}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>

      {/* Hovered detail strip */}
      {hovered && (() => {
        const d = daily.days.find((x) => x.date === hovered);
        if (!d) return null;
        return (
          <div className="mt-3 rounded border border-stone-200 dark:border-stone-800 p-3 text-xs font-mono">
            <span className="text-stone-500">{d.date}</span>
            <span className="mx-2">·</span>
            <span>{d.calls.toLocaleString()} calls</span>
            <span className="mx-2">·</span>
            <span>{(d.output_tokens / 1e6).toFixed(0)}M output tok</span>
            <span className="mx-2">·</span>
            <span>${d.cost_usd.toFixed(0)}</span>
          </div>
        );
      })()}

      <DataTray sources={[1]}>
        <p className="text-sm">
          Aggregated daily from <code className="font-mono">gemini_usage_daily</code> in
          our MongoDB Atlas instance. Each row represents the sum of all API calls made
          that calendar day, broken down by endpoint and model. Date range:{' '}
          {daily.days[0].date} → {daily.days.at(-1)!.date} ({daily.days.length} days).
        </p>
      </DataTray>
    </figure>
  );
}
