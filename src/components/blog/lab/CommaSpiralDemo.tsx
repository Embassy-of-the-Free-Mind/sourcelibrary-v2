'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const ROOT = 220;
const JUST_FIFTH = 1200 * Math.log2(3 / 2); // 701.955 ¢
const EQUAL_FIFTH = 700;

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
  const gapDeg = n === 12 && temper === 'just' ? (points[12].cents / 1200) * 360 : 0;

  // Arc marking the comma gap, drawn just outside the final landing.
  const gapArc = () => {
    const r = points[12].r + 9;
    const a = (2 * Math.PI * points[12].cents) / 1200;
    const x1 = C + r * Math.sin(a);
    const y1 = C - r * Math.cos(a);
    return `M ${C} ${C - r} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };

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

      {/* the comma gap */}
      {gapDeg > 0 && (
        <g>
          <path d={gapArc()} fill="none" stroke="#a8503c" strokeWidth={2.5} strokeLinecap="round" />
          <text x={C + 8} y={C - points[12].r - 14} fontSize={10} fill="#a8503c">
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
    </LabCard>
  );
}
