'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine, Timbre } from './audio';
import { LabCard, Readout } from './LabCard';

// Pentatonic (gong scale on C) — the note-material of the Record's world.
const N = {
  C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880.0,
};

interface Step { freqs: number[]; ms: number; gap: number; level: number; timbre: Timbre }

/**
 * Each phrase is engineered to ONE of the Yo Kî's six sound-descriptions
 * (Li Ki, Book XVII, opening section) — register, tempo, articulation and
 * timbre follow the text's adjectives, nothing else. The reader's job is
 * to hear which is which.
 */
const AFFECTS: Array<{ affect: string; descriptor: string; steps: Step[] }> = [
  {
    affect: 'sorrow',
    descriptor: 'sharp and fading away',
    steps: [N.A5, N.G5, N.E5, N.D5, N.C5].map((f, i) => ({
      freqs: [f], ms: 300, gap: 240, level: 0.55 - i * 0.08, timbre: 'sine' as Timbre,
    })),
  },
  {
    affect: 'pleasure',
    descriptor: 'slow and gentle',
    steps: [N.C4, N.D4, N.E4, N.G4, N.E4, N.D4, N.C4].map((f) => ({
      freqs: [f], ms: 650, gap: 70, level: 0.32, timbre: 'sine' as Timbre,
    })),
  },
  {
    affect: 'joy',
    descriptor: 'exclamatory and soon disappears',
    steps: [
      { freqs: [N.C4], ms: 160, gap: 20, level: 0.6, timbre: 'rich' as Timbre },
      { freqs: [N.G4], ms: 160, gap: 20, level: 0.62, timbre: 'rich' as Timbre },
      { freqs: [N.C5], ms: 220, gap: 380, level: 0.65, timbre: 'rich' as Timbre },
      { freqs: [N.E4], ms: 160, gap: 20, level: 0.6, timbre: 'rich' as Timbre },
      { freqs: [N.A4], ms: 160, gap: 20, level: 0.62, timbre: 'rich' as Timbre },
      { freqs: [N.E5], ms: 220, gap: 0, level: 0.65, timbre: 'rich' as Timbre },
    ],
  },
  {
    affect: 'anger',
    descriptor: 'coarse and fierce',
    steps: [N.C3, N.G3, N.C3, N.A3, N.D3, N.G3].map((f) => ({
      freqs: [f], ms: 140, gap: 35, level: 0.8, timbre: 'rich' as Timbre,
    })),
  },
  {
    affect: 'reverence',
    descriptor: 'straightforward, with an indication of humility',
    steps: [N.G3, N.G3, N.G3, N.A3, N.G3, N.E3].map((f) => ({
      freqs: [f], ms: 550, gap: 260, level: 0.4, timbre: 'sine' as Timbre,
    })),
  },
  {
    affect: 'love',
    descriptor: 'harmonious and soft',
    steps: [
      { freqs: [N.C4, N.E4], ms: 700, gap: 90, level: 0.42, timbre: 'sine' as Timbre },
      { freqs: [N.G3, N.D4], ms: 700, gap: 90, level: 0.42, timbre: 'sine' as Timbre },
      { freqs: [N.A3, N.E4], ms: 700, gap: 90, level: 0.42, timbre: 'sine' as Timbre },
      { freqs: [N.C4, N.E4, N.G4], ms: 950, gap: 0, level: 0.48, timbre: 'sine' as Timbre },
    ],
  },
];

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Station IX — the Record of Music's six sounds, blind.
 *
 * The Yo Kî claims each state of mind stamps a recognizably different
 * character on sound — and describes all six. If the claim is right, the
 * descriptions should be legible in reverse: hear a phrase built to one
 * description, name the state. Six rounds, one per affect, order random.
 */
export default function YueJiAffectDemo() {
  const [order, setOrder] = useState<number[] | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);

  const engineRef = useRef<ToneEngine | null>(null);
  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const start = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    setOrder(shuffle(AFFECTS.map((_, idx) => idx)));
    setPicks([]);
    setI(0);
  };

  const play = async () => {
    if (order === null || busy) return;
    const e = engineRef.current;
    if (!e) return;
    setBusy(true);
    for (const s of AFFECTS[order[i]].steps) {
      await e.playTones(s.freqs, s.ms, s.timbre, s.level);
      if (s.gap) await sleep(s.gap);
    }
    setBusy(false);
  };

  const pick = (affectIdx: number) => {
    if (busy) return;
    setPicks((p) => [...p, affectIdx]);
    setI((v) => v + 1);
  };

  const done = order !== null && i >= AFFECTS.length;
  const score = done ? picks.filter((p, idx) => p === order[idx]).length : 0;

  return (
    <LabCard
      title="Station IX — Name the state of mind"
      headerRight={
        <button
          onClick={start}
          className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-accent-rust text-white hover:opacity-90"
        >
          {order === null ? 'Begin' : 'Restart'}
        </button>
      }
      caption="Six phrases, each built strictly to one of the Record of Music's six descriptions — register, pace and touch follow the text's adjectives and nothing else. Hear each one blind and name the state of mind. Chance is one in six."
      sourceHref="/book/the-sacred-books-of-china-li-ki-part-2-sbe-vol-28-trans?page=107"
      sourceLabel="Record of Music (Yo Kî), in Legge's Li Ki (1885)"
    >
      {order === null && (
        <p className="text-sm text-secondary">
          The Record lists six: sorrow, pleasure, joy, anger, reverence, love — each with its own
          sound-signature, and none of them, it insists, natural: they are the mark of what has
          moved the mind.
        </p>
      )}

      {order !== null && !done && (
        <div>
          <p className="text-sm text-muted mb-3">Round {i + 1} of {AFFECTS.length}</p>
          <button
            onClick={play}
            disabled={busy}
            className="w-full py-2.5 rounded bg-stone-900 text-white text-sm hover:bg-stone-700 disabled:opacity-40 mb-3"
          >
            {busy ? 'Playing…' : 'Play the phrase'}
          </button>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {AFFECTS.map((a, idx) => (
              <button
                key={a.affect}
                onClick={() => pick(idx)}
                disabled={busy}
                className="py-2 rounded border border-border-light text-sm text-secondary hover:bg-stone-50 disabled:opacity-40 capitalize"
              >
                {a.affect}
              </button>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Readout label="Your score" value={`${score} of ${AFFECTS.length}`} note={score >= 4 ? 'the Record holds up' : score >= 2 ? 'partly legible' : 'chance is 1 in 6'} />
            <Readout label="The Record's claim" value="6 of 6" note="each state has its sound" />
          </div>
          <table className="w-full text-xs text-secondary">
            <thead>
              <tr className="text-muted uppercase tracking-wider text-[10px]">
                <th className="text-left py-1 font-medium">The sound was…</th>
                <th className="text-left py-1 font-medium">The Record says</th>
                <th className="text-left py-1 font-medium">You said</th>
              </tr>
            </thead>
            <tbody>
              {order.map((affectIdx, round) => (
                <tr key={round} className="border-t border-border-light">
                  <td className="py-1 italic">&ldquo;{AFFECTS[affectIdx].descriptor}&rdquo;</td>
                  <td className="py-1 capitalize">{AFFECTS[affectIdx].affect}</td>
                  <td className={`py-1 capitalize ${picks[round] === affectIdx ? 'text-primary' : 'text-muted line-through'}`}>
                    {AFFECTS[picks[round]].affect}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LabCard>
  );
}
