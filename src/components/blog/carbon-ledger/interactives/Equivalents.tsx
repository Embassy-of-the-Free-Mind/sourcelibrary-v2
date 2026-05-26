'use client';
import { useState } from 'react';
import { toEquivalents, fmtCount, fmtCO2 } from '@/components/blog/carbon-ledger/format';
import { BurgerIcon, CarIcon, PlaneIcon } from '@/components/blog/carbon-ledger/icons';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';
import equivalentsData from '@/data/carbon-ledger/equivalents.json';

interface EquivalentsProps {
  kg: number;
  /** Optional override range; if absent, uses the headline value's bounds */
  lowKg?: number;
  highKg?: number;
}

/**
 * Pictographic isotype display of CO2 equivalents.
 * Each unit shown as a tiled icon (capped at 50 visible, "+N more" beyond).
 * Concrete reference for each unit shown beneath the count.
 */
export function Equivalents({ kg, lowKg, highKg }: EquivalentsProps) {
  const eq = toEquivalents(kg);
  const lowEq = lowKg !== undefined ? toEquivalents(lowKg) : undefined;
  const highEq = highKg !== undefined ? toEquivalents(highKg) : undefined;

  const lookup = Object.fromEntries(
    equivalentsData.equivalents.map((e) => [e.id, e])
  );

  const rows = [
    {
      key: 'burgers' as const,
      count: eq.burgers,
      lowCount: lowEq?.burgers,
      highCount: highEq?.burgers,
      ref: lookup.burger,
      Icon: BurgerIcon,
      color: 'text-amber-700 dark:text-amber-400',
    },
    {
      key: 'amsLhr' as const,
      count: eq.amsLhr,
      lowCount: lowEq?.amsLhr,
      highCount: highEq?.amsLhr,
      ref: lookup.ams_lhr_rt,
      Icon: PlaneIcon,
      color: 'text-sky-700 dark:text-sky-400',
    },
    {
      key: 'amsNyc' as const,
      count: eq.amsNyc,
      lowCount: lowEq?.amsNyc,
      highCount: highEq?.amsNyc,
      ref: lookup.ams_nyc_rt,
      Icon: PlaneIcon,
      color: 'text-indigo-700 dark:text-indigo-400',
    },
    {
      key: 'carKm' as const,
      count: eq.carKm,
      lowCount: lowEq?.carKm,
      highCount: highEq?.carKm,
      ref: lookup.petrol_car_km,
      Icon: CarIcon,
      color: 'text-rose-700 dark:text-rose-400',
    },
  ];

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Equivalents — at our central estimate of {fmtCO2(kg)}
      </figcaption>
      <div className="mb-6 text-stone-700 dark:text-stone-300 text-sm">
        Same amount of CO₂ as:
      </div>

      <div className="space-y-6">
        {rows.map(({ key, ...row }) => (
          <EquivalentRow key={key} {...row} />
        ))}
      </div>

      <DataTray sources={[10, 11, 12, 13, 14]}>
        <p className="text-sm">
          Each conversion factor below is sourced and verifiable. Ranges
          reflect LCA methodology disagreement (e.g., flight emissions with
          vs without Radiative Forcing Index).
        </p>
        <table className="text-xs w-full mt-3">
          <thead className="text-stone-500 uppercase">
            <tr>
              <th className="text-left py-1">Unit</th>
              <th className="text-right py-1">kg CO₂e</th>
              <th className="text-right py-1">Range</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-900">
            {equivalentsData.equivalents.map((e) => (
              <tr key={e.id}>
                <td className="py-1 pr-2">{e.name}</td>
                <td className="py-1 font-mono text-right">{e.kg_co2e_per_unit}</td>
                <td className="py-1 font-mono text-right text-stone-500">
                  {e.range_low}–{e.range_high}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTray>
    </figure>
  );
}

interface RowProps {
  count: number;
  lowCount?: number;
  highCount?: number;
  ref: typeof equivalentsData.equivalents[number];
  Icon: typeof BurgerIcon;
  color: string;
}

function EquivalentRow({ count, lowCount, highCount, ref, Icon, color }: RowProps) {
  // For tileable iconography: show up to ~40 icons; collapse beyond
  const integerCount = Math.round(count);
  const showIcons = integerCount <= 50 ? integerCount : 0;
  const TILE_CAP = 40;
  const tilesToRender = Math.min(showIcons, TILE_CAP);
  const partial = count - Math.floor(count); // fractional part

  return (
    <div className="grid grid-cols-[80px_1fr] sm:grid-cols-[110px_1fr] gap-3 sm:gap-4 items-start">
      {/* Number column */}
      <div className="text-right">
        <div className={`text-2xl sm:text-3xl font-bold tabular-nums ${color}`}>
          {fmtCount(count)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-stone-500 font-mono">
          {ref.short_name}
        </div>
        {(lowCount !== undefined && highCount !== undefined) && (
          <div className="mt-1 text-[10px] font-mono text-stone-400">
            range {fmtCount(lowCount)}–{fmtCount(highCount)}
          </div>
        )}
      </div>

      {/* Visual column */}
      <div className="min-h-[40px]">
        {tilesToRender > 0 ? (
          <div className="flex flex-wrap gap-0.5 items-center">
            {Array.from({ length: tilesToRender }).map((_, i) => (
              <Icon key={i} size={20} className={color} />
            ))}
            {partial > 0.1 && tilesToRender === integerCount && (
              <span
                className={color}
                style={{ opacity: partial }}
                aria-hidden="true"
              >
                <Icon size={20} className={color} />
              </span>
            )}
            {tilesToRender < integerCount && (
              <span className="ml-2 text-xs font-mono text-stone-500">
                + {(integerCount - tilesToRender).toLocaleString()} more
              </span>
            )}
          </div>
        ) : (
          // Too many to tile — show a single icon + count bar
          <div className="flex items-center gap-3">
            <Icon size={28} className={color} />
            <div className="flex-1">
              <div className={`h-2 rounded ${color} bg-current opacity-30`} />
              <div className="mt-1 text-[10px] font-mono text-stone-400">
                too many to tile
              </div>
            </div>
          </div>
        )}
        <div className="mt-2 text-xs text-stone-600 dark:text-stone-400 leading-snug">
          <span className="font-medium">{ref.name}</span>
          {ref.concrete_reference && (
            <span className="block text-stone-500 dark:text-stone-500 text-[11px] mt-0.5">
              {ref.concrete_reference}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
