'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Interactive consonance/dissonance demonstration for research notes.
 *
 * Two sine oscillators: one slider sets the base frequency, the other sweeps
 * the second tone across an octave in cents. Readers hear the beats slow and
 * lock as the interval approaches a simple ratio, and see the live frequency
 * numbers, the ratio, and the beat rate — an empirical test of the claim
 * (Galileo, 1638; Helmholtz, 1863) that consonance is pulses falling into
 * step at the eardrum.
 *
 * House rule for empirical demos: always anchor to a specific source — pass
 * `sourceHref`/`sourceLabel` so the demo gestures at the passage it tests,
 * the way quotes link to their page scans.
 *
 * Audio starts only on the user's Play tap (Web Audio requires a gesture);
 * gains ramp to avoid clicks; everything is torn down on stop/unmount.
 */

interface Preset {
  label: string;
  cents: number;
  ratio?: string;
}

const PRESETS: Preset[] = [
  { label: 'Unison 1:1', cents: 0, ratio: '1:1' },
  { label: 'Minor second 16:15', cents: 112, ratio: '16:15' },
  { label: 'Major third 5:4', cents: 386, ratio: '5:4' },
  { label: 'Fourth 4:3', cents: 498, ratio: '4:3' },
  { label: 'Tritone', cents: 600 },
  { label: 'Fifth 3:2', cents: 702, ratio: '3:2' },
  { label: 'Octave 2:1', cents: 1200, ratio: '2:1' },
];

// Simple ratios for the live readout, with their just-intonation cents.
const NAMED_RATIOS: Array<{ cents: number; name: string; ratio: string }> = [
  { cents: 0, name: 'unison', ratio: '1:1' },
  { cents: 112, name: 'minor second', ratio: '16:15' },
  { cents: 204, name: 'major second', ratio: '9:8' },
  { cents: 316, name: 'minor third', ratio: '6:5' },
  { cents: 386, name: 'major third', ratio: '5:4' },
  { cents: 498, name: 'perfect fourth', ratio: '4:3' },
  { cents: 590, name: 'tritone', ratio: '45:32' },
  { cents: 702, name: 'perfect fifth', ratio: '3:2' },
  { cents: 814, name: 'minor sixth', ratio: '8:5' },
  { cents: 884, name: 'major sixth', ratio: '5:3' },
  { cents: 996, name: 'minor seventh', ratio: '16:9' },
  { cents: 1088, name: 'major seventh', ratio: '15:8' },
  { cents: 1200, name: 'octave', ratio: '2:1' },
];

