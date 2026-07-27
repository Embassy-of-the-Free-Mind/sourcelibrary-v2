'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ToneEngine } from './audio';
import { LabCard, Readout } from './LabCard';

const EULER_PLATE =
  'https://images.sourcelibrary.org/gallery/6990585917295890441359aa/6990585a17295890441359ec-0.jpg';

/**
 * One dyad in the idiom of Euler's own figures (Tentamen figs. 1–9): two
 * rows of pulse dots, one per voice, coincidences enlarged. Shown ONLY on
 * the results screen — the dot alignment gives away the ratio's simplicity,
 * so rendering it during the blind trial would let the eye outvote the ear.
 */
function EulerDots({ p, q }: { p: number; q: number }) {
  const cyclePx = 56;
  const cycles = 4;
  const w = cyclePx * cycles;
  const rows: { rate: number; y: number }[] = [
    { rate: p, y: 8 },
    { rate: q, y: 19 },
  ];
  return (
    <svg viewBox={`0 0 ${w} 27`} className="w-full max-w-[240px] block" aria-hidden="true">
      {rows.map((row) =>
        Array.from({ length: row.rate * cycles + 1 }, (_, k) => {
          const x = (k * cyclePx) / row.rate;
          const isCoincidence = k % row.rate === 0;
          return (
            <circle
              key={`${row.y}-${k}`}
              cx={x === 0 ? 2 : Math.min(x, w - 2)}
              cy={row.y}
              r={isCoincidence ? 2.4 : 1.5}
              fill={isCoincidence ? '#a8503c' : '#78716c'}
            />
          );
        })
      )}
    </svg>
  );
}

/**
 * Euler's gradus suavitatis (Tentamen, 1739, ch. II): for a just interval
 * p:q in lowest terms, factor p·q into primes and the degree is
 * 1 + Σ (each prime − 1). Low degree = sweet. Computed here from the
 * ratios, not hardcoded — the formula IS the exhibit.
 */
function gradus(p: number, q: number): number {
  let n = p * q;
  let g = 1;
  for (let d = 2; d <= n; d++) {
    while (n % d === 0) { g += d - 1; n /= d; }
  }
  return g;
}

const ROOT = 262;

const DYADS = [
  { name: 'Octave', p: 1, q: 2 },
  { name: 'Perfect fifth', p: 2, q: 3 },
  { name: 'Perfect fourth', p: 3, q: 4 },
  { name: 'Major sixth', p: 3, q: 5 },
  { name: 'Major third', p: 4, q: 5 },
  { name: 'Minor third', p: 5, q: 6 },
  { name: 'Minor seventh', p: 9, q: 16 },
  { name: 'Semitone', p: 15, q: 16 },
].map((d) => ({ ...d, gradus: gradus(d.p, d.q) }));

const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Average ranks (ties averaged), ascending. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation. */
function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Station X — Euler's formula, against your ear.
 *
 * The Tentamen assigns every just interval a computable "degree of
 * agreeableness". If the formula is a law of taste, listeners' rankings
 * should reproduce its ordering. Rate eight dyads blind; the station
 * computes the rank agreement between you and the mathematics.
 */
