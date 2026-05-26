'use client';
import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import workloads from '@/data/carbon-ledger/workloads.json';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';

type Metric = 'cost' | 'calls' | 'pages' | 'output_tokens';

const WORKLOAD_COLORS: Record<string, string> = {
  ocr: '#2c5282',           // ink blue
  translation: '#8b3a3a',   // terracotta / oxide
  extract_images: '#a0522d',// sienna
  translate: '#b95757',     // muted oxide
  index: '#b8860b',         // dark goldenrod
  transliterate: '#6e6e3a', // olive
  extract_chapters: '#4a6b3a', // forest olive
  other: '#6b4423',         // sepia brown
};

const METRICS: { id: Metric; label: string; key: string; formatter: (v: number) => string }[] = [
  { id: 'cost', label: 'Dollars spent', key: 'cost_usd', formatter: (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
  { id: 'calls', label: 'API calls', key: 'calls', formatter: (v) => v.toLocaleString() },
  { id: 'pages', label: 'Pages processed', key: 'pages', formatter: (v) => v.toLocaleString() },
  { id: 'output_tokens', label: 'Output tokens', key: 'output_tokens', formatter: (v) => `${(v / 1e6).toFixed(0)}M` },
];

/**
 * Treemap of pipeline workload by selected metric.
 * Toggle metric → cells rescale; mouse over → tooltip with all dimensions.
 */
export function SpendTreemap() {
  const [metric, setMetric] = useState<Metric>('cost');
  const [hovered, setHovered] = useState<string | null>(null);

  const w = 760;
  const h = 360;

  const treemap = useMemo(() => {
    const m = METRICS.find((x) => x.id === metric)!;
    const data = workloads.workloads.map((w) => ({
      ...w,
      value: (w as Record<string, unknown>)[m.key] as number,
    }));
    const root = d3.hierarchy({ children: data } as { children: typeof data }).sum((d) => (d as { value?: number }).value || 0);
    return d3.treemap<typeof root extends d3.HierarchyNode<infer T> ? T : never>().size([w, h]).padding(2)(root);
  }, [metric]);

  const m = METRICS.find((x) => x.id === metric)!;
  const total = workloads.workloads.reduce((s, x) => s + ((x as unknown as Record<string, number>)[m.key] || 0), 0);

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Interactive — Pipeline workload breakdown
      </figcaption>
      <div className="mb-4 text-stone-700 dark:text-stone-300 text-sm">
        Toggle a metric to rescale. Hover for details.
      </div>

      {/* Metric toggle */}
      <div className="flex flex-wrap gap-2 mb-4">
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
        Total: {m.formatter(total)}
      </div>

      {/* Treemap SVG */}
      <div className="relative w-full">
        <svg viewBox={`0 0 ${w} ${h}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {treemap.leaves().map((leaf, i) => {
            const d = leaf.data as unknown as (typeof workloads.workloads)[number] & { value: number };
            const isHovered = hovered === d.type;
            const cellW = leaf.x1 - leaf.x0;
            const cellH = leaf.y1 - leaf.y0;
            const pct = (d.value / total) * 100;
            const showLabel = cellW > 80 && cellH > 40;
            return (
              <g
                key={d.type}
                transform={`translate(${leaf.x0}, ${leaf.y0})`}
                className="cursor-default"
                onMouseEnter={() => setHovered(d.type)}
                onMouseLeave={() => setHovered(null)}
              >
                <rect
                  width={cellW}
                  height={cellH}
                  fill={WORKLOAD_COLORS[d.type] || '#999'}
                  fillOpacity={isHovered ? 1 : 0.85}
                  stroke="white"
                  strokeWidth={1}
                />
                {showLabel && (() => {
                  // Truncate label based on actual cell width
                  const maxChars = Math.max(6, Math.floor((cellW - 16) / 7.5));
                  const labelText = d.label.length > maxChars
                    ? d.label.slice(0, maxChars - 1) + '…'
                    : d.label;
                  return (
                    <>
                      <text x={8} y={20} fill="white" className="text-xs font-bold">
                        {labelText}
                      </text>
                      <text x={8} y={38} fill="white" fillOpacity={0.85} className="text-xs font-mono">
                        {m.formatter(d.value)}
                      </text>
                      {cellH > 60 && (
                        <text x={8} y={56} fill="white" fillOpacity={0.7} className="text-[10px] font-mono">
                          {pct.toFixed(1)}%
                        </text>
                      )}
                    </>
                  );
                })()}
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hovered && (() => {
          const w = workloads.workloads.find((x) => x.type === hovered);
          if (!w) return null;
          return (
            <div className="absolute top-2 right-2 z-10 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 shadow-lg text-sm max-w-xs">
              <div className="font-semibold mb-1">{w.label}</div>
              <div className="text-xs text-stone-600 dark:text-stone-400 leading-snug mb-2">
                {w.description}
              </div>
              <table className="text-xs w-full">
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  <tr><td className="py-0.5 text-stone-500">Calls</td><td className="py-0.5 font-mono text-right">{w.calls.toLocaleString()}</td></tr>
                  <tr><td className="py-0.5 text-stone-500">Pages</td><td className="py-0.5 font-mono text-right">{w.pages.toLocaleString()}</td></tr>
                  <tr><td className="py-0.5 text-stone-500">Output tokens</td><td className="py-0.5 font-mono text-right">{(w.output_tokens / 1e6).toFixed(0)}M</td></tr>
                  <tr><td className="py-0.5 text-stone-500">Cost</td><td className="py-0.5 font-mono text-right">${w.cost_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      <DataTray sources={[1]}>
        <p className="text-sm">
          Aggregated daily from the application&apos;s own logging. Each call
          writes a row to MongoDB at request time. Cost is what we&apos;re
          billed by Google. Output tokens dominate cost because Gemini Flash
          charges ~8× more per output token than per input token.
        </p>
        <table className="text-xs w-full mt-3">
          <thead className="text-stone-500 uppercase">
            <tr>
              <th className="text-left py-1">Type</th>
              <th className="text-right py-1">Calls</th>
              <th className="text-right py-1">Pages</th>
              <th className="text-right py-1">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-900">
            {workloads.workloads.map((w) => (
              <tr key={w.type}>
                <td className="py-1 pr-2">{w.label}</td>
                <td className="py-1 font-mono text-right">{w.calls.toLocaleString()}</td>
                <td className="py-1 font-mono text-right">{w.pages.toLocaleString()}</td>
                <td className="py-1 font-mono text-right">${w.cost_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTray>
    </figure>
  );
}
