'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ToneEngine } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const ROOT = 220;
const JUST_FIFTH = 1200 * Math.log2(3 / 2); // 701.955 ¢
const EQUAL_FIFTH = 700;

/**
 * The circle-as-pitch-space convention this station draws is itself a
 * historical artifact we hold: Descartes' Compendium Musicae — his first
 * book, written 1618 (ours is the 1656 printing) — renders the octave as
 * nested circles, intervals as arcs. `focus` is the CSS object-position
 * that centers each plate's circle in the square thumbnail crop.
 */
const DESCARTES_PLATES = [
  {
    src: 'https://images.sourcelibrary.org/archived/69b1cafca282e3475aab4148/23.jpg',
    href: '/book/musicae-compendium-descartes?page=23',
    label: 'The consonances as nested arcs',
    detail: 'Diapason, diapente, diatessaron — every consonance drawn as an arc of the same circle, so that adding a full turn adds an octave.',
    focus: '50% 52%',
  },
  {
    src: 'https://images.sourcelibrary.org/archived/69b1cafca282e3475aab4148/33.jpg',
    href: '/book/musicae-compendium-descartes?page=33',
    label: 'The octave ring, with string numbers',
    detail: 'The solmization syllables around concentric rings, each note pinned to a string number (C.360, D.320/324, A.432…) — the same angle-is-pitch convention as the diagram above, three centuries early.',
    focus: '50% 38%',
  },
];
// The p31 schisma pie is no longer in this strip — it graduated to a live
// instrument of its own (SchismaSliverDemo, directly below this station).

// Pitch-class letters reached from A by successive fifths.
const FIFTH_NAMES = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'F', 'C', 'G', 'D'];

/**
 * The circle the fifths actually draw. Angle is honest pitch space — cents
 * around the octave, root at twelve o'clock — so successive fifths hop
 * ~210° and trace the {12/7} star. The radius creeps outward one notch per
 * step, making the walk legible and letting the twelfth landing sit right
 * next to the root: dead aligned under Zhu Zaiyu's fifths, visibly rotated
 * past it by the comma under pure 3:2.
 */
