'use client';

import { useEffect, useRef, useState } from 'react';

/** Width of the element in CSS pixels, so the SVG draws at 1:1 and its labels stay readable on a phone. */
function useWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/*
 * Two small interactive panels for the Bodin and Kepler section.
 *
 * 1. The three classical means of two numbers, on one scale from the smaller
 *    number to the larger. Presets are the pairs Kepler uses on p. 86 (6 and
 *    12, arithmetic mean 9) and p. 87 (8 and 18, geometric mean 12) of
 *    Harmonices mundi III.
 * 2. Kepler's test sets from p. 87, with the kind of progression each one is
 *    and what Kepler says Bodin made of it.
 *
 * Colours: the first three slots of the dataviz reference palette (validated
 * all-pairs in light mode); every mark is also labelled in text.
 */

const COL = { A: '#2a78d6', G: '#eb6834', H: '#1baf7a' } as const;

type MeanKey = keyof typeof COL;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function means(a: number, b: number) {
  return {
    A: { name: 'Arithmetic', value: (a + b) / 2, formula: `(${a} + ${b}) / 2` },
    G: { name: 'Geometric', value: Math.sqrt(a * b), formula: `√(${a} × ${b})` },
    H: { name: 'Harmonic', value: (2 * a * b) / (a + b), formula: `2 × ${a} × ${b} / (${a} + ${b})` },
  } as const;
}

const PRESETS: { a: number; b: number; note: string }[] = [
  { a: 6, b: 12, note: 'Kepler, p. 86: 9 is the arithmetic mean of 6 and 12' },
  { a: 8, b: 18, note: 'Kepler, p. 87: 12 is the geometric mean of 8 and 18' },
];

