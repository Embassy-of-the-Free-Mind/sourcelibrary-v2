'use client';
import { useState } from 'react';
import disclosure from '@/data/carbon-ledger/disclosure.json';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';

type Score = 'yes' | 'partial' | 'no';

const SCORE_STYLES: Record<Score, { bg: string; ring: string; symbol: string; label: string }> = {
  yes:     { bg: 'bg-emerald-500',  ring: 'ring-emerald-300 dark:ring-emerald-700', symbol: '●', label: 'Disclosed' },
  partial: { bg: 'bg-amber-500',    ring: 'ring-amber-300 dark:ring-amber-700',     symbol: '◐', label: 'Partial' },
  no:      { bg: 'bg-stone-300 dark:bg-stone-700', ring: 'ring-stone-200 dark:ring-stone-800', symbol: '○', label: 'Not disclosed' },
};

/**
 * Disclosure scoreboard: which providers have published what.
 * Cells are clickable — opens a tooltip with the specific note and (if any) source URL.
 */
export function DisclosureBoard() {
  const [hovered, setHovered] = useState<{ provider: string; criterion: string } | null>(null);

  const criteria = disclosure.criteria;
  const providers = disclosure.providers;

  // Count totals per provider
  const providerScores = providers.map((p) => {
    const counts = { yes: 0, partial: 0, no: 0 };
    for (const c of criteria) {
      const score = (p.status as Record<string, { score: Score }>)[c.id]?.score || 'no';
      counts[score]++;
    }
    return { id: p.id, counts };
  });

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Interactive — Provider disclosure scoreboard
      </figcaption>
      <div className="mb-4 text-stone-700 dark:text-stone-300 text-sm">
        What major AI providers have publicly disclosed about the environmental impact
        of their models. Click any cell for the source. <strong>Empty rows are the story.</strong>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 pr-3 font-medium text-xs uppercase tracking-wide text-stone-500 w-[140px] align-bottom">
                Provider
              </th>
              {criteria.map((c) => (
                <th
                  key={c.id}
                  className="px-2 py-2 text-center text-xs font-medium text-stone-700 dark:text-stone-300 align-bottom"
                  title={c.description}
                >
                  <div className="whitespace-normal leading-tight">{c.label}</div>
                </th>
              ))}
              <th className="text-right pl-3 py-2 text-xs uppercase tracking-wide text-stone-500 align-bottom">
                Score
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {providers.map((p) => {
              const score = providerScores.find((s) => s.id === p.id)!.counts;
              return (
                <tr key={p.id}>
                  <td className="py-3 pr-3 align-top">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-stone-500 font-mono">{p.products}</div>
                  </td>
                  {criteria.map((c) => {
                    const cell = (p.status as Record<string, { score: Score; note: string; url?: string }>)[c.id];
                    const style = SCORE_STYLES[cell?.score || 'no'];
                    const isHovered = hovered?.provider === p.id && hovered?.criterion === c.id;
                    return (
                      <td
                        key={c.id}
                        className="relative px-1 py-3 text-center"
                        onMouseEnter={() => setHovered({ provider: p.id, criterion: c.id })}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <button
                          type="button"
                          className={`w-7 h-7 rounded-full ${style.bg} ring-2 ${style.ring} hover:scale-125 transition-transform cursor-help`}
                          aria-label={`${p.name} / ${c.label}: ${style.label}`}
                        />
                        {isHovered && cell && (
                          <div className="absolute z-10 left-1/2 -translate-x-1/2 mt-2 w-64 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 shadow-lg text-left">
                            <div className="text-xs font-semibold mb-1">
                              {p.name} — {c.label}
                            </div>
                            <div className="text-xs text-stone-700 dark:text-stone-300 leading-snug mb-1">
                              {cell.note}
                            </div>
                            {cell.url && (
                              <a
                                href={cell.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 dark:text-blue-400 underline break-all"
                              >
                                {cell.url.replace(/^https?:\/\//, '').slice(0, 40)}…
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="pl-3 text-right text-xs font-mono whitespace-nowrap">
                    <span className="text-emerald-700 dark:text-emerald-400">{score.yes}●</span>
                    <span className="ml-1 text-amber-700 dark:text-amber-400">{score.partial}◐</span>
                    <span className="ml-1 text-stone-500">{score.no}○</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
        {(Object.entries(SCORE_STYLES) as [Score, typeof SCORE_STYLES.yes][]).map(([key, style]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-full ${style.bg}`} />
            <span className="text-stone-600 dark:text-stone-400">{style.label}</span>
          </span>
        ))}
      </div>

      <DataTray sources={[3, 4, 9]}>
        <p className="text-sm">
          Compiled May 2026 from primary sources where available (linked in
          each cell). California SB 253 will require companies with &gt;$1B
          annual revenue doing business in California to disclose Scope 1
          and 2 emissions starting in 2026, with Scope 3 from 2027.
          Anthropic, OpenAI, xAI, and Meta all clear that threshold.
        </p>
        <p className="text-sm">
          &quot;Partial&quot; for OpenAI&apos;s per-query energy refers to
          Sam Altman&apos;s June 2025 blog post stating &quot;0.34 Wh per
          ChatGPT query&quot; with no methodology, no boundary definition,
          and no third-party verification.
        </p>
      </DataTray>
    </figure>
  );
}
