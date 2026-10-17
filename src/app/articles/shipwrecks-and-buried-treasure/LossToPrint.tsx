'use client';

import { useState } from 'react';
import Link from 'next/link';

// Years of loss come from the article and the pages it quotes. Years of print are
// the dates of the editions Source Library holds (the book records), which for
// Oviedo, Clarendon, Schmidt and Lang are long after the text was first written.
type Row = {
  lost: number;
  lostLabel: string;
  printed: number;
  printedLabel: string;
  what: string;
  book: string;
  href: string;
};

const ROWS: Row[] = [
  { lost: 1445, lostLabel: 'after 1445', printed: 1598, printedLabel: '1598', what: 'King Christopher’s treasure ship, Baltic', book: 'Münster, Cosmographey', href: '/book/69c8716b6c6f3cc53c857589?page=1331' },
  { lost: 1475, lostLabel: '1475', printed: 1765, printedLabel: '1765', what: 'The loot of Kaffa, Black Sea', book: 'Italian chronicle in Pagnini, Della decima', href: '/book/6991e7ecc91ce7d733e50311?page=283' },
  { lost: 1502, lostLabel: '1502', printed: 1552, printedLabel: '1552', what: 'The gold fleet from Santo Domingo', book: 'Las Casas, Brevísima relación', href: '/book/69ea06f14c15c76fe934a77a?page=41' },
  { lost: 1521, lostLabel: '1521', printed: 1853, printedLabel: '1853', what: 'Moctezuma’s gold in the lagoon', book: 'Oviedo, Historia general, vol. 2', href: '/book/695910f9ecb01322b3068858?page=533' },
  { lost: 1553, lostLabel: '1553', printed: 1706, printedLabel: '1706', what: 'Six chests of gold off Cadiz', book: 'Ulrich Schmidt, in Gedenkwaardige scheeps-togten', href: '/book/69b525c46be6046083031e1b?page=90' },
  { lost: 1580, lostLabel: '1580', printed: 1599, printedLabel: '1599', what: 'A chest of dollars in the Caspian', book: 'Hakluyt, Principal Navigations', href: '/book/69e961ab2beefe2f6f72c3b6?page=460' },
  { lost: 1585, lostLabel: '1585', printed: 1595, printedLabel: '1595', what: 'The São Tiago on the Bassas da India', book: 'Linschoten, Itinerario', href: '/book/69ea0f7e13a685002bb8e4d8?page=244' },
  { lost: 1588, lostLabel: '1588', printed: 1894, printedLabel: '1894', what: 'The Armada ship in Tobermory Bay', book: 'Lang, Cock Lane and Common-Sense', href: '/book/69906a4dd69de0e6980706cf?page=264' },
  { lost: 1593, lostLabel: '1593', printed: 1624, printedLabel: '1624', what: 'Henry May cast away on Bermuda', book: 'John Smith, Generall Historie', href: '/book/69ea0f7013a685002bb8e200?page=203' },
  { lost: 1651, lostLabel: '1651', printed: 1826, printedLabel: '1826', what: 'Prince Rupert’s prize money', book: 'Clarendon, History of the Rebellion', href: '/book/6a4a3ea3f0f4a3b75e90cdbc?page=78' },
  { lost: 1687, lostLabel: '1687', printed: 1687, printedLabel: '1686–87', what: 'The pot of Saxon silver at Hundon (found)', book: 'Philosophical Transactions, vol. 16', href: '/book/69567835be7c607c5f03b7e5?page=406' },
  { lost: 1733, lostLabel: 'c. 1733', printed: 1770, printedLabel: '1770', what: 'The silver ship off Maldonado', book: 'Pernety, voyage to the Falklands', href: '/book/6909f75fcf28baa1b4cb0f71?page=249' },
];

const START = 1425;
const END = 1910;
const TICKS = [1450, 1550, 1650, 1750, 1850];
const pct = (y: number) => ((y - START) / (END - START)) * 100;

export default function LossToPrint() {
  const [active, setActive] = useState(7);
  const r = ROWS[active];
  const gap = r.printed - r.lost;

  return (
    <figure className="not-prose my-12">
      <div className="border border-border-light bg-white p-4 md:p-6 font-sans">
        <p className="text-sm text-primary mb-1">From the loss to the printed page</p>
        <p className="text-xs text-muted mb-4">
          Hover, tap or tab through the rows. Arrow keys move between them.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-secondary mb-3" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" /> Lost or found
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-accent-gold-dark bg-white" /> Edition in
            the library
          </span>
        </div>

        <ul
          className="space-y-0.5"
          aria-label="Twelve losses and finds, each with the year it happened and the year of the edition that records it"
          onKeyDown={(ev) => {
            if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
            ev.preventDefault();
            const next = Math.max(0, Math.min(ROWS.length - 1, active + (ev.key === 'ArrowDown' ? 1 : -1)));
            setActive(next);
            const el = ev.currentTarget.querySelectorAll('button')[next];
            el?.focus();
          }}
        >
          {ROWS.map((row, i) => {
            const on = i === active;
            const a = pct(row.lost);
            const b = pct(row.printed);
            return (
              <li key={row.what}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${row.what}: ${row.lostLabel}, printed ${row.printedLabel}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className={`grid w-full grid-cols-1 sm:grid-cols-[15rem_1fr] items-center gap-x-3 rounded px-1.5 py-1 text-left transition-colors ${
                    on ? 'bg-accent-gold/10' : 'hover:bg-accent-gold/5'
                  }`}
                >
                  <span className={`text-xs leading-snug ${on ? 'text-primary' : 'text-secondary'}`}>{row.what}</span>
                  <span className="relative block h-5">
                    <span className="absolute inset-x-0 top-1/2 h-px bg-border-light" />
                    <span
                      className={`absolute top-1/2 h-0.5 -translate-y-1/2 ${on ? 'bg-primary' : 'bg-muted/50'}`}
                      style={{ left: `${a}%`, width: `${Math.max(b - a, 0)}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-white"
                      style={{ left: `${a}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-gold-dark bg-white"
                      style={{ left: `${b}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="grid grid-cols-1 sm:grid-cols-[15rem_1fr] gap-x-3 px-1.5" aria-hidden="true">
          <span />
          <span className="relative block h-5 border-t border-border-light">
            {TICKS.map((t) => (
              <span
                key={t}
                className="absolute top-1 -translate-x-1/2 text-[11px] tabular-nums text-muted"
                style={{ left: `${pct(t)}%` }}
              >
                {t}
              </span>
            ))}
          </span>
        </div>

        <div className="mt-4 min-h-[4.5rem] text-sm leading-relaxed" aria-live="polite">
          <p className="text-primary">{r.what}</p>
          <p className="text-muted">
            <span className="tabular-nums">{r.lostLabel}</span>, in print{' '}
            <span className="tabular-nums">{r.printedLabel}</span>
            {gap > 0 ? <> ({gap} years later)</> : null}: <Link href={r.href}>{r.book}</Link>
          </p>
        </div>
      </div>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Years of loss as the article and the quoted pages give them; the Armada is placed at 1588 and the Maldonado
        wreck at about 1733, thirty years before Pernety’s visit. The second date is that of the edition Source
        Library holds, not always the first printing.
      </figcaption>
    </figure>
  );
}
