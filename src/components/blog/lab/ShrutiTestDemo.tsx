'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Readout } from './LabCard';

const BASE = 440;
const LADDER = [55, 34, 21, 13, 8, 5]; // cents; 55 ≈ one śruti (22 per octave)

interface Trial {
  delta: number; // 0 = catch trial (identical pair)
  up: boolean;
}

function buildTrials(): Trial[] {
  const trials: Trial[] = [];
  for (const d of LADDER) {
    trials.push({ delta: d, up: Math.random() < 0.5 });
    trials.push({ delta: d, up: Math.random() < 0.5 });
  }
  for (let i = 0; i < 4; i++) trials.push({ delta: 0, up: false });
  // shuffle
  for (let i = trials.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [trials[i], trials[j]] = [trials[j], trials[i]];
  }
  return trials;
}

/**
 * Station III — the two vīṇās (śaraṇa), run on yourself.
 *
 * Bharata's Nāṭyaśāstra demonstrates the 22 śrutis by detuning one vīṇā
 * stepwise against an identical one; the Dattilam defines the śruti as the
 * smallest pitch difference the ear can detect — an explicit, quantitative
 * just-noticeable-difference claim, two millennia before psychophysics had
 * the name. This station measures YOUR śruti: pairs of tones, same or
 * different — the smallest difference you reliably hear is your quantum.
 */
export default function ShrutiTestDemo() {
  const [trials, setTrials] = useState<Trial[] | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ delta: number; correct: boolean }>>([]);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  const engineRef = useRef<ToneEngine | null>(null);
  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const start = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    setTrials(buildTrials());
    setI(0);
    setResults([]);
    setLastFeedback(null);
  };

  const playPair = async (t: Trial) => {
    const e = engineRef.current;
    if (!e) return;
    setBusy(true);
    const f2 = t.delta === 0 ? BASE : BASE * Math.pow(2, ((t.up ? 1 : -1) * t.delta) / 1200);
    await e.playTones([BASE], 550, 'sine');
    await new Promise((r) => window.setTimeout(r, 250));
    await e.playTones([f2], 550, 'sine');
    setBusy(false);
  };

  const answer = (saidDifferent: boolean) => {
    if (!trials) return;
    const t = trials[i];
    const wasDifferent = t.delta !== 0;
    const correct = saidDifferent === wasDifferent;
    setResults((r) => [...r, { delta: t.delta, correct }]);
    setLastFeedback(correct ? '✓' : '✗');
    setI((v) => v + 1);
  };

  const done = trials !== null && i >= trials.length;

  // Smallest delta answered correctly on BOTH of its trials.
  let jnd: number | null = null;
  if (done) {
    for (const d of [...LADDER].sort((a, b) => a - b)) {
      const rs = results.filter((r) => r.delta === d);
      if (rs.length === 2 && rs.every((r) => r.correct)) { jnd = d; break; }
    }
  }
  const catchCorrect = done ? results.filter((r) => r.delta === 0 && r.correct).length : 0;

  return (
    <LabCard
      title="Station III — Measure your śruti"
      headerRight={
        <button
          onClick={start}
          className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-accent-rust text-white hover:opacity-90"
        >
          {trials ? 'Restart' : 'Begin the test'}
        </button>
      }
      caption="Sixteen pairs of tones. Some pairs are identical; some differ by as much as a śruti or as little as 5 cents. Use headphones, answer honestly, and the smallest difference you reliably catch is your own pitch quantum — Bharata's two-vīṇā procedure, run on yourself."
      sourceHref="/book/dattilam-treatise-on-music-dattila?page=24"
      sourceLabel="Dattilam, on the 22 śrutis (1st c. CE)"
    >
      {!trials && (
        <p className="text-sm text-secondary">
          The claim on the bench: the octave holds <span className="font-mono">22</span> distinguishable
          steps — one śruti ≈ <span className="font-mono">55 ¢</span>. Modern ears usually resolve far
          finer. Where do you land?
        </p>
      )}

      {trials && !done && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted">Pair {i + 1} of {trials.length} {lastFeedback && <span className="ml-2 font-mono">{lastFeedback}</span>}</p>
            <button
              onClick={() => playPair(trials[i])}
              disabled={busy}
              className="px-4 py-2 rounded-full text-sm font-medium bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-40"
            >
              {busy ? 'Listen…' : 'Play the pair'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => answer(false)}
              disabled={busy}
              className="flex-1 py-2.5 rounded border border-border-light text-sm text-secondary hover:bg-stone-50 disabled:opacity-40"
            >
              Same
            </button>
            <button
              onClick={() => answer(true)}
              disabled={busy}
              className="flex-1 py-2.5 rounded border border-border-light text-sm text-secondary hover:bg-stone-50 disabled:opacity-40"
            >
              Different
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="grid grid-cols-3 gap-3">
          <Readout
            label="Your śruti"
            value={jnd !== null ? `${jnd} ¢` : '> 55 ¢'}
            note={jnd !== null ? `≈ ${Math.round(1200 / jnd)} steps per octave` : 'try again with headphones'}
          />
          <Readout label="Dattila's claim" value="55 ¢" note="22 per octave" />
          <Readout label="Catch trials" value={`${catchCorrect}/4`} note="identical pairs caught" />
        </div>
      )}
    </LabCard>
  );
}
