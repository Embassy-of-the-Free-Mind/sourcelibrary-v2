'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Chip } from './LabCard';

const RUST = 'var(--accent-rust, #a8503c)';
const NUMBERS = [6, 8, 9, 12];
const XS = [150, 370, 590, 810];

type Reading = 'len' | 'wgt' | 'ham';

/**
 * The Lyre of Mercury's four numbers — 6 · 8 · 9 · 12 — read three ways.
 * Galilei records the fight over which end is low (Dialogo p. 144: Plutarch
 * puts 6 on the lowest string, the Zarlino camp 12 — "exactly the opposite")
 * and diagnoses it: one camp read the numbers as weights, the other as
 * measures. Each reading is a different physical law, so each sings a
 * different chord. Verified verbatim: sourcelibrary.org/q/BeoftnrTNYqCao3dYsy
 */
const READINGS: Record<Reading, {
  button: string;
  freqs: number[];
  pure: boolean;
  verdict: string;
  direction: string;
}> = {
  len: {
    button: 'As lengths — Zarlino’s direction',
    freqs: NUMBERS.map((n) => 1760 / n),
    pure: true,
    verdict:
      '12:6 sounds the octave; 12:8 and 9:6 pure fifths; 12:9 and 8:6 pure fourths; 9:8 the tone. The Greatest Harmony, exactly as promised — the long string lies low, just as Zarlino’s direction says.',
    direction: 'sounding low → high: 12 · 9 · 8 · 6 — bigger number, deeper voice.',
  },
  wgt: {
    button: 'As hung weights — Plutarch’s direction',
    freqs: NUMBERS.map((n) => 165 * Math.sqrt(n / 6)),
    pure: false,
    verdict:
      'Every span halves: 12 against 6 sounds 600¢ — the tritone — the “fifths” sound 351¢, the “fourths” 249¢. No names in the scale. But notice the direction: the heaviest weight sings highest, exactly as Plutarch’s ordering implies. Right direction, wrong intervals.',
    direction: 'sounding low → high: 6 · 8 · 9 · 12 — bigger weight, higher voice.',
  },
  ham: {
    button: 'As struck hammers — scale model',
    freqs: NUMBERS.map((n) => 260 * Math.cbrt(6 / n)),
    pure: false,
    verdict:
      'Solid bodies scale by the cube root: 12 against 6 rings only ~400¢ apart and the whole chord crushes into a cluster — with the heavy hammer sunk low, against both the legend and Galilei’s own guess. And in a real forge the anvil sings one note regardless of the hammer.',
    direction: 'sounding low → high: 12 · 9 · 8 · 6 — but squeezed to a third of the promised spans.',
  },
};

export default function LyreReadingsDemo() {
  const [reading, setReading] = useState<Reading>('len');
  const [ringing, setRinging] = useState<number[]>([]);
  const engineRef = useRef<ToneEngine | null>(null);

  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const R = READINGS[reading];

  const play = (r: Reading) => {
    setReading(r);
    if (!engineRef.current) engineRef.current = new ToneEngine();
    const e = engineRef.current;
    const cfg = READINGS[r];
    const order = cfg.freqs
      .map((f, i) => ({ f, i }))
      .sort((a, b) => a.f - b.f);
    order.forEach(({ f, i }, k) => {
      e.pluck(f, k * 0.32, 0.9);
      window.setTimeout(() => {
        setRinging((prev) => [...prev, i]);
        window.setTimeout(() => setRinging((prev) => prev.filter((x) => x !== i)), 480);
      }, 60 + k * 320);
    });
    cfg.freqs.forEach((f) => e.pluck(f, 4 * 0.32 + 0.5, 0.6));
  };

  // Precomputed geometry per station (React Compiler hoist rule).
  const stations = NUMBERS.map((n, i) => {
    const x = XS[i];
    const rings = ringing.includes(i);
    const stringLen = n * 17;
    const panSide = 14 + n * 3.2;
    const hamW = 26 + n * 5.5;
    const hamH = 16 + n * 3;
    const labelY =
      reading === 'len' ? 34 + stringLen + 32 :
      reading === 'wgt' ? 152 + panSide + 26 :
      72 + hamH + 30;
    return { n, x, rings, stringLen, panSide, hamW, hamH, labelY, freq: R.freqs[i] };
  });

  return (
    <LabCard
      title="The Lyre of Mercury — but which way up?"
      caption="Boethius gives Mercury's lyre four strings in the proportions 6 · 8 · 9 · 12 — the hammer numbers. Plutarch's camp put 6 on the lowest string; Zarlino's put 12 there, and Galilei saw why: one camp read the numbers as weights, the other as lengths. Each reading is a law; each law is a chord. Choose one and listen —"
      sourceHref="/book/dialogo-della-musica-antica-et-della-moderna-galilei?page=144"
      sourceLabel="Vincenzo Galilei, Dialogo (1581), p. 144"
    >
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(Object.keys(READINGS) as Reading[]).map((r) => (
          <Chip key={r} active={reading === r} onClick={() => play(r)}>
            ▶ {READINGS[r].button}
          </Chip>
        ))}
      </div>

      <svg viewBox="0 0 900 300" className="w-full h-auto" role="img"
        aria-label="Four strings, weights, or hammers labeled 6, 8, 9 and 12, drawn according to the selected physical reading of the numbers.">
        <line x1="60" y1="34" x2="840" y2="34" stroke="#44403c" strokeWidth="2" />
        {stations.map((s) => (
          <g key={s.n}>
            {reading !== 'ham' && (
              <line
                x1={s.x} y1={34} x2={s.x}
                y2={reading === 'len' ? 34 + s.stringLen : 144}
                stroke={s.rings ? RUST : '#44403c'} strokeWidth={s.rings ? 2.6 : 2}
              />
            )}
            {reading === 'len' && (
              <rect x={s.x - 11} y={34 + s.stringLen} width={22} height={7} fill="#a16207" />
            )}
            {reading === 'wgt' && (
              <g>
                <line x1={s.x} y1={144} x2={s.x} y2={152} stroke="#44403c" strokeWidth="1.1" />
                <rect
                  x={s.x - s.panSide / 2} y={152} width={s.panSide} height={s.panSide}
                  fill="none" stroke={s.rings ? RUST : '#a8503c'} strokeWidth={s.rings ? 2.4 : 1.5}
                />
              </g>
            )}
            {reading === 'ham' && (
              <g>
                <line x1={s.x} y1={34} x2={s.x} y2={72} stroke="#44403c" strokeWidth="1.1" />
                <rect
                  x={s.x - s.hamW / 2} y={72} width={s.hamW} height={s.hamH}
                  fill="none" stroke={s.rings ? RUST : '#44403c'} strokeWidth={s.rings ? 2.4 : 1.8}
                />
              </g>
            )}
            <text x={s.x} y={s.labelY} fontSize="22" fontFamily="serif" fontWeight="700"
              fill={s.rings ? RUST : '#a16207'} textAnchor="middle">{s.n}</text>
            <text x={s.x} y={s.labelY + 18} fontSize="11" fontFamily="monospace"
              fill="#78716c" textAnchor="middle">{s.freq.toFixed(1)} HZ</text>
          </g>
        ))}
      </svg>

      <div className={`mt-3 px-3 py-2.5 text-sm border-l-[3px] bg-cream ${R.pure ? 'border-emerald-700' : 'border-[var(--accent-rust,#a8503c)]'}`}>
        {R.verdict}
      </div>
      <p className="text-xs text-muted italic mt-2">{R.direction}</p>
    </LabCard>
  );
}
