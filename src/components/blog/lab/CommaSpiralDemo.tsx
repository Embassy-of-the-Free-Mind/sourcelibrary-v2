'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const ROOT = 220;
const JUST_FIFTH = 1200 * Math.log2(3 / 2); // 701.955 ¢
const EQUAL_FIFTH = 700;

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
