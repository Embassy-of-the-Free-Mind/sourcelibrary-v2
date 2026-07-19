'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Readout, Chip } from './LabCard';
import { outcomeName } from './pythagorean';

const BASE = 220;
const RUST = 'var(--accent-rust, #a8503c)';
const BRASS = '#a16207';

/**
 * Galilei's two strings (Dialogo 1581, p. 145 of our copy): "two strings of
 * the same length, thickness, and quality … stretched to unison over a flat
 * surface", one of them shortened by a movable bridge — AND, the half he put
 * on trial, loaded by a weight hung over the tail pulley. f = f0 · (1/L) · √W.
 * Verified verbatim: sourcelibrary.org/q/BeoftnrTNYqCao3dYsz
 */
export default function GalileiStringsDemo() {
  const [len, setLen] = useState(1); // sounding length of string II, 0.5–1
  const [wgt, setWgt] = useState(1); // weight multiple on string II, 1–5
  const [ringI, setRingI] = useState(false);
  const [ringII, setRingII] = useState(false);
  const engineRef = useRef<ToneEngine | null>(null);

  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const engine = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    return engineRef.current;
  };

  // Precomputed scalars only past this point (React Compiler hoist rule).
  const freq = (BASE / len) * Math.sqrt(wgt);
  const centsUp = Math.round(1200 * Math.log2(freq / BASE));
  const verdict = outcomeName(centsUp);
  const bridgeX = 74 + len * 700;
  const panH = Math.round(16 + wgt * 9);
  const panLabelY = 264 + panH + 17;
  const lenPct = Math.round(len * 100);
  const wgtLabel = wgt.toFixed(2);

  const flash = (which: 'I' | 'II' | 'both') => {
    if (which !== 'II') { setRingI(true); window.setTimeout(() => setRingI(false), 600); }
    if (which !== 'I') { setRingII(true); window.setTimeout(() => setRingII(false), 600); }
  };

  const playI = () => { engine().pluck(BASE); flash('I'); };
  const playII = () => { engine().pluck(freq); flash('II'); };
  const playBoth = () => {
    const e = engine();
    e.pluck(BASE);
    e.pluck(freq);
    flash('both');
  };

  const preset = (l: number, w: number) => {
    setLen(l);
    setWgt(w);
    const e = engine();
    e.pluck(BASE);
    e.pluck((BASE / l) * Math.sqrt(w));
    flash('both');
  };

  return (
    <LabCard
      title="Galilei’s two strings"
      caption="Two strings tuned in unison at 220 Hz. Shorten string II with the bridge, or load its pan over the tail pulley — and hear which handle keeps the legend's promises. Built to the apparatus Galilei describes on p. 145 —"
      sourceHref="/book/dialogo-della-musica-antica-et-della-moderna-galilei?page=145"
      sourceLabel="Vincenzo Galilei, Dialogo (1581)"
    >
      <svg viewBox="0 0 900 340" className="w-full h-auto" role="img"
        aria-label="Two monochord strings over a soundbox: string one is a fixed reference, string two has a movable bridge and a weight hanging over a pulley at its tail.">
        <rect x="40" y="46" width="800" height="210" rx="6" fill="none" stroke="#78716c" strokeWidth="1.5" />
        <circle cx="330" cy="152" r="24" fill="none" stroke="#a8a29e" strokeWidth="0.8" />
        <circle cx="330" cy="152" r="15" fill="none" stroke="#a8a29e" strokeWidth="0.8" />
        <rect x="66" y="80" width="8" height="30" fill={BRASS} />
        <rect x="66" y="190" width="8" height="30" fill={BRASS} />
        <rect x="806" y="80" width="8" height="30" fill={BRASS} />
        <line
          x1="74" y1="95" x2="806" y2="95"
          stroke={ringI ? RUST : '#44403c'} strokeWidth={ringI ? 2.6 : 2}
          className="cursor-pointer" onClick={playI}
        >
          <title>Pluck string I — the whole string, 220 Hz</title>
        </line>
        <text x="74" y="78" fontSize="12" fill="#78716c" fontFamily="monospace">I · THE WHOLE STRING · 220 HZ</text>
        <line
          x1="74" y1="205" x2={bridgeX} y2="205"
          stroke={ringII ? RUST : '#44403c'} strokeWidth={ringII ? 2.6 : 2}
          className="cursor-pointer" onClick={playII}
        >
          <title>Pluck string II</title>
        </line>
        <line x1={bridgeX} y1="205" x2="806" y2="205" stroke="#a8a29e" strokeWidth="1.2" strokeDasharray="4 5" />
        <polygon points={`${bridgeX},200 ${bridgeX - 10},220 ${bridgeX + 10},220`} fill={BRASS} />
        <text x="74" y="188" fontSize="12" fill="#78716c" fontFamily="monospace">II · BRIDGE + WEIGHT</text>
        <circle cx="850" cy="205" r="13" fill="none" stroke="#44403c" strokeWidth="1.5" />
        <line x1="806" y1="205" x2="850" y2="192" stroke="#44403c" strokeWidth="1.1" />
        <line x1="863" y1="205" x2="863" y2="264" stroke="#44403c" strokeWidth="1.1" />
        <rect x="845" y="264" width="36" height={panH} fill="none" stroke={RUST} strokeWidth="1.5" />
        <text x="864" y={panLabelY} fontSize="13" fill={RUST} fontFamily="monospace" textAnchor="middle">{wgtLabel}×</text>
      </svg>

      <div className="grid md:grid-cols-2 gap-x-7 gap-y-4 mt-4">
        <label className="block">
          <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
            <span>The bridge — sounding length of string II</span>
            <span className="font-mono text-primary">{lenPct}%</span>
          </span>
          <input
            type="range" min={0.5} max={1} step={0.001} value={len}
            onChange={(e) => setLen(Number(e.target.value))}
            className="w-full accent-[var(--accent-rust,#a8503c)]"
            aria-label="Sounding length of string II as a fraction of string I"
          />
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
            <span>The pan — weight hung on string II</span>
            <span className="font-mono text-primary">{wgtLabel}×</span>
          </span>
          <input
            type="range" min={1} max={5} step={0.01} value={wgt}
            onChange={(e) => setWgt(Number(e.target.value))}
            className="w-full accent-[var(--accent-rust,#a8503c)]"
            aria-label="Weight hung on string II as a multiple of string I's tension"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip onClick={playI}>▶ String I</Chip>
        <Chip onClick={playII}>▶ String II</Chip>
        <Chip onClick={playBoth}>▶ Both together</Chip>
      </div>

      <p className="text-xs text-muted mt-4 mb-1.5">His presets, in his words — deprive string II of:</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip onClick={() => preset(0.5, 1)}>“half” — the Diapason</Chip>
        <Chip onClick={() => preset(2 / 3, 1)}>“a third part” — the Diapente</Chip>
        <Chip onClick={() => preset(0.75, 1)}>“a fourth” — the Diatessaron</Chip>
        <Chip onClick={() => preset(8 / 9, 1)}>“a ninth” — the Tone</Chip>
      </div>
      <p className="text-xs text-muted mt-3 mb-1.5">…or leave the bridge alone and load the pan instead:</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip onClick={() => preset(1, 2)}>the legend’s octave — 2× weight</Chip>
        <Chip onClick={() => preset(1, 4)}>the octave the bench demands — 4× weight</Chip>
        <Chip onClick={() => preset(1, 2.25)}>9 : 4 in the pan — a pure fifth</Chip>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Readout label="String II" value={`${freq.toFixed(1)} Hz`} note="string I stays 220.0 Hz" />
        <Readout label="Interval" value={`${centsUp} ¢`} note={verdict.pure ? `✓ ${verdict.label}` : verdict.label} />
        <Readout label="The law" value="f ∝ (1/L)·√W" note={`L ${len.toFixed(2)} · W ${wgtLabel}`} />
      </div>
    </LabCard>
  );
}
