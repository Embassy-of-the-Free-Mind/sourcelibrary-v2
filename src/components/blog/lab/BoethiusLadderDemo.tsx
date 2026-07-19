'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Chip } from './LabCard';
import { Genus, GPS_MOVABLE, GPS_NAMES, GPS_RULER, gpsRatios, noteName } from './pythagorean';

const BASE = 110; // Proslambanomenos; Nete hyperboleon lands on A4 = 440
const RUST = 'var(--accent-rust, #a8503c)';
const BRASS = '#a16207';

const rowY = (i: number) => 404 - i * 27;

/** Arcs between the FIXED strings — these hold in every genus. */
const ARCS: { lo: number; hi: number; label: string; big: boolean }[] = [
  { lo: 0, hi: 7, label: 'diapason — the octave', big: true },
  { lo: 7, hi: 14, label: 'diapason — the octave', big: true },
  { lo: 4, hi: 8, label: 'diapente — the fifth', big: false },
  { lo: 7, hi: 11, label: 'diapente — the fifth', big: false },
  { lo: 1, hi: 4, label: 'diatessaron — the fourth', big: false },
  { lo: 4, hi: 7, label: 'diatessaron — the fourth', big: false },
  { lo: 8, hi: 11, label: 'diatessaron — the fourth', big: false },
  { lo: 11, hi: 14, label: 'diatessaron — the fourth', big: false },
  { lo: 0, hi: 1, label: 'tonus — the tone', big: false },
  { lo: 7, hi: 8, label: 'tonus — the disjunction tone', big: false },
];

const GENUS_LABEL: Record<Genus, string> = { dia: 'Diatonic', chr: 'Chromatic', enh: 'Enharmonic' };

/**
 * The Greater Perfect System of our Boethius manuscript (De institutione
 * musica, the wing-diagram pages of Book IV), replicated and strung: fifteen
 * strings whose drawn lengths are true to the monochord numbers (f ∝ 1/N on
 * the 9,216 ruler), arcs that play their dyads, and the three genera the
 * manuscript itself draws. The diatonic ladder reproduces the manuscript
 * tradition's canonical integers — 9216, 8192, 7776 … 2304 — exactly.
 */
