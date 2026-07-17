'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine, centsBetween } from './audio';
import { LabCard, Chip, Readout } from './LabCard';

const PLUCKED = 220; // the left string, always plucked at A
const TUNE_LO = 196;
const TUNE_HI = 247;
const Q = 55;

/** Amplitude response of a bandpass resonator at driving frequency f — the physics of the sympathetic answer. */
function response(f: number, f0: number): number {
  const x = f / f0 - f0 / f;
  return 1 / Math.sqrt(1 + Q * Q * x * x);
}

const PRESETS = [
  { label: 'G · 196 Hz', freq: 196 },
  { label: 'A · 220 Hz — unison', freq: 220 },
  { label: 'B · 247 Hz', freq: 247 },
];

function verdict(r: number): string {
  if (r > 0.95) return 'unison — it sings back';
  if (r > 0.5) return 'close — it stirs';
  if (r > 0.2) return 'a whisper';
  return 'mistuned — it stays silent';
}

/**
 * Station VIII — Kircher's sympathetic strings, as he staged it: TWO
 * strings. One is plucked; the other is never touched. Only when the
 * untouched string is tuned in unison with the plucked one does it answer
 * (Musurgia Universalis read this as the natural magic of consonance; the
 * modern name is resonance). The untouched string is modeled as a narrow
 * bandpass resonator fed by the pluck; the reader's experiment is to tune
 * it until the answer comes.
 */
