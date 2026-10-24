'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';

// Horizontal bars on one linear scale, optionally with 95% intervals. HTML rather than SVG so the
// labels stay at reading size on a phone. Hover, tap or focus a row for the exact figure; arrow keys
// step through the rows. Every number is passed in from page.tsx, which says where it comes from.

export type BarRow = {
  label: string;
  v: number;
  lo?: number;
  hi?: number;
  /** Short note under the label (sample size, verdict). */
  note?: string;
  /** Extra sentence in the readout when the row is active. */
  detail?: string;
  /** Drawn in the accent colour; the others in grey. */
  strong?: boolean;
};

const ACCENT = '#9e7c3c'; // accent-gold-dark
const GREY = '#a8a29e';

export default function BarChart({
  rows,
  max,
  ticks,
  unit,
  decimals = 1,
  title,
  hint,
  measure,
  source,
}: {
  rows: BarRow[];
  max: number;
  ticks: number[];
  /** '%' for a percentage, otherwise a suffix such as ' of 5'. */
  unit: string;
  decimals?: number;
  title: string;
  hint: string;
  /** What the value means, for the readout ("character error rate"). */
  measure: string;
  source: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const fmt = (n: number) => `${n.toFixed(decimals)}${unit}`;
  const tick = (n: number) => (unit === '%' ? `${n}%` : `${n}`);
  const at = (v: number) => `${(100 * v) / max}%`;
  const strongIdx = rows.findIndex((r) => r.strong);
  const shown = active ?? (strongIdx >= 0 ? strongIdx : 0);
  const describe = (r: BarRow) => {
    const ci =
      r.lo !== undefined && r.hi !== undefined
        ? `, 95% interval ${r.lo.toFixed(decimals)} to ${fmt(r.hi)}`
        : '';
    const n = r.note ? ` (${r.note})` : '';
    return { head: `${r.label}${n}`, rest: `${measure}${ci}.${r.detail ? ` ${r.detail}` : ''}` };
  };
  const out = describe(rows[shown]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="not-prose border border-border-light bg-white p-4 md:p-6 font-sans">
      <p className="text-sm text-primary mb-1">{title}</p>
      <p className="text-xs text-muted mb-4">{hint}</p>

      <div role="list" aria-label={title} onMouseLeave={() => setActive(null)}>
        {rows.map((row, i) => {
          const hasCi = row.lo !== undefined && row.hi !== undefined;
          const on = shown === i;
          const d = describe(row);
          return (
            <div
              key={row.label}
              role="listitem"
              tabIndex={0}
              aria-label={`${d.head}: ${fmt(row.v)} ${d.rest}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={`grid grid-cols-[1fr_4rem] sm:grid-cols-[13rem_1fr_4rem] items-center gap-x-3 gap-y-1 py-2 px-2 -mx-2 rounded cursor-default outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${on ? 'bg-stone-100' : ''}`}
            >
              <div className="col-span-2 sm:col-span-1 text-sm leading-tight text-primary">
                <span className={row.strong ? 'font-semibold' : ''}>{row.label}</span>
                {row.note && <span className="block text-xs text-muted mt-0.5">{row.note}</span>}
              </div>
              <div className="relative h-5" aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t} className="absolute top-0 bottom-0 w-px bg-stone-200" style={{ left: at(t) }} />
                ))}
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 rounded-r"
                  style={{ width: `max(2px, ${at(row.v)})`, background: row.strong ? ACCENT : GREY, opacity: on ? 1 : 0.85 }}
                />
                {hasCi && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-2.5 border-x-[1.5px] border-stone-700"
                    style={{ left: at(row.lo!), width: `calc(${at(row.hi! - row.lo!)} + 1.5px)` }}
                  >
                    <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1.5px] bg-stone-700" />
                  </span>
                )}
              </div>
              <div className="text-sm text-right tabular-nums text-primary">{fmt(row.v)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_4rem] sm:grid-cols-[13rem_1fr_4rem] gap-x-3 mt-1" aria-hidden="true">
        <span className="hidden sm:block" />
        <div className="relative h-4 text-[11px] text-muted tabular-nums">
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute top-0"
              style={{ left: at(t), transform: i === 0 ? 'none' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {tick(t)}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-4 min-h-[2.75rem] text-sm text-secondary" aria-live="polite">
        <span>{out.head}: </span>
        <span className="font-semibold text-primary tabular-nums">{fmt(rows[shown].v)}</span> <span>{out.rest}</span>
      </p>
      <p className="mt-2 text-xs text-muted">{source}</p>
    </div>
  );
}
