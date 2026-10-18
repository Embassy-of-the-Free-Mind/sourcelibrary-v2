'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';

// Two charts for the Archive OCR note. HTML rather than SVG so the labels stay at reading size on
// a phone. Hover, tap or focus a row for the exact figures; arrow keys step through the rows.
// Every number is passed in from page.tsx, which says where it comes from. The table in the
// article is the table view of both.

const ARCHIVE = '#b07a12'; // amber: the Internet Archive's text
const OURS = '#2a78d6'; // blue: our reader
const TIE = '#d6d3d1'; // neutral grey: no difference

export type CerRow = {
  cell: string;
  books: number;
  archive: { v: string; lo: number; hi: number };
  ours: { v: string; lo: number; hi: number };
  strong?: boolean;
};

export type PairRow = { cell: string; ours: number; tie: number; archive: number; strong?: boolean };

const fmt = (n: number) => (n < 1 ? n.toFixed(2) : n.toFixed(1));

function stepRows(e: KeyboardEvent<HTMLDivElement>, i: number, n: number) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
  (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-secondary mb-3" aria-hidden="true">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const ROW =
  'py-2 px-2 -mx-2 rounded cursor-default outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';

/** Pooled character error rate per cell, both readers, with 95% bootstrap intervals, on one scale. */
export function CerChart({
  rows,
  max,
  ticks,
  source,
}: {
  rows: CerRow[];
  max: number;
  ticks: number[];
  source: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const at = (v: number) => `${(100 * v) / max}%`;
  const shown = active ?? rows.findIndex((r) => r.strong);
  const r = rows[shown >= 0 ? shown : 0];
  const say = (row: CerRow) =>
    `${row.cell} (${row.books} books): Internet Archive ${row.archive.v}% (95% interval ${fmt(row.archive.lo)} to ${fmt(row.archive.hi)}), our reader ${row.ours.v}% (${fmt(row.ours.lo)} to ${fmt(row.ours.hi)})`;

  const bar = (s: { v: string; lo: number; hi: number }, color: string, on: boolean) => (
    <div className="relative h-4" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} className="absolute top-0 bottom-0 w-px bg-stone-200" style={{ left: at(t) }} />
      ))}
      <span
        className="absolute left-0 top-1/2 -translate-y-1/2 h-2.5 rounded-r"
        style={{ width: `max(2px, ${at(parseFloat(s.v))})`, background: color, opacity: on ? 1 : 0.85 }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-2 border-x-[1.5px] border-stone-700"
        style={{ left: at(s.lo), width: `calc(${at(s.hi - s.lo)} + 1.5px)` }}
      >
        <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1.5px] bg-stone-700" />
      </span>
    </div>
  );

  return (
    <div className="not-prose border border-border-light bg-white p-4 md:p-6 font-sans my-8">
      <p className="text-sm text-primary mb-1">Character error rate against the proofread text, by cell</p>
      <p className="text-xs text-muted mb-3">
        Lower is better. Bars are the pooled rate; whiskers the 95% interval. Hover, tap or tab to a row for the figures.
      </p>
      <Legend items={[{ color: ARCHIVE, label: 'Internet Archive text' }, { color: OURS, label: 'Our reader' }]} />

      <div role="list" aria-label="Character error rate by cell" onMouseLeave={() => setActive(null)}>
        {rows.map((row, i) => {
          const on = shown === i;
          return (
            <div
              key={row.cell}
              role="listitem"
              tabIndex={0}
              aria-label={say(row)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => stepRows(e, i, rows.length)}
              className={`grid grid-cols-[1fr_3.25rem] sm:grid-cols-[12rem_1fr_3.25rem] items-center gap-x-3 gap-y-0.5 ${ROW} ${on ? 'bg-stone-100' : ''}`}
            >
              <div className="col-span-2 sm:col-span-1 sm:row-span-2 text-sm leading-tight text-primary">
                <span className={row.strong ? 'font-semibold' : ''}>{row.cell}</span>
                <span className="text-xs text-muted"> &middot; {row.books} books</span>
              </div>
              {bar(row.archive, ARCHIVE, on)}
              <div className="text-xs text-right tabular-nums text-secondary">{row.archive.v}%</div>
              {bar(row.ours, OURS, on)}
              <div className="text-xs text-right tabular-nums text-secondary">{row.ours.v}%</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_3.25rem] sm:grid-cols-[12rem_1fr_3.25rem] gap-x-3 mt-1" aria-hidden="true">
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

      <p className="mt-4 min-h-[3.5rem] text-sm text-secondary" aria-live="polite">
        <span className="text-primary">{r.cell}</span> ({r.books} books): Internet Archive{' '}
        <span className="font-semibold text-primary">{r.archive.v}%</span> ({fmt(r.archive.lo)} to {fmt(r.archive.hi)}),
        our reader <span className="font-semibold text-primary">{r.ours.v}%</span> ({fmt(r.ours.lo)} to {fmt(r.ours.hi)}).
      </p>
      <p className="mt-2 text-xs text-muted">{source}</p>
    </div>
  );
}

/** Same page, both readers: which came closer to the proofread text. Shares of the paired pages. */
export function PairChart({ rows, source }: { rows: PairRow[]; source: ReactNode }) {
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? rows.findIndex((r) => r.strong);
  const r = rows[shown >= 0 ? shown : 0];
  const total = (row: PairRow) => row.ours + row.tie + row.archive;
  const say = (row: PairRow) =>
    `${row.cell}, ${total(row)} pages: our reader closer on ${row.ours}, a tie on ${row.tie}, the Archive closer on ${row.archive}`;

  return (
    <div className="not-prose border border-border-light bg-white p-4 md:p-6 font-sans my-8">
      <p className="text-sm text-primary mb-1">Same page, both readers: which came closer to the proofread text</p>
      <p className="text-xs text-muted mb-3">Each bar is the pages both readers produced in that cell. Hover, tap or tab to a row for the counts.</p>
      <Legend
        items={[
          { color: OURS, label: 'Our reader closer' },
          { color: TIE, label: 'Tie (under 0.2 points)' },
          { color: ARCHIVE, label: 'Archive closer' },
        ]}
      />

      <div role="list" aria-label="Same-page comparison by cell" onMouseLeave={() => setActive(null)}>
        {rows.map((row, i) => {
          const on = shown === i;
          const n = total(row);
          const segs = [
            { k: 'ours', v: row.ours, c: OURS },
            { k: 'tie', v: row.tie, c: TIE },
            { k: 'archive', v: row.archive, c: ARCHIVE },
          ];
          return (
            <div
              key={row.cell}
              role="listitem"
              tabIndex={0}
              aria-label={say(row)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => stepRows(e, i, rows.length)}
              className={`grid grid-cols-[1fr_4.5rem] sm:grid-cols-[12rem_1fr_4.5rem] items-center gap-x-3 gap-y-1 ${ROW} ${on ? 'bg-stone-100' : ''}`}
            >
              <div className="col-span-2 sm:col-span-1 text-sm leading-tight text-primary">
                <span className={row.strong ? 'font-semibold' : ''}>{row.cell}</span>
                <span className="text-xs text-muted"> &middot; {n} pages</span>
              </div>
              <div className="flex h-4 gap-[2px]" aria-hidden="true">
                {segs.map((s) =>
                  s.v > 0 ? (
                    <span
                      key={s.k}
                      className="h-full first:rounded-l last:rounded-r"
                      style={{ width: `${(100 * s.v) / n}%`, background: s.c, opacity: on ? 1 : 0.85 }}
                    />
                  ) : null,
                )}
              </div>
              <div className="text-xs text-right tabular-nums text-secondary">
                {row.ours} / {row.tie} / {row.archive}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 min-h-[2.75rem] text-sm text-secondary" aria-live="polite">
        <span className="text-primary">{r.cell}</span>, {total(r)} pages: our reader closer on{' '}
        <span className="font-semibold text-primary">{r.ours}</span>, a tie on{' '}
        <span className="font-semibold text-primary">{r.tie}</span>, the Archive closer on{' '}
        <span className="font-semibold text-primary">{r.archive}</span>.
      </p>
      <p className="mt-2 text-xs text-muted">{source}</p>
    </div>
  );
}
