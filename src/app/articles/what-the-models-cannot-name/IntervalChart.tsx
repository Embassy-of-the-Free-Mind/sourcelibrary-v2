'use client';

import { useState, type KeyboardEvent } from 'react';

// Horizontal bars with 95% intervals, all on one linear scale. HTML rather than SVG so the labels
// stay at reading size on a phone. Hover, tap or focus a row for the exact figure; arrow keys step
// through the rows. Every number is passed in from page.tsx, which says where it comes from.

export type IntervalRow = {
  label: string;
  v: number;
  lo?: number;
  hi?: number;
  /** Sample size or count, shown under the label and in the readout. */
  note?: string;
  /** The headline row: drawn in the accent colour, the others in grey. */
  strong?: boolean;
};

const ACCENT = '#9e7c3c'; // accent-gold-dark
const GREY = '#a8a29e';

const pct = (n: number) => `${n.toFixed(1)}%`;

function readout(r: IntervalRow, measure: string) {
  const ci = r.lo !== undefined && r.hi !== undefined ? `, 95% interval ${pct(r.lo)} to ${pct(r.hi)}` : '';
  const n = r.note ? ` (${r.note})` : '';
  const head = `${r.label.charAt(0).toUpperCase()}${r.label.slice(1)}${n}`;
  return { head, value: pct(r.v), text: `${measure}${ci}.`, full: `${head}: ${pct(r.v)} ${measure}${ci}` };
}

export default function IntervalChart({
  rows,
  max,
  ticks,
  title,
  measure,
  source,
}: {
  rows: IntervalRow[];
  max: number;
  ticks: number[];
  title: string;
  /** What the value means, for the readout ("of works whose author no model names"). */
  measure: string;
  source: React.ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const at = (v: number) => `${(100 * v) / max}%`;
  const shown = active ?? rows.findIndex((r) => r.strong);
  const r = rows[shown >= 0 ? shown : 0];
  const out = readout(r, measure);

  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="not-prose border border-border-light bg-white p-4 md:p-6 font-sans">
      <p className="text-sm text-primary mb-1">{title}</p>
      <p className="text-xs text-muted mb-4">Hover, tap or tab to a row for the exact figure. Bars are the share; whiskers the 95% interval.</p>

      <div role="list" aria-label={title} onMouseLeave={() => setActive(null)}>
        {rows.map((row, i) => {
          const hasCi = row.lo !== undefined && row.hi !== undefined;
          const on = shown === i;
          return (
            <div
              key={row.label}
              role="listitem"
              tabIndex={0}
              aria-label={readout(row, measure).full}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={`grid grid-cols-[1fr_3.5rem] sm:grid-cols-[11rem_1fr_3.5rem] items-center gap-x-3 gap-y-1 py-2 px-2 -mx-2 rounded cursor-default outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${on ? 'bg-stone-100' : ''}`}
            >
              <div className="col-span-2 sm:col-span-1 text-sm leading-tight text-primary">
                <span className={row.strong ? 'font-semibold' : ''}>{row.label}</span>
                {row.note && <span className="text-xs text-muted"> &middot; {row.note}</span>}
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
              <div className="text-sm text-right tabular-nums text-primary">{pct(row.v)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_3.5rem] sm:grid-cols-[11rem_1fr_3.5rem] gap-x-3 mt-1" aria-hidden="true">
        <span className="hidden sm:block" />
        <div className="relative h-4 text-[11px] text-muted tabular-nums">
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute top-0"
              style={{ left: at(t), transform: i === 0 ? 'none' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {t}%
            </span>
          ))}
        </div>
      </div>

      <p className="mt-4 min-h-[2.75rem] text-sm text-secondary" aria-live="polite">
        <span>{out.head}: </span>
        <span className="font-semibold text-primary tabular-nums">{out.value}</span> <span>{out.text}</span>
      </p>
      <p className="mt-2 text-xs text-muted">{source}</p>
    </div>
  );
}
