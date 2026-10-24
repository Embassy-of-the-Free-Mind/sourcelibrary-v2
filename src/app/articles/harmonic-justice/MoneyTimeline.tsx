'use client';

import { useState } from 'react';
import Link from 'next/link';

// Every date and description below is taken from the article itself.
type Event = { year: number; label: string; who: string; text: string; href?: string };

const EVENTS: Event[] = [
  { year: 1439, label: '1439', who: 'Cosimo de’ Medici', text: 'The Council of Florence brings Greek scholars to the city; Cosimo hears Gemistus Pletho lecture on Plato.' },
  { year: 1463, label: '1463', who: 'Cosimo and Ficino', text: 'Cosimo commissions Ficino to translate Hermes Trismegistus first, and Plato after.', href: '/book/enneads-1580-greek-latin-ficino-trans-plotinus-ficino?page=8' },
  { year: 1481, label: '1481', who: 'Ficino', text: 'The Venice edition of Ficino’s Latin Pimander, dedicated to Cosimo.', href: '/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus' },
  { year: 1494, label: '1494', who: 'Luca Pacioli', text: 'The Summa, with the first printed account of double-entry bookkeeping.', href: '/book/summa-de-arithmetica-geometria-proportioni-et-proportionalit' },
  { year: 1509, label: '1509', who: 'Luca Pacioli', text: 'De divina proportione, with woodcuts of the solids after Leonardo.', href: '/book/de-divina-proportione-illust' },
  { year: 1525, label: '1520s', who: 'Copernicus', text: 'A treatise on coinage for the Prussian estates.', href: '/book/traictie-de-la-premiere-invention-des-monnoies-de-nicole-ed?page=265' },
  { year: 1579, label: '1579', who: 'Thomas Gresham', text: 'Gresham dies; his will founds a college with chairs of geometry, astronomy and music.' },
  { year: 1601, label: '1601', who: 'Gerard de Malynes', text: 'The Canker of England’s Common Wealth.', href: '/book/the-canker-of-england-s-common-wealth-malynes' },
  { year: 1612, label: '1612', who: 'Traiano Boccalini', text: 'News from Parnassus, the source of the General Reformation.' },
  { year: 1614, label: '1614', who: 'Rosicrucians', text: 'The Fama Fraternitatis first appears, printed with the General Reformation.', href: '/book/fama-fraternitatis-oder-entdeckung-der-brudersch-des-ordens-fraternitatis' },
  { year: 1622, label: '1622', who: 'Gerard de Malynes', text: 'Lex Mercatoria, with its chapter on how metals are generated.' },
  { year: 1623, label: '1623', who: 'Edward Misselden', text: 'The Circle of Commerce mocks “Malyne’s Par.”', href: '/book/the-circle-of-commerce-misselden?page=7' },
  { year: 1651, label: '1651', who: 'William Petty', text: 'Petty takes the Gresham chair of music.' },
  { year: 1655, label: '1655', who: 'Samuel Hartlib', text: 'Hartlib reprints Malynes on metals as an appendix to a book of chemical recipes.', href: '/book/chymical-medicinal-and-chyrurgical-addresses-made-to-samuel-hartlib?page=171' },
  { year: 1758, label: '1758', who: 'François Quesnay', text: 'The Tableau économique draws the economy of France as a circulation.', href: '/book/economic-table-tableau-oeconomique-quesnay?page=16' },
];

const START = 1425;
const END = 1775;
const W = 720;
const PAD = 16;
const LANE_H = 18;
const MIN_GAP_YEARS = 9;

const x = (year: number) => PAD + ((year - START) / (END - START)) * (W - PAD * 2);

// Close dates stack upwards in lanes so no two dots overlap.
const LANES: number[] = (() => {
  const lastInLane: number[] = [];
  return EVENTS.map((e) => {
    let lane = lastInLane.findIndex((y) => e.year - y >= MIN_GAP_YEARS);
    if (lane === -1) lane = lastInLane.length;
    lastInLane[lane] = e.year;
    return lane;
  });
})();
const LANE_COUNT = Math.max(...LANES) + 1;
const AXIS_Y = 24 + LANE_COUNT * LANE_H;
const H = AXIS_Y + 28;
const TICKS = [1450, 1500, 1550, 1600, 1650, 1700, 1750];

export default function MoneyTimeline() {
  const [active, setActive] = useState(0);
  const e = EVENTS[active];

  return (
    <figure className="not-prose my-12">
      <div className="border border-border-light bg-white p-4 md:p-6">
        <p className="font-sans text-sm text-primary mb-1">From Cosimo to Quesnay</p>
        <p className="font-sans text-xs text-muted mb-3">Hover or tap a dot (on a phone, scroll the strip sideways). Arrow keys step through the dates.</p>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[600px] h-auto font-sans"
          role="listbox"
          aria-label="Timeline of the money-men in this article and what they read, 1439 to 1758"
          tabIndex={0}
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowRight') { ev.preventDefault(); setActive((a) => Math.min(EVENTS.length - 1, a + 1)); }
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          }}
        >
          <line x1={PAD} x2={W - PAD} y1={AXIS_Y} y2={AXIS_Y} stroke="var(--color-border-light)" strokeWidth={2} />
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={AXIS_Y} y2={AXIS_Y + 5} stroke="var(--color-muted)" strokeWidth={1} />
              <text x={x(t)} y={AXIS_Y + 20} textAnchor="middle" fontSize={12} fill="var(--color-muted)">{t}</text>
            </g>
          ))}
          {EVENTS.map((ev, i) => {
            const cx = x(ev.year);
            const cy = AXIS_Y - 12 - LANES[i] * LANE_H;
            const on = i === active;
            return (
              <g
                key={ev.label + ev.who}
                role="option"
                aria-selected={on}
                aria-label={`${ev.label}, ${ev.who}: ${ev.text}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                style={{ cursor: 'pointer' }}
              >
                <line x1={cx} x2={cx} y1={cy} y2={AXIS_Y} stroke="var(--color-border-light)" strokeWidth={1} />
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={on ? 7 : 5}
                  fill={on ? 'var(--color-primary)' : 'var(--color-accent-gold-dark)'}
                  stroke="#fff"
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>
        </div>
        <div className="mt-3 min-h-[4.5rem] font-sans text-sm leading-relaxed" aria-live="polite">
          <p className="text-primary">
            <span className="tabular-nums">{e.label}</span> &middot; {e.who}
          </p>
          <p className="text-muted">
            {e.text}
            {e.href && (
              <>
                {' '}
                <Link href={e.href}>Open the book</Link>
              </>
            )}
          </p>
        </div>
      </div>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        {'Dates as given in this article, from the books it quotes and, for Gresham and Petty, the sources it cites. Copernicus’s treatise is placed at 1525 for “the 1520s”.'}
      </figcaption>
    </figure>
  );
}