function CommaCircle({ n, fifth, temper }: { n: number; fifth: number; temper: 'just' | 'equal' }) {
  const C = 140;
  const pt = (step: number) => {
    const cents = ((step * fifth) % 1200 + 1200) % 1200;
    const theta = (2 * Math.PI * cents) / 1200;
    const r = 76 + step * 3.2;
    return { x: C + r * Math.sin(theta), y: C - r * Math.cos(theta), cents, r };
  };
  const points = Array.from({ length: n + 1 }, (_, i) => pt(i));

  // Comma-gap annotation, fully precomputed: no array indexing may sit inside
  // conditional JSX — the React Compiler can hoist member accesses above the
  // guard (same failure mode as the TranslationEditor inline-conditional bug).
  const last = points[points.length - 1];
  const showGap = n === 12 && temper === 'just';
  let gapPath = '';
  let wedgePath = '';
  let gapTextY = 0;
  if (showGap) {
    const r = last.r + 9;
    const a = (2 * Math.PI * last.cents) / 1200;
    const ax = C + r * Math.sin(a);
    const ay = C - r * Math.cos(a);
    gapPath = `M ${C} ${C - r} A ${r} ${r} 0 0 1 ${ax} ${ay}`;
    // The comma as Descartes drew his schisma: a filled sliver of the pie,
    // not a mark — the leftover has area.
    wedgePath = `M ${C} ${C} L ${C} ${C - r} A ${r} ${r} 0 0 1 ${ax} ${ay} Z`;
    gapTextY = C - last.r - 14;
  }

  return (
    <svg viewBox="0 0 280 280" className="w-full max-w-[280px] mx-auto block" role="img"
      aria-label={`Circle of fifths after ${n} steps: ${temper === 'just' ? 'pure fifths spiral past the root by the comma' : 'equal fifths close the circle'}`}>
      {/* pitch-class ring + semitone ticks */}
      <circle cx={C} cy={C} r={76} fill="none" stroke="#d6d3d1" strokeWidth={1} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (2 * Math.PI * i) / 12;
        return (
          <line key={i}
            x1={C + 72 * Math.sin(a)} y1={C - 72 * Math.cos(a)}
            x2={C + 76 * Math.sin(a)} y2={C - 76 * Math.cos(a)}
            stroke="#d6d3d1" strokeWidth={1}
          />
        );
      })}

      {/* the walk */}
      {points.length > 1 && (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#a8503c" strokeOpacity={0.35} strokeWidth={1.5}
        />
      )}

      {/* landings */}
      {points.map((p, i) => {
        const isRoot = i === 0;
        const isLast = i === n && n > 0;
        const label = i === 12 ? (temper === 'just' ? 'A′' : 'A') : FIFTH_NAMES[i % 12];
        const lr = p.r + 13;
        const a = (2 * Math.PI * p.cents) / 1200;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={isLast ? 5 : 3.5}
              fill={isRoot ? 'white' : isLast ? '#a8503c' : '#78716c'}
              stroke={isRoot ? '#a8503c' : 'none'} strokeWidth={1.5}
            />
            <text x={C + lr * Math.sin(a)} y={C - lr * Math.cos(a) + 3}
              textAnchor="middle" fontSize={9} fill={isRoot || isLast ? '#a8503c' : '#a8a29e'}>
              {label}
            </text>
          </g>
        );
      })}

      {/* the comma gap — a filled sliver, Descartes' schisma idiom */}
      {showGap && (
        <g>
          <path d={wedgePath} fill="#a8503c" fillOpacity={0.16} stroke="none" />
          <path d={gapPath} fill="none" stroke="#a8503c" strokeWidth={2.5} strokeLinecap="round" />
          <text x={C + 8} y={gapTextY} fontSize={10} fill="#a8503c">
            +23.5 ¢ — the comma
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * Station II — the circle that won't close.
 *
 * Stack twelve pure 3:2 fifths and you should come home to the octave. You
 * don't: the spiral overshoots by the Pythagorean comma (~23.5¢), audible as
 * slow beating against the root. Zhu Zaiyu's 1584 solution — make every
 * fifth the twelfth root of two — closes the circle exactly.
 */
export default function CommaSpiralDemo() {
  const [playing, setPlaying] = useState(false);
  const [n, setN] = useState(0);
  const [temper, setTemper] = useState<'just' | 'equal'>('just');
  const [plate, setPlate] = useState<number | null>(null);
  // Precomputed: no indexing inside conditional JSX — the React Compiler can
  // hoist member access above the null guard (see CommaCircle note below).
  const activePlate = plate === null ? null : DESCARTES_PLATES[plate];

  const engineRef = useRef<ToneEngine | null>(null);

  const fifth = temper === 'just' ? JUST_FIFTH : EQUAL_FIFTH;
  const centsRaw = n * fifth;
  const cents = ((centsRaw % 1200) + 1200) % 1200;
  const drift = n === 12 ? centsRaw - 8400 : null; // vs 7 octaves
  const freq = ROOT * Math.pow(2, cents / 1200);
  const beat = Math.abs(freq - ROOT);

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !playing) return;
    e.setVoice('root', ROOT, 0.4, 'sine');
    e.setVoice('walker', freq, 0.4, 'sine');
  }, [playing, freq]);

  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const toggle = () => {
    if (playing) {
      engineRef.current?.stopAllVoices();
      engineRef.current?.suspend();
      setPlaying(false);
      return;
    }
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    setPlaying(true);
  };

  return (
    <LabCard
      title="Station II — Stack twelve fifths"
      headerRight={<PlayToggle playing={playing} onClick={toggle} label="Play root + walker" />}
      caption="One tone stays on the root; the other walks up a fifth at a time (folded back into the octave). With pure 3:2 fifths, the twelfth step should land back on the root — listen to what it does instead. Then switch to Zhu Zaiyu's equal fifths."
      sourceHref="/book/complete-works-on-music-and-tuning-vol-1"
      sourceLabel="Zhu Zaiyu, Complete Works on Music and Tuning (1596)"
    >
      <div className="flex gap-1.5 mb-4">
        <Chip active={temper === 'just'} onClick={() => setTemper('just')}>Pure fifths (3:2)</Chip>
        <Chip active={temper === 'equal'} onClick={() => setTemper('equal')}>Zhu Zaiyu&apos;s fifths (¹²√2)</Chip>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setN((v) => Math.min(12, v + 1))}
          disabled={n >= 12}
          className="px-4 py-2 rounded-full text-sm font-medium bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add a fifth ({n}/12)
        </button>
        <button
          onClick={() => setN(0)}
          className="px-3 py-2 rounded-full text-xs border border-border-light text-muted hover:text-secondary"
        >
          Reset
        </button>
      </div>

      <div className="mb-4">
        <CommaCircle n={n} fifth={fifth} temper={temper} />
      </div>

      {temper === 'equal' && (
        <div className="mb-4 md:flex md:gap-4 md:items-start rounded border border-border-light bg-cream/60 p-3">
          <Link
            href="/book/complete-works-on-music-and-tuning-vols-4-5?page=99"
            className="block md:w-48 shrink-0 rounded overflow-hidden border border-border-light hover:border-stone-300"
          >
            <img
              src="https://images.sourcelibrary.org/gallery/69c6614901a26ccff09f5036/69c6614901a26ccff09f5099-0.jpg"
              alt="Zhu Zaiyu's woodblock diagram of the twelve equal-tempered pipe lengths as nested L-shaped rules"
              className="w-full h-auto"
              loading="lazy"
            />
          </Link>
          <p className="mt-2 md:mt-0 text-xs text-secondary">
            The twelve lengths that just closed your circle, drawn by the prince himself: each
            pipe shorter than the last by the twelfth root of two, nested like carpenter&apos;s
            rules. From a later volume of the same{' '}
            <Link href="/book/complete-works-on-music-and-tuning-vols-4-5?page=99" className="text-accent-rust underline">
              Complete Works on Music and Tuning
            </Link>{' '}
            the station cites.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Readout label="Walker" value={`${freq.toFixed(1)} Hz`} note={`${Math.round(cents)} ¢ above root`} />
        <Readout
          label="After 12 fifths"
          value={n === 12 ? (drift !== null && Math.abs(drift) < 0.5 ? 'closed ✓' : `+${drift?.toFixed(1)} ¢`) : '—'}
          note={n === 12 ? (temper === 'just' ? 'the Pythagorean comma' : 'the circle closes') : 'keep stacking'}
        />
        <Readout
          label="Beats vs root"
          value={`${beat.toFixed(1)} Hz`}
          note={n === 12 && temper === 'just' ? 'hear the comma churn' : ' '}
        />
      </div>

      {n === 12 && temper === 'just' && (
        <p className="mt-4 text-xs text-muted font-mono">
          3¹²/2¹⁹ = 531441/524288 ≈ 1.01364 — twelve pure fifths overshoot seven octaves by 23.46 ¢
        </p>
      )}

      <div className="mt-5 pt-4 border-t border-border-light">
        <p className="text-[11px] uppercase tracking-wider text-muted mb-2">
          Where the circle comes from — Descartes, age 22
        </p>
        <p className="text-xs text-secondary mb-3">
          Drawing pitch as a circle — one octave per turn, intervals as arcs — was itself an
          invention. The earliest circular pitch diagrams we hold are in{' '}
          <Link href="/book/musicae-compendium-descartes" className="text-accent-rust underline">
            Descartes&apos; <em>Compendium Musicae</em>
          </Link>
          , his first book, written in 1618. Click a folio:
        </p>
        <div className="flex gap-2 mb-3">
          {DESCARTES_PLATES.map((p, i) => (
            <button
              key={p.src}
              onClick={() => setPlate((v) => (v === i ? null : i))}
              className={`w-20 h-20 rounded overflow-hidden border transition-colors ${
                plate === i ? 'border-accent-rust' : 'border-border-light hover:border-stone-300'
              }`}
              aria-label={`${plate === i ? 'Hide' : 'Show'} plate: ${p.label}`}
              aria-expanded={plate === i}
            >
              <img
                src={p.src}
                alt={p.label}
                className="w-full h-full object-cover"
                style={{ objectPosition: p.focus, transform: 'scale(2.4)', transformOrigin: p.focus }}
                loading="lazy"
              />
            </button>
          ))}
        </div>
        {activePlate && (
          <figure className="m-0">
            <img
              src={activePlate.src}
              alt={activePlate.label}
              className="w-full rounded border border-border-light"
              loading="lazy"
            />
            <figcaption className="text-xs text-muted mt-2">
              {activePlate.detail}{' '}
              <Link href={activePlate.href} className="text-accent-rust underline">
                Read this page
              </Link>
            </figcaption>
          </figure>
        )}
      </div>
    </LabCard>
  );
}