export default function EulerGradusDemo() {
  const [order, setOrder] = useState<number[] | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [played, setPlayed] = useState(false);
  const [ratings, setRatings] = useState<number[]>([]); // indexed like DYADS

  const engineRef = useRef<ToneEngine | null>(null);
  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const start = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    setOrder(shuffle(DYADS.map((_, idx) => idx)));
    setRatings(new Array(DYADS.length).fill(0));
    setPlayed(false);
    setI(0);
  };

  const play = async () => {
    if (order === null || busy) return;
    const e = engineRef.current;
    if (!e) return;
    setBusy(true);
    const d = DYADS[order[i]];
    await e.playTones([ROOT, (ROOT * d.q) / d.p], 1600, 'rich', 0.6);
    setBusy(false);
    setPlayed(true);
  };

  const rate = (r: number) => {
    if (order === null || busy || !played) return;
    setRatings((rs) => {
      const next = [...rs];
      next[order[i]] = r;
      return next;
    });
    setPlayed(false);
    setI((v) => v + 1);
  };

  const done = order !== null && i >= DYADS.length;
  // Sweetness should fall as the degree rises, so agreement = −ρ(rating, gradus).
  const agreement = done ? -spearman(ratings, DYADS.map((d) => d.gradus)) : 0;
  const sorted = [...DYADS.keys()].sort((a, b) => DYADS[a].gradus - DYADS[b].gradus);
  const byYourRating = [...DYADS.keys()].sort((a, b) => ratings[b] - ratings[a]);

  return (
    <LabCard
      title="Station X — Grade the formula"
      headerRight={
        <button
          onClick={start}
          className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-accent-rust text-white hover:opacity-90"
        >
          {order === null ? 'Begin rating' : 'Restart'}
        </button>
      }
      caption="Eight intervals in random order. Play each and rate its sweetness from 1 (grating) to 7 (sweet). At the end, your ranking is set against Euler's computed degrees of agreeableness — a formula from 1739, graded by your ear."
      sourceHref="/book/tentamen-novae-theoriae-musicae-euler"
      sourceLabel="Euler, Tentamen novae theoriae musicae (1739)"
    >
      {order === null && (
        <p className="text-sm text-secondary">
          Euler&apos;s rule: reduce the interval to lowest terms, factor the product into primes, add
          (prime − 1) for each factor, plus one. The octave scores <span className="font-mono">2</span>,
          the fifth <span className="font-mono">4</span>, the semitone <span className="font-mono">11</span>.
          Lower is sweeter — says the mathematics. You be the judge.
        </p>
      )}

      {order !== null && !done && (
        <div>
          <p className="text-sm text-muted mb-3">Interval {i + 1} of {DYADS.length}</p>
          <button
            onClick={play}
            disabled={busy}
            className="w-full py-2.5 rounded bg-stone-900 text-white text-sm hover:bg-stone-700 disabled:opacity-40 mb-3"
          >
            {busy ? 'Playing…' : played ? 'Play again' : 'Play the interval'}
          </button>
          <div className="flex gap-1.5 justify-between">
            {[1, 2, 3, 4, 5, 6, 7].map((r) => (
              <button
                key={r}
                onClick={() => rate(r)}
                disabled={busy || !played}
                className="flex-1 py-2 rounded border border-border-light text-sm text-secondary hover:bg-stone-50 disabled:opacity-40"
                aria-label={`Rate ${r} of 7`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted mt-1">
            <span>grating</span>
            <span>sweet</span>
          </div>
        </div>
      )}

      {done && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Readout
              label="Agreement with Euler"
              value={`ρ = ${agreement.toFixed(2)}`}
              note={agreement >= 0.7 ? 'the formula holds for you' : agreement >= 0.3 ? 'partial credit' : 'your ear dissents'}
            />
            <Readout label="Euler's claim" value="ρ = 1.00" note="taste, computable" />
          </div>

          <div className="mb-4 md:flex md:gap-4">
            <Link
              href="/book/tentamen-novae-theoriae-musicae-euler?page=66"
              className="block md:w-44 shrink-0 rounded overflow-hidden border border-border-light hover:border-stone-300"
            >
              <img
                src={EULER_PLATE}
                alt="Euler's engraved figures 1 through 9: rows of dots representing pulse trains of simple ratios"
                className="w-full h-auto"
                loading="lazy"
              />
            </Link>
            <div className="mt-3 md:mt-0 min-w-0 grow">
              <p className="text-xs text-secondary mb-2">
                Euler drew every ratio as rows of coinciding pulses (figs. 1–9, engraved at left —
                hidden until now so your eye couldn&apos;t outvote your ear). Here are the same
                figures ordered by <em>your</em> ratings, sweetest first — the data column his 1739
                page was missing:
              </p>
              <div className="space-y-2">
                {byYourRating.map((idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-[10px] text-muted w-28 shrink-0">
                      {DYADS[idx].name} · {ratings[idx]}/7 <span className="font-mono">(g {DYADS[idx].gradus})</span>
                    </span>
                    <EulerDots p={DYADS[idx].p} q={DYADS[idx].q} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <table className="w-full text-xs text-secondary">
            <thead>
              <tr className="text-muted uppercase tracking-wider text-[10px]">
                <th className="text-left py-1 font-medium">Interval</th>
                <th className="text-left py-1 font-medium">Ratio</th>
                <th className="text-left py-1 font-medium">Euler&apos;s degree</th>
                <th className="text-left py-1 font-medium">Your rating</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((idx) => (
                <tr key={idx} className="border-t border-border-light">
                  <td className="py-1">{DYADS[idx].name}</td>
                  <td className="py-1 font-mono">{DYADS[idx].p}:{DYADS[idx].q}</td>
                  <td className="py-1 font-mono">{DYADS[idx].gradus}</td>
                  <td className="py-1 font-mono">{ratings[idx]} / 7</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LabCard>
  );
}
