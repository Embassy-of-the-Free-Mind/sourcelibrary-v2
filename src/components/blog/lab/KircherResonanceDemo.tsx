'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Chip, Readout } from './LabCard';

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

// SVG frequency axis: strings sit at their true (log-scaled) pitch positions,
// so the strike marker can land honestly between two tunings.
const F_LO = 185;
const F_HI = 350;
const W = 320;
const fx = (f: number) => 24 + ((Math.log2(f) - Math.log2(F_LO)) / (Math.log2(F_HI) - Math.log2(F_LO))) * (W - 48);

/**
 * Station VIII — Kircher's sympathetic strings.
 *
 * Musurgia Universalis: pluck a string and an untouched string tuned in
 * unison answers, while its mistuned neighbours stay silent. Kircher read
 * this as the natural magic of consonance; the modern reading is resonance.
 * The five drawn strings are resonators (narrow bandpass filters, the
 * physicist's model of a sympathetic string). Every strike feeds ONE tone
 * equally into all five at once; a string only accumulates energy at its
 * own natural frequency, and that response is what the bars report.
 */
export default function KircherResonanceDemo() {
  // `result` is sticky (stays until the next strike); `ringing` drives the
  // string-vibration visual and decays like the sound does.
  const [result, setResult] = useState<{ freq: number; amps: number[] } | null>(null);
  const [ringing, setRinging] = useState(false);

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

    // The struck tone: a pluck that decays in ~1.8 s.
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

    setResult({ freq, amps: STRINGS.map((s) => response(freq, s.freq)) });
    setRinging(true);
    if (decayRef.current !== null) window.clearTimeout(decayRef.current);
    decayRef.current = window.setTimeout(() => setRinging(false), 2400);
  };

  // All derived values precomputed as plain scalars/arrays — nothing below may
  // index or dot into `result` inside conditional JSX (React Compiler hoists
  // member access above guards; two confirmed incidents in this repo).
  const amps = result ? result.amps : STRINGS.map(() => 0);
  const struckX = result ? fx(result.freq) : 0;
  const struckHz = result ? Math.round(result.freq) : 0;
  const struckNote = result ? STRINGS.find((s) => Math.abs(s.freq - result.freq) < 1)?.note ?? null : null;
  const best = amps.indexOf(Math.max(...amps));
  const bestValue = result ? `${STRINGS[best].note} · ${Math.round(amps[best] * 100)}%` : '—';
  const bestNote = result ? (amps[best] > 0.5 ? 'unison — the string answers' : 'no string answers') : ' ';
  const struckValue = result ? `${struckHz} Hz` : '—';
  const struckDesc = result
    ? (struckNote ? `the pitch of string ${struckNote}` : 'between A and B — matches no string')
    : 'strike a tone above';

  return (
    <LabCard
      title="Station VIII — The string that answers"
      headerRight={null}
      caption="Five tuned strings, none of them touched. Each strike sounds one tone (the dashed line) and feeds it equally into all five; the bars show how much each string drinks. Strike a string's own pitch and it answers near 100%, singing on after the strike fades; strike between two tunings and nothing fully answers."
      sourceHref="/book/kircher-musurgia-universalis-vol-ii-1650-kircher"
      sourceLabel="Kircher, Musurgia Universalis, Vol. II (1650)"
    >
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {STRIKES.map((s) => (
          <Chip key={s.label} active={result?.freq === s.freq} onClick={() => strike(s.freq)}>
            {s.label}
          </Chip>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} 190`} className="w-full max-w-[400px] mx-auto block mb-4" role="img"
        aria-label="Five strings on a frequency axis; a dashed marker shows the struck tone, and bars under each string show how strongly it answers">
        {/* frequency axis */}
        <line x1={16} y1={118} x2={W - 16} y2={118} stroke="#d6d3d1" strokeWidth={1} />

        {/* the struck tone */}
        {result && (
          <g>
            <line x1={struckX} y1={4} x2={struckX} y2={118}
              stroke="#a8503c" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={struckX} y={13} textAnchor="middle" fontSize={9} fill="#a8503c">
              ▼ struck · {struckHz} Hz
            </text>
          </g>
        )}

        {/* strings + response bars */}
        {STRINGS.map((s, i) => {
          const x = fx(s.freq);
          const amp = amps[i];
          const bulge = (ringing ? amp : 0) * 13;
          const answering = amp > 0.5;
          return (
            <g key={s.note}>
              <path d={`M ${x} 22 Q ${x + bulge} 70 ${x} 118`} fill="none"
                stroke={answering ? '#a8503c' : '#78716c'} strokeWidth={answering ? 2 : 1.2}
                style={{ transition: 'all 1.8s ease-out' }} />
              <path d={`M ${x} 22 Q ${x - bulge} 70 ${x} 118`} fill="none"
                stroke={answering ? '#a8503c' : '#78716c'} strokeOpacity={0.45} strokeWidth={1}
                style={{ transition: 'all 1.8s ease-out' }} />
              {/* response bar — sticky until the next strike */}
              <rect x={x - 7} y={166 - amp * 36} width={14} height={amp * 36}
                fill={answering ? '#a8503c' : '#a8a29e'}
                style={{ transition: 'all 0.4s ease-out' }} />
              <line x1={x - 10} y1={166} x2={x + 10} y2={166} stroke="#d6d3d1" strokeWidth={1} />
              <text x={x} y={177} textAnchor="middle" fontSize={9}
                fill={answering ? '#a8503c' : '#78716c'}>
                {s.note} · {Math.round(s.freq)}
              </text>
              <text x={x} y={187} textAnchor="middle" fontSize={8} fill="#a8a29e">
                {result ? `${Math.round(amp * 100)}%` : ''}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="grid grid-cols-2 gap-3">
        <Readout label="Struck" value={struckValue} note={struckDesc} />
        <Readout label="Strongest answer" value={bestValue} note={bestNote} />
      </div>
    </LabCard>
  );
}
