'use client';
import { useState, useMemo } from 'react';
import perBook from '@/data/carbon-ledger/per-book.json';
import { fmtCO2, fmtCount } from '@/components/blog/carbon-ledger/format';
import { BookIcon, BurgerIcon } from '@/components/blog/carbon-ledger/icons';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';

type Mode = 'real_time' | 'batch_api';

interface ModelInfo {
  id: string;
  name: string;
  active_params_estimate: string;
  hardware: string;
  api_price_per_mtok: { input: number; output: number };
  used_for_in_source_library: string;
  modes: Record<Mode, {
    co2_g_per_book_bottomup: number;
    co2_g_per_book_lca_scaled: number;
    books_per_burger_bu: number;
  }>;
}

const models = perBook.models as ModelInfo[];

// Carbon intensity → color mapping
function intensityColor(g: number): string {
  if (g < 10) return 'text-emerald-700 dark:text-emerald-400';
  if (g < 100) return 'text-yellow-700 dark:text-yellow-400';
  if (g < 500) return 'text-orange-700 dark:text-orange-400';
  return 'text-red-700 dark:text-red-400';
}

function intensityBg(g: number): string {
  if (g < 10) return 'bg-emerald-100 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800';
  if (g < 100) return 'bg-yellow-50 dark:bg-yellow-950 border-yellow-300 dark:border-yellow-800';
  if (g < 500) return 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-800';
  return 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-800';
}

/**
 * Pick a model + a serving mode, see the carbon cost of processing one
 * average book (1.68M input + 497K output tokens) through it.
 *
 * Source Library actually uses Flash + Flash-Lite. The Pro and Opus rows
 * are counterfactuals: "what if you used a bigger model?"
 */