export default function KircherResonanceDemo() {
  const [tune, setTune] = useState(247); // start mistuned: the first pluck fails
  // Sticky per pluck; only the vibration visual decays with the sound.
  const [result, setResult] = useState<{ tune: number; resp: number } | null>(null);
  const [ringing, setRinging] = useState(false);

  const engineRef = useRef<ToneEngine | null>(null);
  const bankRef = useRef<BiquadFilterNode | null>(null);
  const decayRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (decayRef.current !== null) window.clearTimeout(decayRef.current);
    engineRef.current?.dispose();
  }, []);

  const pluck = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    const ctx = engineRef.current.ensure();
    const out = engineRef.current.output;
    if (!ctx || !out) return;
    if (!bankRef.current) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = Q;
      const g = ctx.createGain();
      g.gain.value = 3.5; // a narrow bandpass attenuates heavily; make the answer audible
      bp.connect(g);
      g.connect(out);
      bankRef.current = bp;
    }
    bankRef.current.frequency.setValueAtTime(tune, ctx.currentTime);

    // The plucked string: an enveloped tone decaying in ~1.8 s, heard quietly
    // dry, and fed into the untouched string's resonator.
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = PLUCKED;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.9, t0 + 0.015);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8);
    osc.connect(env);
    const dry = ctx.createGain();
    dry.gain.value = 0.15;
    env.connect(dry);
    dry.connect(out);
    env.connect(bankRef.current);
    osc.start(t0);
    osc.stop(t0 + 2.0);

    setResult({ tune, resp: response(PLUCKED, tune) });
    setRinging(true);
    if (decayRef.current !== null) window.clearTimeout(decayRef.current);
    decayRef.current = window.setTimeout(() => setRinging(false), 2400);
  };

  // Precomputed scalars — nothing may dot into `result` inside conditional
  // JSX (React Compiler hoists member access above guards; repo lesson).
  const resp = result ? result.resp : 0;
  const respAtResultTune = resp;
  const offCents = Math.round(centsBetween(PLUCKED, tune));
  const resultOffCents = result ? Math.round(centsBetween(PLUCKED, result.tune)) : 0;
  const leftBulge = ringing ? 14 : 0;
  const rightBulge = (ringing ? respAtResultTune : 0) * 14;
  const answering = respAtResultTune > 0.5;
  const staleTuning = result !== null && Math.abs(result.tune - tune) > 0.25;

  return (
    <LabCard
      title="Station VIII — The string that answers"
      headerRight={
        <button
          onClick={pluck}
          className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-accent-rust text-white hover:opacity-90"
        >
          Pluck the left string
        </button>
      }
      caption="Two strings. The left is plucked, always at A · 220 Hz; the right is never touched. Tune the silent string and pluck again: mistuned, it ignores its neighbour; at unison it swells and sings on after the pluck fades. Find the tuning where the answer comes."
      sourceHref="/book/kircher-musurgia-universalis-vol-ii-1650-kircher"
      sourceLabel="Kircher, Musurgia Universalis, Vol. II (1650)"
    >
      <div className="mb-4">
        <label className="text-[11px] uppercase tracking-wider text-muted block mb-1">
          Tuning of the untouched string — {tune.toFixed(1)} Hz ({offCents === 0 ? 'unison' : `${offCents > 0 ? '+' : ''}${offCents} ¢ from the plucked string`})
        </label>
        <input
          type="range"
          min={TUNE_LO}
          max={TUNE_HI}
          step={0.5}
          value={tune}
          onChange={(ev) => setTune(Number(ev.target.value))}
          className="w-full accent-accent-rust"
          aria-label="Tuning of the untouched string in hertz"
        />
        <div className="flex gap-1.5 mt-2">
          {PRESETS.map((p) => (
            <Chip key={p.freq} active={tune === p.freq} onClick={() => setTune(p.freq)}>{p.label}</Chip>
          ))}
        </div>
      </div>

      <svg viewBox="0 0 300 150" className="w-full max-w-[320px] mx-auto block mb-4" role="img"
        aria-label="Two strings: the plucked one on the left, the untouched one on the right, which vibrates only when tuned in unison">
        <path d={`M 95 10 Q ${95 + leftBulge} 62 95 114`} fill="none" stroke="#57534e"
          strokeWidth={1.6} style={{ transition: 'all 1.8s ease-out' }} />
        <path d={`M 95 10 Q ${95 - leftBulge} 62 95 114`} fill="none" stroke="#57534e"
          strokeOpacity={0.45} strokeWidth={1} style={{ transition: 'all 1.8s ease-out' }} />
        <text x={95} y={128} textAnchor="middle" fontSize={9} fill="#78716c">plucked · 220 Hz</text>

        <path d={`M 205 10 Q ${205 + rightBulge} 62 205 114`} fill="none"
          stroke={answering ? '#a8503c' : '#78716c'} strokeWidth={answering ? 2 : 1.4}
          style={{ transition: 'all 1.8s ease-out' }} />
        <path d={`M 205 10 Q ${205 - rightBulge} 62 205 114`} fill="none"
          stroke={answering ? '#a8503c' : '#78716c'} strokeOpacity={0.45} strokeWidth={1}
          style={{ transition: 'all 1.8s ease-out' }} />
        <text x={205} y={128} textAnchor="middle" fontSize={9}
          fill={answering ? '#a8503c' : '#78716c'}>
          untouched · {tune.toFixed(0)} Hz
        </text>

        {/* the pluck travels as sound; the untouched string decides whether to answer */}
        {ringing && (
          <g>
            <path d="M 112 62 Q 150 48 188 62" fill="none" stroke="#a8a29e" strokeWidth={1} strokeDasharray="3 3" />
            <text x={150} y={44} textAnchor="middle" fontSize={8} fill="#a8a29e">sound</text>
          </g>
        )}

        {/* sticky response meter */}
        <rect x={40} y={142} width={220} height={4} fill="#e7e5e4" rx={2} />
        <rect x={40} y={142} width={220 * respAtResultTune} height={4}
          fill={answering ? '#a8503c' : '#a8a29e'} rx={2}
          style={{ transition: 'width 0.5s ease-out' }} />
      </svg>

      <div className="grid grid-cols-2 gap-3">
        <Readout
          label="Sympathetic response"
          value={result ? `${Math.round(respAtResultTune * 100)}%` : '—'}
          note={result ? verdict(respAtResultTune) : 'pluck to find out'}
        />
        <Readout
          label="Last pluck"
          value={result ? `${resultOffCents === 0 ? 'unison' : `${resultOffCents > 0 ? '+' : ''}${resultOffCents} ¢`}` : '—'}
          note={staleTuning ? 'tuning changed — pluck again' : result ? 'untouched string vs plucked' : ' '}
        />
      </div>
    </LabCard>
  );
}