export default function BoethiusLadderDemo() {
  const [genus, setGenus] = useState<Genus>('dia');
  const [ringing, setRinging] = useState<number[]>([]);
  const [now, setNow] = useState('');
  const engineRef = useRef<ToneEngine | null>(null);

  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const engine = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    return engineRef.current;
  };

  // Precompute every row's geometry and labels as plain scalars.
  const ratios = gpsRatios(genus);
  const rows = GPS_NAMES.map((name, i) => {
    const ratio = ratios[i];
    const N = GPS_RULER / ratio;
    const freq = BASE * ratio;
    return {
      i,
      name,
      y: rowY(i),
      x2: 150 + 320 * (N / GPS_RULER),
      num: Math.round(N),
      note: noteName(freq),
      freq,
      movable: GPS_MOVABLE.has(i),
      rings: ringing.includes(i),
    };
  });

  const ring = (i: number) => {
    setRinging((prev) => [...prev, i]);
    window.setTimeout(() => setRinging((prev) => prev.filter((x) => x !== i)), 480);
  };
  const announce = (i: number, rs: number[]) => {
    setNow(`${GPS_NAMES[i]} · ${(BASE * rs[i]).toFixed(1)} Hz · ${noteName(BASE * rs[i])} · number ${Math.round(GPS_RULER / rs[i])}`);
  };

  const pluckRow = (i: number) => {
    engine().pluck(BASE * ratios[i], 0, 0.9);
    ring(i);
    announce(i, ratios);
  };

  const playArc = (lo: number, hi: number, label: string) => {
    const e = engine();
    e.pluck(BASE * ratios[lo], 0, 0.9);
    e.pluck(BASE * ratios[hi], 0, 0.9);
    ring(lo); ring(hi);
    setNow(`${label}: ${GPS_NAMES[lo]} + ${GPS_NAMES[hi]} · ${noteName(BASE * ratios[lo])} + ${noteName(BASE * ratios[hi])}`);
  };

  const selectGenus = (g: Genus) => {
    setGenus(g);
    const rs = gpsRatios(g);
    const e = engine();
    // Sound the genus: the meson tetrachord ascending, slow enough to follow.
    [4, 5, 6, 7].forEach((r, k) => {
      e.pluck(BASE * rs[r], k * 0.42, 0.9);
      window.setTimeout(() => { ring(r); announce(r, rs); }, 60 + k * 420);
    });
  };

  const runLadder = () => {
    const e = engine();
    for (let i = 0; i < 15; i++) {
      e.pluck(BASE * ratios[i], i * 0.22, 0.8);
      window.setTimeout(() => { ring(i); announce(i, ratios); }, 50 + i * 220);
    }
  };

  return (
    <LabCard
      title="The Greater Perfect System, strung"
      caption="The fifteen strings of ancient music as our manuscript diagrams them, with each string's monochord number on the 9,216 ruler. Tap strings, tap arcs, switch the genus — the brass strings are the movable notes, and their numbers re-divide as the manuscript's own diagrams show. Replicated from"
      sourceHref="/book/de-institutione-musica-15th-c-ms-boethius?page=80"
      sourceLabel="Boethius, De institutione musica (15th-c. MS)"
    >
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(['dia', 'chr', 'enh'] as Genus[]).map((g) => (
          <Chip key={g} active={genus === g} onClick={() => selectGenus(g)}>{GENUS_LABEL[g]}</Chip>
        ))}
        <Chip onClick={runLadder}>▶ Run the ladder</Chip>
      </div>

      <svg viewBox="0 0 720 420" className="w-full h-auto" role="img"
        aria-label="The fifteen strings of the Greater Perfect System drawn as a ladder, each labeled with its Greek name, modern note, and monochord number; arcs on the left connect the fixed strings by fourths, fifths, octaves and tones. Every string and arc is playable.">
        {ARCS.map((a, k) => {
          const y1 = rowY(a.lo);
          const y2 = rowY(a.hi);
          const depth = 16 + Math.abs(a.lo - a.hi) * 9;
          const mid = (y1 + y2) / 2;
          return (
            <g key={k}>
              <path
                d={`M 146 ${y1} Q ${146 - depth} ${mid} 146 ${y2}`}
                fill="none" stroke="#a8a29e" strokeWidth="1.2"
                className="cursor-pointer hover:stroke-[var(--accent-rust,#a8503c)]"
                onClick={() => playArc(a.lo, a.hi, a.label)}
              >
                <title>{`${a.label} — play both strings`}</title>
              </path>
              {a.big && (
                <text
                  x={146 - depth - 8} y={mid + 3} fontSize="9.5" fontFamily="monospace"
                  fill="#a8a29e" textAnchor="middle" pointerEvents="none"
                  transform={`rotate(-90 ${146 - depth - 8} ${mid})`}
                >DIAPASON</text>
              )}
            </g>
          );
        })}
        {rows.map((r) => (
          <g key={r.i}>
            <line
              x1={150} y1={r.y} x2={r.x2} y2={r.y}
              stroke={r.rings ? RUST : r.movable ? BRASS : '#44403c'}
              strokeWidth={r.rings ? 2.6 : 2}
              className="cursor-pointer" onClick={() => pluckRow(r.i)}
            >
              <title>{`${r.name} — ${r.freq.toFixed(1)} Hz, number ${r.num}`}</title>
            </line>
            <text x={478} y={r.y + 3.5} fontSize="10.5" fontFamily="monospace"
              fill={r.rings ? RUST : '#78716c'}>{r.name}</text>
            <text x={600} y={r.y + 3.5} fontSize="10.5" fontFamily="monospace"
              fill={r.rings ? RUST : '#44403c'}>{r.note}</text>
            <text x={716} y={r.y + 3.5} fontSize="10.5" fontFamily="monospace"
              fill={r.rings ? RUST : BRASS} textAnchor="end">{r.num}</text>
          </g>
        ))}
      </svg>

      <p className="font-mono text-xs text-muted mt-3 min-h-[1.2em]" aria-live="polite">{now || ' '}</p>
      <p className="text-xs text-muted mt-2">
        The middle column gives each string&apos;s nearest modern note with its deviation in cents.
        Even the diatonic sits a few cents off a modern tuner — pure 9:8 tones against equal
        temperament — while the enharmonic&apos;s quarter-tones land ~50¢ between any modern frets.
        The dieses here split the semitone equally; Boethius divides the ruler arithmetically, a
        hair&apos;s difference the ear forgives.
      </p>
    </LabCard>
  );
}