function MeansPanel() {
  const [a, setA] = useState(6);
  const [b, setB] = useState(12);
  const [hover, setHover] = useState<MeanKey | null>(null);
  const [box, W] = useWidth();
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const m = means(lo, hi);
  const left = W < 420 ? 88 : 110;
  const right = 24;
  const x = (v: number) => (hi === lo ? left + (W - left - right) / 2 : left + ((v - lo) / (hi - lo)) * (W - left - right));
  const rows: MeanKey[] = ['A', 'G', 'H'];
  const preset = PRESETS.find((p) => p.a === lo && p.b === hi);

  return (
    <div ref={box}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-secondary">
        <label className="flex items-center gap-2">
          <span className="w-16">Smaller</span>
          <input type="range" min={1} max={24} value={a} onChange={(e) => setA(Number(e.target.value))} aria-label="Smaller number" />
          <span className="w-6 tabular-nums text-primary">{a}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-16">Larger</span>
          <input type="range" min={1} max={48} value={b} onChange={(e) => setB(Number(e.target.value))} aria-label="Larger number" />
          <span className="w-6 tabular-nums text-primary">{b}</span>
        </label>
        <div className="flex gap-2">
          {PRESETS.map((p) => (
            <button
              key={`${p.a}-${p.b}`}
              type="button"
              onClick={() => {
                setA(p.a);
                setB(p.b);
              }}
              className={`rounded border px-2.5 py-1 ${p.a === lo && p.b === hi ? 'border-primary text-primary' : 'border-border-medium text-secondary hover:text-primary'}`}
            >
              {p.a} and {p.b}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} 150`} width={W} className="mt-4 block max-w-full h-auto" role="img" aria-label={`Means of ${lo} and ${hi}: arithmetic ${fmt(m.A.value)}, geometric ${fmt(m.G.value)}, harmonic ${fmt(m.H.value)}`}>
        {/* end ticks */}
        {[lo, hi].map((v, i) => (
          <g key={i}>
            <line x1={x(v)} x2={x(v)} y1={14} y2={124} stroke="var(--border-medium)" strokeWidth={1} />
            <text x={x(v)} y={142} textAnchor="middle" fontSize={13} fill="var(--text-secondary)">
              {v}
            </text>
          </g>
        ))}
        {rows.map((k, i) => {
          const y = 34 + i * 38;
          const v = m[k].value;
          const dim = hover && hover !== k;
          return (
            <g key={k} opacity={dim ? 0.35 : 1} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <rect x={0} y={y - 18} width={W} height={36} fill="transparent" />
              <text x={0} y={y + 4} fontSize={13} fill="var(--text-primary)">
                {m[k].name}
              </text>
              <line x1={x(lo)} x2={x(hi)} y1={y} y2={y} stroke="var(--border-light)" strokeWidth={2} />
              <line x1={x(lo)} x2={x(v)} y1={y} y2={y} stroke={COL[k]} strokeWidth={2} strokeLinecap="round" />
              <circle cx={x(v)} cy={y} r={6} fill={COL[k]} stroke="var(--bg-white, #fff)" strokeWidth={2} />
              <text x={x(v)} y={y - 11} textAnchor="middle" fontSize={13} fill="var(--text-primary)" className="tabular-nums">
                {fmt(v)}
              </text>
              <title>{`${m[k].name} mean = ${m[k].formula} = ${fmt(v)}`}</title>
            </g>
          );
        })}
      </svg>

      <p className="mt-1 text-sm text-secondary tabular-nums">
        {hover ? (
          <>
            {m[hover].name} mean: {m[hover].formula} = {fmt(m[hover].value)}
          </>
        ) : (
          <>
            Harmonic {fmt(m.H.value)} &le; geometric {fmt(m.G.value)} &le; arithmetic {fmt(m.A.value)}
            {preset ? `. ${preset.note}.` : '. Hover a row for its formula.'}
          </>
        )}
      </p>
    </div>
  );
}

type Verdict = { set: number[]; bodin: string };

// Kepler, Harmonices mundi III, p. 87: the sets he names and what he says Bodin made of them.
// Kepler counts every one of them as harmonic.
const SETS: Verdict[] = [
  { set: [1, 2, 4], bodin: 'denies it produces harmony on its own' },
  { set: [1, 2, 3], bodin: 'recognises it as harmonic, against his own rule' },
  { set: [2, 3, 4], bodin: 'recognises it as harmonic, against his own rule' },
  { set: [3, 4, 5], bodin: 'denies it is a harmonic concord' },
  { set: [4, 5, 6], bodin: 'denies it is a harmonic concord' },
  { set: [1, 3, 5], bodin: 'denies it is a harmonic concord' },
  { set: [2, 5, 8], bodin: 'denies it is a harmonic concord' },
];

const gcd = (p: number, q: number): number => (q === 0 ? p : gcd(q, p % q));
const ratio = (p: number, q: number) => {
  const g = gcd(q, p);
  return `${q / g}:${p / g}`;
};

function SetsPanel() {
  const [i, setI] = useState(0);
  const { set, bodin } = SETS[i];
  const [p, q, r] = set;
  const kind = q - p === r - q ? 'equal differences: an arithmetic progression' : q * q === p * r ? 'equal ratios: a geometric progression' : 'neither';
  const [box, W] = useWidth();
  const x = (v: number) => 16 + (v / 8) * (W - 32);

  return (
    <div ref={box}>
      <div className="flex flex-wrap gap-2 text-sm">
        {SETS.map((s, k) => (
          <button
            key={s.set.join('-')}
            type="button"
            onClick={() => setI(k)}
            onMouseEnter={() => setI(k)}
            className={`rounded border px-2.5 py-1 tabular-nums ${k === i ? 'border-primary text-primary' : 'border-border-medium text-secondary hover:text-primary'}`}
          >
            {s.set.join(', ')}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} 74`} width={W} className="mt-4 block max-w-full h-auto" role="img" aria-label={`The set ${set.join(', ')} on a scale from 0 to 8`}>
        <line x1={x(0)} x2={x(8)} y1={40} y2={40} stroke="var(--border-light)" strokeWidth={2} />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={36} y2={44} stroke="var(--border-medium)" strokeWidth={1} />
            <text x={x(v)} y={64} textAnchor="middle" fontSize={12} fill="var(--text-muted)">
              {v}
            </text>
          </g>
        ))}
        {[
          [p, q],
          [q, r],
        ].map(([s, e], k) => (
          <g key={k}>
            <line x1={x(s)} x2={x(e)} y1={40} y2={40} stroke={COL.A} strokeWidth={2} />
            <text x={(x(s) + x(e)) / 2} y={k === 0 ? 28 : 12} textAnchor="middle" fontSize={13} fill="var(--text-secondary)">
              +{e - s}, {ratio(s, e)}
            </text>
          </g>
        ))}
        {set.map((v) => (
          <circle key={v} cx={x(v)} cy={40} r={6} fill={COL.A} stroke="var(--bg-white, #fff)" strokeWidth={2} />
        ))}
      </svg>
      <p className="mt-1 text-sm text-secondary">
        <span className="text-primary tabular-nums">{set.join(', ')}</span>: {kind}. Kepler counts it as harmonic; Bodin,
        he says, {bodin}.
      </p>
    </div>
  );
}

export default function MeansDiagram() {
  return (
    <figure className="not-prose my-10 border border-border-light bg-white p-4 md:p-6 font-sans">
      <h3 className="text-base text-primary mb-3">Three means of two numbers</h3>
      <MeansPanel />
      <h3 className="text-base text-primary mt-8 mb-3">Kepler&apos;s test sets against Bodin&apos;s rule</h3>
      <SetsPanel />
      <figcaption className="mt-6 text-xs text-muted leading-relaxed">
        The means use the standard definitions: arithmetic (a + b) / 2, geometric &radic;ab, harmonic 2ab / (a + b). The
        preset pairs, the seven sets and both verdicts are from Kepler, <em>Harmonices mundi</em> III (Linz, 1619), pp.
        86&ndash;87, in the library&apos;s translation.
      </figcaption>
    </figure>
  );
}
