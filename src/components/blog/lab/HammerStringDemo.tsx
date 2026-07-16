'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine, centsBetween } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const BASE = 220;

/**
 * Station I — the smith's hammers, falsified.
 *
 * The legend (Boethius, pictured by Gaffurius) says consonance follows hammer
 * WEIGHT in simple ratios: double the weight, get the octave. Vincenzo Galilei
 * tested it (1581): frequency goes as the SQUARE ROOT of tension, so the
 * octave needs 4:1 — and the legend's 2:1 lands on a tritone. String LENGTH,
 * by contrast, really does behave as the legend claims.
 */
export default function HammerStringDemo() {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'length' | 'weight'>('weight');
  const [length, setLength] = useState(1); // fraction of full string, 0.5–1
  const [weight, setWeight] = useState(1); // tension multiple, 1–5

  const engineRef = useRef<ToneEngine | null>(null);

  const freq = mode === 'length' ? BASE / length : BASE * Math.sqrt(weight);
  const cents = Math.round(centsBetween(BASE, freq));
  const isOctave = Math.abs(cents - 1200) <= 6;
  const isTritone = Math.abs(cents - 600) <= 10;

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !playing) return;
    e.setVoice('ref', BASE, 0.4, 'rich');
    e.setVoice('var', freq, 0.4, 'rich');
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
      title="Station I — Weigh the hammers"
      headerRight={<PlayToggle playing={playing} onClick={toggle} label="Play both strings" />}
      caption="A fixed string sounds 220 Hz. Change the second one by shortening it, or by hanging weight on it — and watch which rule actually delivers the octave. The legend's 2:1 weight lands on the tritone."
      sourceHref="/book/dialogo-della-musica-antica-et-della-moderna-galilei"
      sourceLabel="Vincenzo Galilei, Dialogo (1581)"
    >
      <div className="flex gap-1.5 mb-4">
        <Chip active={mode === 'weight'} onClick={() => setMode('weight')}>Hang weights (tension)</Chip>
        <Chip active={mode === 'length'} onClick={() => setMode('length')}>Shorten the string</Chip>
      </div>

      {mode === 'weight' ? (
        <label className="block">
          <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
            <span>Weight on the second string</span>
            <span className="font-mono text-primary">{weight.toFixed(2)}×</span>
          </span>
          <input
            type="range" min={1} max={5} step={0.01} value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="w-full accent-[var(--accent-rust,#a8503c)]"
            aria-label="Tension multiple on the second string"
          />
        </label>
      ) : (
        <label className="block">
          <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
            <span>Length of the second string</span>
            <span className="font-mono text-primary">{Math.round(length * 100)}%</span>
          </span>
          <input
            type="range" min={0.5} max={1} step={0.005} value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full accent-[var(--accent-rust,#a8503c)]"
            aria-label="Length of the second string as a fraction of the first"
          />
        </label>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Readout label="Second string" value={`${freq.toFixed(1)} Hz`} note="first stays 220.0 Hz" />
        <Readout label="Interval" value={`${cents} ¢`} note={isOctave ? '✓ OCTAVE' : isTritone ? 'tritone — the legend fails' : ' '} />
        <Readout
          label="The law"
          value={mode === 'weight' ? 'f ∝ √tension' : 'f ∝ 1 / length'}
          note={mode === 'weight' ? 'octave needs 4:1' : 'octave at 1/2 — as told'}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip onClick={() => { setMode('weight'); setWeight(2); }}>The legend&apos;s claim: 2:1 weight</Chip>
        <Chip onClick={() => { setMode('weight'); setWeight(4); }}>Galilei&apos;s result: 4:1 weight</Chip>
        <Chip onClick={() => { setMode('length'); setLength(0.5); }}>Halve the string</Chip>
        <Chip onClick={() => { setMode('length'); setLength(2 / 3); }}>2/3 of the string (a fifth)</Chip>
      </div>
    </LabCard>
  );
}