function nearestNamed(cents: number): { name: string; ratio: string } | null {
  let best: (typeof NAMED_RATIOS)[number] | null = null;
  let bestDist = Infinity;
  for (const n of NAMED_RATIOS) {
    const d = Math.abs(n.cents - cents);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best && bestDist <= 8 ? { name: best.name, ratio: best.ratio } : null;
}

interface DissonanceDemoProps {
  title?: string;
  caption?: string;
  sourceHref?: string;
  sourceLabel?: string;
}

export default function DissonanceDemo({
  title = 'Hear it yourself',
  caption,
  sourceHref,
  sourceLabel,
}: DissonanceDemoProps) {
  const [playing, setPlaying] = useState(false);
  const [baseFreq, setBaseFreq] = useState(220);
  const [cents, setCents] = useState(702); // start on the fifth

  const ctxRef = useRef<AudioContext | null>(null);
  const osc1Ref = useRef<OscillatorNode | null>(null);
  const osc2Ref = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const freq2 = baseFreq * Math.pow(2, cents / 1200);
  const beat = Math.abs(freq2 - baseFreq);
  const named = nearestNamed(cents);

  // Keep oscillator frequencies in sync with the sliders while playing.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !osc1Ref.current || !osc2Ref.current) return;
    const t = ctx.currentTime;
    osc1Ref.current.frequency.setTargetAtTime(baseFreq, t, 0.02);
    osc2Ref.current.frequency.setTargetAtTime(freq2, t, 0.02);
  }, [baseFreq, freq2]);

  // Full teardown on unmount.
  useEffect(() => () => { stopAudio(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startAudio() {
    if (ctxRef.current) { void ctxRef.current.resume(); setPlaying(true); return; }
    const Ctx: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);

    const mk = (f: number) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5; // two tones summed — keep headroom
      o.connect(g);
      g.connect(gain);
      o.start();
      return o;
    };
    osc1Ref.current = mk(baseFreq);
    osc2Ref.current = mk(freq2);
    gainRef.current = gain;
    ctxRef.current = ctx;
    gain.gain.setTargetAtTime(0.18, ctx.currentTime, 0.03);
    setPlaying(true);
  }

  function pauseAudio() {
    const ctx = ctxRef.current;
    if (ctx && gainRef.current) {
      gainRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      window.setTimeout(() => { void ctxRef.current?.suspend(); }, 120);
    }
    setPlaying(false);
  }

  function stopAudio() {
    try {
      osc1Ref.current?.stop();
      osc2Ref.current?.stop();
      void ctxRef.current?.close();
    } catch { /* already stopped */ }
    osc1Ref.current = null;
    osc2Ref.current = null;
    gainRef.current = null;
    ctxRef.current = null;
  }

  return (
    <figure className="my-12 not-prose">
      <div className="rounded-lg border border-border-light bg-white/70 p-5 md:p-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <p className="font-serif text-lg text-primary">{title}</p>
          <button
            onClick={playing ? pauseAudio : startAudio}
            className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              playing
                ? 'bg-stone-900 text-white hover:bg-stone-700'
                : 'bg-accent-rust text-white hover:opacity-90'
            }`}
            aria-pressed={playing}
          >
            {playing ? (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg> Pause</>
            ) : (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5z" /></svg> Play both tones</>
            )}
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
              <span>First tone</span>
              <span className="font-mono text-primary">{baseFreq.toFixed(1)} Hz</span>
            </span>
            <input
              type="range"
              min={110}
              max={440}
              step={0.5}
              value={baseFreq}
              onChange={(e) => setBaseFreq(Number(e.target.value))}
              className="w-full accent-[var(--accent-rust,#a8503c)]"
              aria-label="First tone frequency in hertz"
            />
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
              <span>Second tone — slide it across the octave</span>
              <span className="font-mono text-primary">{freq2.toFixed(1)} Hz</span>
            </span>
            <input
              type="range"
              min={0}
              max={1200}
              step={1}
              value={cents}
              onChange={(e) => setCents(Number(e.target.value))}
              className="w-full accent-[var(--accent-rust,#a8503c)]"
              aria-label="Interval of the second tone above the first, in cents"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded border border-border-light bg-cream px-2 py-2">
            <p className="text-[11px] uppercase tracking-wider text-muted">Ratio</p>
            <p className="font-mono text-sm text-primary mt-0.5">{(freq2 / baseFreq).toFixed(3)}</p>
            <p className="text-xs text-muted h-4">{named ? `≈ ${named.ratio} · ${named.name}` : ' '}</p>
          </div>
          <div className="rounded border border-border-light bg-cream px-2 py-2">
            <p className="text-[11px] uppercase tracking-wider text-muted">Interval</p>
            <p className="font-mono text-sm text-primary mt-0.5">{cents} ¢</p>
            <p className="text-xs text-muted h-4">cents above the first tone</p>
          </div>
          <div className="rounded border border-border-light bg-cream px-2 py-2">
            <p className="text-[11px] uppercase tracking-wider text-muted">Beats</p>
            <p className="font-mono text-sm text-primary mt-0.5">{beat.toFixed(1)} Hz</p>
            <p className="text-xs text-muted h-4">difference of the two tones</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setCents(p.cents)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                cents === p.cents
                  ? 'border-accent-rust text-accent-rust bg-accent-rust/5'
                  : 'border-border-light text-muted hover:text-secondary hover:border-stone-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {(caption || sourceHref) && (
        <figcaption className="text-sm text-muted mt-2 not-italic">
          {caption}
          {caption && sourceHref && ' '}
          {sourceHref && (
            <Link href={sourceHref} className="text-accent-rust hover:text-accent-rust underline">
              {sourceLabel || 'Read the source'}
            </Link>
          )}
        </figcaption>
      )}
    </figure>
  );
}
