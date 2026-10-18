'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// The four year-bearers as Landa gives them (Relación, printed p. 208,
// reader p. 331): the day that opens the year, the Bacab who rules it under
// his four names, and the quarter of the world. The colour is the one the
// Bacab's names carry (Kan-, Chac-, Zac-, Ek-), glossed from Pío Pérez's
// dictionary. Nothing here goes beyond those two pages.
const PIO = '6acc3dfa230e9a56175cdd32';
const LANDA = '69f8c0f74c6a515115aedadd';

type Bearer = {
  day: string;
  names: string[];
  dir: string;
  landaDir: string;
  colourWord: string;
  gloss: string;
  colour: string;
  pioPage: number;
  x: number;
  y: number;
};

const BEARERS: Bearer[] = [
  { day: 'Kan', names: ['Hobnil', 'Kanal Bacab', 'Kan-pauahtun', 'Kan-xibchac'], dir: 'South', landaDir: 'a la parte de medio dia', colourWord: 'kan', gloss: 'amarillo, el color amarillo', colour: '#d9a62e', pioPage: 208, x: 200, y: 318 },
  { day: 'Muluc', names: ['Canzienal', 'Chacal Bacab', 'Chac pauahtun', 'Chac-xib-chac'], dir: 'East', landaDir: 'al oriente', colourWord: 'chac', gloss: 'el color encarnado', colour: '#a9473a', pioPage: 106, x: 318, y: 200 },
  { day: 'Ix', names: ['Zaczini', 'Zacal Bacab', 'Zac-pauahtun', 'Zac-xibchac'], dir: 'North', landaDir: 'a la parte del norte', colourWord: 'zac', gloss: 'blanco', colour: '#f7f4ec', pioPage: 453, x: 200, y: 82 },
  { day: 'Cauac', names: ['Hozanek', 'Ekel Bacab', 'Ek-pauahtun', 'Ekxib-chac'], dir: 'West', landaDir: 'a la parte del poniente', colourWord: 'eek', gloss: 'negro, cosa negra', colour: '#2b2825', pioPage: 140, x: 82, y: 200 },
];

export default function BacabYears() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [year, setYear] = useState(1);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setActive((a) => (a + 1) % 4);
      setYear((y) => y + 1);
    }, 1600);
    return () => clearInterval(t);
  }, [playing]);

  const b = BEARERS[active];

  const choose = (i: number) => {
    setPlaying(false);
    setActive(i);
    setYear(i + 1);
  };

  return (
    <figure className="not-prose my-10 border border-border-light bg-white p-4 sm:p-6">
      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr] items-center">
        <svg viewBox="0 0 400 400" className="w-full max-w-[20rem] mx-auto h-auto" role="img" aria-label={`The four year-bearers around the quarters of the world. Shown: ${b.day}, ${b.dir}.`}>
          <line x1="82" y1="200" x2="318" y2="200" stroke="#d6d0c4" strokeWidth="2" />
          <line x1="200" y1="82" x2="200" y2="318" stroke="#d6d0c4" strokeWidth="2" />
          {BEARERS.map((d, i) => {
            const on = i === active;
            return (
              <g
                key={d.day}
                role="button"
                tabIndex={0}
                aria-label={`${d.day}, ${d.dir}`}
                aria-pressed={on}
                onClick={() => choose(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    choose(i);
                  }
                }}
                style={{ cursor: 'pointer', transition: 'opacity 400ms' }}
                opacity={on ? 1 : 0.4}
              >
                <circle cx={d.x} cy={d.y} r={on ? 40 : 32} fill={d.colour} stroke={on ? '#2b2825' : '#bdb6a8'} strokeWidth={on ? 2 : 1.5} style={{ transition: 'r 400ms' }} />
                <text x={d.x} y={d.y + (d.y < 100 ? -52 : 64)} textAnchor="middle" className="font-sans" fontSize="17" fontWeight={on ? 600 : 400} fill="#2b2825">
                  {d.day} · {d.dir}
                </text>
              </g>
            );
          })}
          <text x="200" y="196" textAnchor="middle" className="font-sans" fontSize="15" fill="#6b645a">
            year {year}
          </text>
          <text x="200" y="216" textAnchor="middle" className="font-sans" fontSize="15" fontWeight={600} fill="#2b2825">
            {b.day}
          </text>
        </svg>

        <div className="font-sans text-sm text-secondary" aria-live="polite">
          <p className="text-base text-primary">
            A year of <strong>{b.day}</strong>: the Bacab of the {b.dir.toLowerCase()}
          </p>
          <p className="mt-2">
            Landa&rsquo;s names for him: {b.names.join(', ')}. Placed &ldquo;{b.landaDir}&rdquo;.
          </p>
          <p className="mt-2">
            Colour in the names: <em>{b.colourWord}</em>, &ldquo;{b.gloss}&rdquo; (
            <Link href={`/book/${PIO}?page=${b.pioPage}`}>Pío Pérez</Link>).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="rounded border border-border-light px-3 py-1.5 text-primary hover:bg-stone-50"
            >
              {playing ? 'Pause' : 'Play the years'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setActive((a) => (a + 1) % 4);
                setYear((y) => y + 1);
              }}
              className="rounded border border-border-light px-3 py-1.5 text-primary hover:bg-stone-50"
            >
              Next year
            </button>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-sm text-muted leading-relaxed">
        The four days that could open a year, each with its Bacab and its quarter of the world, in the order Landa gives them. Click a quarter, or play the years in turn. Days, names and directions from <Link href={`/book/${LANDA}?page=331`}>Landa, printed p. 208</Link>; colour words from Pío Pérez&rsquo;s dictionary. North is at the top.
      </figcaption>
    </figure>
  );
}
