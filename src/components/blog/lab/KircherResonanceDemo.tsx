'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Chip } from './LabCard';

/** The five tuned strings of the bank. Spaced whole steps apart or more, so resonance is selective. */
const STRINGS = [
  { note: 'G', freq: 196.0 },
  { note: 'A', freq: 220.0 },
  { note: 'B', freq: 246.94 },
  { note: 'D', freq: 293.66 },
  { note: 'E', freq: 329.63 },
];

const STRIKES = [
  ...STRINGS.map((s) => ({ label: `Strike ${s.note}`, freq: s.freq })),
  { label: 'Strike between A and B', freq: 233.08 },
];

const Q = 55;

/** Amplitude response of a bandpass resonator at driving frequency f — the physics of the sympathetic answer. */
function response(f: number, f0: number): number {
  const x = f / f0 - f0 / f;
  return 1 / Math.sqrt(1 + Q * Q * x * x);
}

/**
 * Station VIII — Kircher's sympathetic strings.
 *
 * Musurgia Universalis: pluck a string and an untouched string tuned in
 * unison answers, while its mistuned neighbours stay silent. Kircher read
 * this as the natural magic of consonance; the modern reading is resonance.
 * Here the untouched strings are resonators (narrow bandpass filters, the
 * physicist's model of a sympathetic string): the struck tone is fed
 * through all five at once, and only the one whose tuning matches rings —
 * and keeps ringing after the strike dies.
 */
export default function KircherResonanceDemo() {
  const [amps, setAmps] = useState<number[]>(STRINGS.map(() => 0));
  const [lastStrike, setLastStrike] = useState<number | null>(null);

  const engineRef = useRef<ToneEngine | null>(null);
  const bankRef = useRef<BiquadFilterNode[] | null>(null);
  const decayRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (decayRef.current !== null) window.clearTimeout(decayRef.current);
    engineRef.current?.dispose();
  }, []);

  const ensureBank = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    const ctx = engineRef.current.ensure();
    const out = engineRef.current.output;
    if (!ctx || !out) return null;
    if (!bankRef.current) {
      bankRef.current = STRINGS.map((s) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = s.freq;
        bp.Q.value = Q;
        const g = ctx.createGain();
        g.gain.value = 3.5; // a narrow bandpass attenuates heavily; make the answer audible
        bp.connect(g);
        g.connect(out);
        return bp;
      });
    }
    return ctx;
  };

  const strike = (freq: number) => {
    const ctx = ensureBank();
    const e = engineRef.current;
    const out = e?.output;
    if (!ctx || !e || !out || !bankRef.current) return;

    // The struck string: a plucked tone that decays in ~1.8 s.
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.9, t0 + 0.015);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8);
    osc.connect(env);
    // Dry path (the strike itself, quiet) + the resonator bank (the answer).
    const dry = ctx.createGain();
    dry.gain.value = 0.15;
    env.connect(dry);
    dry.connect(out);
    for (const bp of bankRef.current) env.connect(bp);
    osc.start(t0);
    osc.stop(t0 + 2.0);

    setLastStrike(freq);
    setAmps(STRINGS.map((s) => response(freq, s.freq)));
    if (decayRef.current !== null) window.clearTimeout(decayRef.current);
    decayRef.current = window.setTimeout(() => setAmps(STRINGS.map(() => 0)), 2600);
  };

  return (
    <LabCard
      title="Station VIII — The string that answers"
      headerRight={null}
      caption="Five tuned strings, none of them touched. Strike a tone: the string in unison with it swells and keeps singing after the strike fades; its neighbours, a tone away, barely stir. Then strike between two tunings and hear the answer refuse to come."
      sourceHref="/book/kircher-musurgia-universalis-vol-ii-1650-kircher"
      sourceLabel="Kircher, Musurgia Universalis, Vol. II (1650)"
    >
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {STRIKES.map((s) => (
          <Chip key={s.label} active={lastStrike === s.freq} onClick={() => strike(s.freq)}>
            {s.label}
          </Chip>
        ))}
      </div>

      <svg viewBox="0 0 300 110" className="w-full max-w-[340px] mx-auto block mb-4" role="img"
        aria-label="Five vertical strings; the one tuned to the struck pitch vibrates most">
        {STRINGS.map((s, i) => {
          const x = 40 + i * 55;
          const a = amps[i] * 16;
          const ringing = a > 1.5;
          return (
            <g key={s.note}>
              <path
                d={`M ${x} 8 Q ${x + a} 55 ${x} 102`}
                fill="none"
                stroke={ringing ? '#a8503c' : '#78716c'}
                strokeWidth={ringing ? 2 : 1.2}
                style={{ transition: 'all 2.2s ease-out' }}
              />
              <path
                d={`M ${x} 8 Q ${x - a} 55 ${x} 102`}
                fill="none"
                stroke={ringing ? '#a8503c' : '#78716c'}
                strokeOpacity={0.45}
                strokeWidth={1}
                style={{ transition: 'all 2.2s ease-out' }}
              />
              <text x={x} y={109} textAnchor="middle" fontSize={8} fill={ringing ? '#a8503c' : '#a8a29e'}>
                {s.note} · {Math.round(s.freq)} Hz
              </text>
            </g>
          );
        })}
      </svg>

      <div className="grid grid-cols-5 gap-2">
        {STRINGS.map((s, i) => (
          <div key={s.note} className="rounded border border-border-light bg-cream px-1 py-1.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted">{s.note} answers</p>
            <p className="font-mono text-xs text-primary">{Math.round(amps[i] * 100)}%</p>
          </div>
        ))}
      </div>
    </LabCard>
  );
}
