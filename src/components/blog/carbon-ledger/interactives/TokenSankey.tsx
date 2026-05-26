'use client';
import { useMemo } from 'react';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import claudeFlow from '@/data/carbon-ledger/claude-flow.json';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';
import { fmtCount } from '@/components/blog/carbon-ledger/format';

interface SankeyNode {
  name: string;
  label: string;
  side: 'left' | 'right';
  color: string;
}
interface SankeyLink { source: number; target: number; value: number; tokens?: number }

/**
 * Sankey diagram showing how Claude Code's 45-billion-token prompt-side
 * volume collapses into modest energy use because cache reads cost ~10%
 * of fresh input. Left = token counts, right = energy contributions.
 * The crossover (cache reads dominant in tokens, output dominant in
 * energy) is the visual point.
 */
export function TokenSankey() {
  const W = 820;
  const H = 380;

  const data = useMemo(() => {
    const nodes: SankeyNode[] = [
      { name: 'cache_read', label: 'Cache reads (43.5B)', side: 'left', color: '#94a3b8' },
      { name: 'cache_create', label: 'Cache create (1.6B)', side: 'left', color: '#fbbf24' },
      { name: 'output', label: 'Output (139M)', side: 'left', color: '#dc2626' },
      { name: 'fresh', label: 'Fresh input (10.5M)', side: 'left', color: '#10b981' },
      { name: 'e_cache_read', label: `${Math.round(claudeFlow.co2_contributions_kg.cache_read)} kg CO₂`, side: 'right', color: '#94a3b8' },
      { name: 'e_cache_create', label: `${Math.round(claudeFlow.co2_contributions_kg.cache_create)} kg CO₂`, side: 'right', color: '#fbbf24' },
      { name: 'e_output', label: `${Math.round(claudeFlow.co2_contributions_kg.output)} kg CO₂`, side: 'right', color: '#dc2626' },
      { name: 'e_fresh', label: `<0.1 kg CO₂`, side: 'right', color: '#10b981' },
    ];

    const links: SankeyLink[] = [
      // Each token type flows to its corresponding energy contribution.
      // Link 'value' = CO2 kg (so band widths = energy share).
      // But we annotate token count separately.
      { source: 0, target: 4, value: claudeFlow.co2_contributions_kg.cache_read, tokens: claudeFlow.totals.cache_read_tokens },
      { source: 1, target: 5, value: claudeFlow.co2_contributions_kg.cache_create, tokens: claudeFlow.totals.cache_create_tokens },
      { source: 2, target: 6, value: claudeFlow.co2_contributions_kg.output, tokens: claudeFlow.totals.output_tokens },
      { source: 3, target: 7, value: Math.max(claudeFlow.co2_contributions_kg.fresh_input, 0.5), tokens: claudeFlow.totals.fresh_input_tokens },
    ];

    return { nodes, links };
  }, []);

  const layout = useMemo(() => {
    const sk = sankey<SankeyNode, SankeyLink>()
      .nodeWidth(20)
      .nodePadding(20)
      .extent([[180, 30], [W - 200, H - 30]]);

    const graph = sk({
      nodes: data.nodes.map((d) => ({ ...d })),
      links: data.links.map((d) => ({ ...d })),
    });

    return graph;
  }, [data]);

  const totalCO2 = data.links.reduce((s, l) => s + l.value, 0);
  const totalTokens = data.links.reduce((s, l) => s + (l.tokens || 0), 0);

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Interactive — Claude Code token flow
      </figcaption>
      <div className="mb-4 text-stone-700 dark:text-stone-300 text-sm">
        Left: how many tokens of each type the development AI used.{' '}
        Right: how much each type contributed to CO₂. Band widths are
        proportional to energy contribution, <strong>not</strong> token
        count. The crossover is the cache magic.
      </div>

      <div className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Header labels for each side */}
          <text x={20} y={20} className="fill-stone-700 dark:fill-stone-300 text-xs font-mono uppercase tracking-wide">
            tokens used
          </text>
          <text x={W - 20} y={20} textAnchor="end" className="fill-stone-700 dark:fill-stone-300 text-xs font-mono uppercase tracking-wide">
            CO₂ contributed
          </text>

          {/* Links */}
          {layout.links.map((link, i) => {
            const pathGen = sankeyLinkHorizontal();
            const path = pathGen(link as Parameters<typeof pathGen>[0]);
            const sourceNode = link.source as SankeyNode;
            return (
              <path
                key={i}
                d={path || ''}
                stroke={sourceNode.color}
                strokeOpacity={0.5}
                strokeWidth={Math.max(1, link.width || 1)}
                fill="none"
              >
                <title>
                  {sourceNode.label} → {(link.target as SankeyNode).label}
                  {' / '}{link.value.toFixed(1)} kg CO₂
                </title>
              </path>
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((n, i) => {
            const node = n as typeof n & SankeyNode;
            const x = node.x0 || 0;
            const y = node.y0 || 0;
            const w = (node.x1 || 0) - x;
            const h = Math.max(2, (node.y1 || 0) - y);
            return (
              <g key={i}>
                <rect x={x} y={y} width={w} height={h} fill={node.color} stroke="white" strokeWidth={1} />
                <text
                  x={node.side === 'left' ? x - 8 : x + w + 8}
                  y={y + h / 2 + 4}
                  textAnchor={node.side === 'left' ? 'end' : 'start'}
                  className="fill-stone-900 dark:fill-stone-100 text-xs font-medium"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Two-column callout */}
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-stone-200 dark:border-stone-800 p-3">
          <div className="text-xs font-mono uppercase tracking-wide text-stone-500 mb-1">
            Cache reads (the meter)
          </div>
          <div className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
            {(claudeFlow.totals.cache_read_tokens / 1e9).toFixed(1)}B
          </div>
          <div className="text-xs text-stone-600 dark:text-stone-400 mt-1 leading-snug">
            {(claudeFlow.totals.cache_read_tokens / totalTokens * 100).toFixed(1)}% of all prompt-side tokens
            — about {fmtCount(claudeFlow.co2_contributions_kg.cache_read / totalCO2 * 100)}% of the energy.
          </div>
        </div>
        <div className="rounded border border-stone-200 dark:border-stone-800 p-3">
          <div className="text-xs font-mono uppercase tracking-wide text-stone-500 mb-1">
            Output tokens (the cost)
          </div>
          <div className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
            {(claudeFlow.totals.output_tokens / 1e6).toFixed(0)}M
          </div>
          <div className="text-xs text-stone-600 dark:text-stone-400 mt-1 leading-snug">
            {(claudeFlow.totals.output_tokens / totalTokens * 100).toFixed(2)}% of tokens —
            {' '}{Math.round(claudeFlow.co2_contributions_kg.output / totalCO2 * 100)}% of the energy.
          </div>
        </div>
      </div>

      <DataTray sources={[2, 7]}>
        <p className="text-sm">
          Token totals from Anthropic <code className="font-mono">usage</code> blocks logged
          to JSONL session files. Per-token energy estimates from the v4 bottom-up model
          (Trainium2, FP8, batch=12, util=50%). Cache-read energy is ~10% of fresh input
          per Li et al. 2024 (arXiv:2412.19442) — the KV cache skips the MLP forward pass entirely.
        </p>
        <table className="text-xs w-full mt-3">
          <thead className="text-stone-500 uppercase">
            <tr>
              <th className="text-left py-1">Token type</th>
              <th className="text-right py-1">Count</th>
              <th className="text-right py-1">J/tok</th>
              <th className="text-right py-1">kg CO₂</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-900">
            <tr><td className="py-1">Output</td><td className="py-1 font-mono text-right">{claudeFlow.totals.output_tokens.toLocaleString()}</td><td className="py-1 font-mono text-right">{claudeFlow.per_token_J.output}</td><td className="py-1 font-mono text-right">{claudeFlow.co2_contributions_kg.output.toFixed(1)}</td></tr>
            <tr><td className="py-1">Cache read</td><td className="py-1 font-mono text-right">{claudeFlow.totals.cache_read_tokens.toLocaleString()}</td><td className="py-1 font-mono text-right">{claudeFlow.per_token_J.cache_read}</td><td className="py-1 font-mono text-right">{claudeFlow.co2_contributions_kg.cache_read.toFixed(1)}</td></tr>
            <tr><td className="py-1">Cache create</td><td className="py-1 font-mono text-right">{claudeFlow.totals.cache_create_tokens.toLocaleString()}</td><td className="py-1 font-mono text-right">{claudeFlow.per_token_J.cache_create}</td><td className="py-1 font-mono text-right">{claudeFlow.co2_contributions_kg.cache_create.toFixed(1)}</td></tr>
            <tr><td className="py-1">Fresh input</td><td className="py-1 font-mono text-right">{claudeFlow.totals.fresh_input_tokens.toLocaleString()}</td><td className="py-1 font-mono text-right">{claudeFlow.per_token_J.fresh_input}</td><td className="py-1 font-mono text-right">{claudeFlow.co2_contributions_kg.fresh_input.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </DataTray>
    </figure>
  );
}
