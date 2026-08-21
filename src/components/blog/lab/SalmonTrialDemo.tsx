'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, Readout } from './LabCard';

const JUST = { third: 1200 * Math.log2(5 / 4), fifth: 1200 * Math.log2(3 / 2), sixth: 1200 * Math.log2(5 / 3) };

interface TrialSpec {
  name: string;
  root: number;
  justCents: number[];
  equalCents: number[];
  gapNote: string;
}

const TRIALS: TrialSpec[] = [
  { name: 'Major third', root: 262, justCents: [0, JUST.third], equalCents: [0, 400], gapNote: '14 ¢ apart' },
  { name: 'Perfect fifth', root: 220, justCents: [0, JUST.fifth], equalCents: [0, 700], gapNote: '2 ¢ apart' },
  { name: 'Major triad', root: 262, justCents: [0, JUST.third, JUST.fifth], equalCents: [0, 400, 700], gapNote: 'thirds carry it' },
  { name: 'Major sixth', root: 247, justCents: [0, JUST.sixth], equalCents: [0, 900], gapNote: '16 ¢ apart' },
  { name: 'Major triad, higher', root: 330, justCents: [0, JUST.third, JUST.fifth], equalCents: [0, 400, 700], gapNote: 'thirds carry it' },
];

/**
 * Station IV — Salmon's trial, re-run.
 *
 * Thomas Salmon spent thirty years arguing music should be performed in the
 * pure mathematical proportions; the campaign that began with his Essay
 * (1672) ended in 1705 with just-fretted viols played before the Royal
 * Society for judgment by ear. Same experiment, your ears: each round plays
 * the same interval twice — once just, once equal-tempered, order random —
 * and you pick the sweeter. Euler later reduced 'sweetness' to a formula;
 * here you generate the data.
 */
export default function SalmonTrialDemo() {
  const [i, setI] = useState<number | null>(null);
  const [order, setOrder] = useState<boolean[]>([]); // per trial: true = A is just
  const [busy, setBusy] = useState<'A' | 'B' | null>(null);
  const [picks, setPicks] = useState<Array<'A' | 'B'>>([]);

  const engineRef = useRef<ToneEngine | null>(null);
  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const start = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    setOrder(TRIALS.map(() => Math.random() < 0.5));
    setPicks([]);
    setI(0);
  };

  const play = async (which: 'A' | 'B') => {
    if (i === null) return;
    const e = engineRef.current;
    if (!e) return;
    setBusy(which);
    const t = TRIALS[i];
    const isJust = which === 'A' ? order[i] : !order[i];
    const cents = isJust ? t.justCents : t.equalCents;
    const freqs = cents.map((c) => t.root * Math.pow(2, c / 1200));
    await e.playTones(freqs, 1400, 'rich', 0.6);
    setBusy(null);
  };

  const pick = (which: 'A' | 'B') => {
    setPicks((p) => [...p, which]);
    setI((v) => (v === null ? null : v + 1));
  };

  const done = i !== null && i >= TRIALS.length;
  const justPicked = done ? picks.filter((p, idx) => (p === 'A') === order[idx]).length : 0;

  return (
    <LabCard
      title="Station IV — Salmon's trial, at your desk"
      headerRight={
        <button
          onClick={start}
          className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-accent-rust text-white hover:opacity-90"
        >
          {i === null ? 'Begin the trial' : 'Restart'}
        </button>
      }
      caption="Five rounds. In each, A and B are the same interval in two tunings — one pure (just), one equal-tempered — in random order. Play both, pick the sweeter, and see whether your verdict matches the Royal Society's."
      sourceHref="/book/an-essay-to-the-advancement-of-musick-salmon"
      sourceLabel="Thomas Salmon, An Essay to the Advancement of Musick (1672)"
    >
      {i === null && (
        <p className="text-sm text-secondary">
          Fifths differ by only <span className="font-mono">2 ¢</span> between the tunings — thirds by{' '}
          <span className="font-mono">14 ¢</span>. That asymmetry is the whole history of temperament,
          and you can hear it in five rounds.
        </p>
      )}

      {i !== null && !done && (
        <div>
          <p className="text-sm text-muted mb-3">Round {i + 1} of {TRIALS.length} — {TRIALS[i].name}</p>
          <div className="flex gap-2 mb-3">
            {(['A', 'B'] as const).map((w) => (
              <button
                key={w}
                onClick={() => play(w)}
                disabled={busy !== null}
                className="flex-1 py-2.5 rounded bg-stone-900 text-white text-sm hover:bg-stone-700 disabled:opacity-40"
              >
                {busy === w ? 'Playing…' : `Play ${w}`}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(['A', 'B'] as const).map((w) => (
              <button
                key={w}
                onClick={() => pick(w)}
                disabled={busy !== null}
                className="flex-1 py-2 rounded border border-border-light text-sm text-secondary hover:bg-stone-50 disabled:opacity-40"
              >
                {w} is sweeter
              </button>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Readout label="You chose just intonation" value={`${justPicked} of ${TRIALS.length}`} note={justPicked >= 4 ? 'Salmon rests his case' : justPicked <= 1 ? 'the equal-tempered ear' : 'a split verdict'} />
            <Readout label="The 1705 audience" value="just" note="approved by the Society" />
          </div>
          <table className="w-full text-xs text-secondary">
            <thead>
              <tr className="text-muted uppercase tracking-wider text-[10px]">
                <th className="text-left py-1 font-medium">Round</th>
                <th className="text-left py-1 font-medium">Gap</th>
                <th className="text-left py-1 font-medium">Your pick</th>
              </tr>
            </thead>
            <tbody>
              {TRIALS.map((t, idx) => (
                <tr key={idx} className="border-t border-border-light">
                  <td className="py-1">{t.name}</td>
                  <td className="py-1 font-mono">{t.gapNote}</td>
                  <td className="py-1">{(picks[idx] === 'A') === order[idx] ? 'just' : 'equal'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LabCard>
  );
}