export function PathPicker() {
  const [modelId, setModelId] = useState<string>('flash-lite');
  const [mode, setMode] = useState<Mode>('batch_api');

  const model = useMemo(() => models.find((m) => m.id === modelId)!, [modelId]);
  const stats = model.modes[mode];

  const usedHere = model.used_for_in_source_library;
  const isHypothetical = usedHere.startsWith('Not used');

  // Cap visualized books at 50 to keep the page tidy
  const booksPerBurger = stats.books_per_burger_bu;
  const visualBooks = Math.min(Math.round(booksPerBurger), 50);

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Interactive — Per-book cost by model and serving mode
      </figcaption>
      <div className="mb-6 text-stone-700 dark:text-stone-300 text-sm">
        Pick a model and a serving mode. The numbers below show what it
        would cost to OCR, translate, index, and summarize one typical book
        from the catalogue (~298 pages, 1.68M input + 497K output tokens).
      </div>

      {/* Model picker — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {models.map((m) => {
          const selected = m.id === modelId;
          const previewG = m.modes.batch_api.co2_g_per_book_bottomup;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setModelId(m.id)}
              className={`text-left p-3 rounded border-2 transition-all ${
                selected
                  ? 'border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-900'
                  : 'border-stone-200 dark:border-stone-800 hover:border-stone-400 dark:hover:border-stone-600'
              }`}
            >
              <div className="text-xs font-mono uppercase tracking-wide text-stone-500">
                {m.id === 'opus' ? 'Anthropic' : 'Google'}
              </div>
              <div className="font-semibold text-sm leading-tight mt-1">
                {m.name.replace('Gemini ', '').replace('Claude ', '')}
              </div>
              <div className="mt-1 text-[10px] text-stone-500 font-mono">
                ~{m.active_params_estimate.split(' ')[0]} params
              </div>
              <div className={`mt-2 text-xs font-mono ${intensityColor(previewG)}`}>
                {fmtCO2(previewG / 1000)}/book (batch)
              </div>
            </button>
          );
        })}
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6 text-sm">
        <button
          type="button"
          onClick={() => setMode('real_time')}
          className={`flex-1 py-2 px-3 rounded border-2 font-medium transition-all ${
            mode === 'real_time'
              ? 'border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-900'
              : 'border-stone-200 dark:border-stone-800 hover:border-stone-400'
          }`}
        >
          Real-time API
        </button>
        <button
          type="button"
          onClick={() => setMode('batch_api')}
          className={`flex-1 py-2 px-3 rounded border-2 font-medium transition-all ${
            mode === 'batch_api'
              ? 'border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-900'
              : 'border-stone-200 dark:border-stone-800 hover:border-stone-400'
          }`}
        >
          Batch API (50% cheaper)
        </button>
      </div>

      {/* Big readout */}
      <div className={`rounded-lg border-2 ${intensityBg(stats.co2_g_per_book_bottomup)} p-5 mb-5`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Per-book CO2 */}
          <div>
            <div className="text-xs font-mono uppercase tracking-wide text-stone-500 mb-1">
              CO₂ per book
            </div>
            <div className={`text-4xl font-bold tabular-nums ${intensityColor(stats.co2_g_per_book_bottomup)}`}>
              {stats.co2_g_per_book_bottomup < 1
                ? `${(stats.co2_g_per_book_bottomup * 1000).toFixed(0)} mg`
                : stats.co2_g_per_book_bottomup < 1000
                  ? `${stats.co2_g_per_book_bottomup.toFixed(stats.co2_g_per_book_bottomup < 10 ? 1 : 0)} g`
                  : `${(stats.co2_g_per_book_bottomup / 1000).toFixed(2)} kg`}
            </div>
            <div className="text-xs font-mono text-stone-500 mt-1">
              range {fmtCO2(stats.co2_g_per_book_bottomup / 1000)}–
              {fmtCO2(stats.co2_g_per_book_lca_scaled / 1000)}
            </div>
          </div>

          {/* Books per burger */}
          <div>
            <div className="text-xs font-mono uppercase tracking-wide text-stone-500 mb-1">
              Books per beef burger
            </div>
            <div className={`text-4xl font-bold tabular-nums ${intensityColor(stats.co2_g_per_book_bottomup)}`}>
              {fmtCount(booksPerBurger)}
            </div>
            <div className="text-xs font-mono text-stone-500 mt-1">
              1 burger ≈ 6 kg CO₂
            </div>
          </div>
        </div>

        {/* Visual: row of book spines next to a burger */}
        <div className="mt-5 pt-4 border-t border-current/20">
          <div className="text-xs text-stone-500 mb-2 font-mono uppercase tracking-wide">
            visualizing 1 burger
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <BurgerIcon size={48} className="text-amber-700 dark:text-amber-400" />
            <span className="text-xl font-bold text-stone-700 dark:text-stone-300">=</span>
            <div className="flex items-end gap-0.5 flex-wrap min-h-[40px]">
              {Array.from({ length: visualBooks }).map((_, i) => (
                <BookIcon key={i} size={28} className={intensityColor(stats.co2_g_per_book_bottomup)} />
              ))}
              {booksPerBurger > 50 && (
                <span className="ml-2 self-center text-sm font-mono text-stone-500">
                  + {(Math.round(booksPerBurger) - 50).toLocaleString()} more
                </span>
              )}
              {booksPerBurger < 1 && (
                <span className="self-center text-sm font-mono text-stone-500 italic">
                  ({fmtCount(1 / booksPerBurger)} burgers per book)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Usage badge */}
      <div className={`rounded p-3 mb-4 text-sm ${
        isHypothetical
          ? 'bg-stone-100 dark:bg-stone-900 text-stone-600 dark:text-stone-400'
          : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800'
      }`}>
        <div className="text-xs font-mono uppercase tracking-wide mb-1">
          {isHypothetical ? 'Counterfactual' : 'Used in Source Library'}
        </div>
        <div className="leading-snug">{usedHere}</div>
      </div>

      {/* If reprocessed at scale */}
      <div className="text-xs text-stone-600 dark:text-stone-400 leading-snug">
        Reprocessing the full 15,000-book live catalogue this way would emit{' '}
        <strong className="font-mono">
          {fmtCO2((stats.co2_g_per_book_bottomup * 15000) / 1000)}
        </strong>{' '}
        of CO₂.
        {' '}
        <span className="text-stone-500">
          (LCA-scaled upper bound:{' '}
          <span className="font-mono">
            {fmtCO2((stats.co2_g_per_book_lca_scaled * 15000) / 1000)}
          </span>
          )
        </span>
      </div>

      <DataTray sources={[1, 3, 4, 5]}>
        <p className="text-sm">
          Token budget is the actual average across {perBook.book_token_budget.avg_pages_per_book.toLocaleString()}-page
          books processed in our window: <code className="font-mono">
            {perBook.book_token_budget.input_tokens.toLocaleString()}
          </code>{' '}
          input + <code className="font-mono">
            {perBook.book_token_budget.output_tokens.toLocaleString()}
          </code>{' '}
          output tokens per book.
        </p>
        <p className="text-sm">
          <strong>Bottom-up</strong> = roofline model × stack overhead × MLPerf calibration
          × training amortization × embodied. <strong>LCA-scaled</strong> = Mistral
          Large 2&apos;s peer-reviewed cradle-to-grave per-token figure, scaled by active
          parameter ratio. The true value sits between, closer to bottom-up for our
          long-context batched workload.
        </p>
        <table className="text-xs w-full mt-3">
          <thead className="text-stone-500 uppercase">
            <tr>
              <th className="text-left py-1">Model</th>
              <th className="text-left py-1">Mode</th>
              <th className="text-right py-1">BU</th>
              <th className="text-right py-1">LCA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-900">
            {models.flatMap((m) => (
              (['real_time', 'batch_api'] as Mode[]).map((md) => (
                <tr key={`${m.id}-${md}`}>
                  <td className="py-1 pr-2 font-mono">{m.name}</td>
                  <td className="py-1 pr-2 font-mono text-stone-500">{md.replace('_', ' ')}</td>
                  <td className="py-1 font-mono text-right">{fmtCO2(m.modes[md].co2_g_per_book_bottomup / 1000)}</td>
                  <td className="py-1 font-mono text-right text-stone-500">{fmtCO2(m.modes[md].co2_g_per_book_lca_scaled / 1000)}</td>
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </DataTray>
    </figure>
  );
}
