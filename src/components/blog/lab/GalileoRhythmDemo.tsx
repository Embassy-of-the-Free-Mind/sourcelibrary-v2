'use client';

import { useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const RATIOS = [
  { a: 1, b: 2, name: 'an octave' },
  { a: 2, b: 3, name: 'a perfect fifth' },
  { a: 3, b: 4, name: 'a perfect fourth' },
  { a: 4, b: 5, name: 'a major third' },
];

/**
 * Station VI — Galileo's continuum: rhythm sped up until it is pitch.
 *
 * The Discorsi (First Day) grounds consonance in coincidence: two strings
 * are concordant when their pulses strike the ear in a commensurable
 * pattern. If that is true, a consonance is nothing but a rhythm too fast
 * to count — so one tempo knob should carry a 2-against-3 drum pattern all
 * the way up into a sounding fifth. It does. Both voices here are the SAME
 * oscillator patch (a click train) from 2 clicks per second to 300.
 */
export default function GalileoRhythmDemo() {
  const [playing, setPlaying] = useState(false);
  const [ratioIdx, setRatioIdx] = useState(1);
  const [speed, setSpeed] = useState(0); // 0..1 → base rate 1..100 /s (log)

  const engineRef = useRef<ToneEngine | null>(null);

  const ratio = RATIOS[ratioIdx];
  const base = Math.pow(10, 2 * speed); // 1..100
  const rateA = ratio.a * base;
  const rateB = ratio.b * base;
  const regime = base < 8 ? 'rhythm' : base < 30 ? 'flutter' : 'tone';

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !playing) return;
    e.setVoice('trainA', rateA, 0.5, 'pulse');
    e.setVoice('trainB', rateB, 0.5, 'pulse');
  }, [playing, rateA, rateB]);

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
      title="Station VI — Speed up the rhythm"
      headerRight={<PlayToggle playing={playing} onClick={toggle} label="Play both pulses" />}
      caption="Two click trains in a fixed whole-number ratio, one speed knob. Start slow enough to count the cross-rhythm, then drag right: nothing changes but the rate, and the pattern becomes an interval. Both voices are one and the same instrument throughout."
      sourceHref="/book/discorsi-e-dimostrazioni-matematiche-intorno-a-due-nuove-galilei"
      sourceLabel="Galileo, Discorsi e dimostrazioni matematiche intorno a due nuove scienze (1638)"
    >
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {RATIOS.map((r, i) => (
          <Chip key={r.name} active={ratioIdx === i} onClick={() => setRatioIdx(i)}>
            {r.a}:{r.b} — {r.name}
          </Chip>
        ))}
      </div>

      <div className="mb-4">
        <label className="text-[11px] uppercase tracking-wider text-muted block mb-1">
          Speed — the only thing this slider changes
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={speed}
          onChange={(ev) => setSpeed(Number(ev.target.value))}
          className="w-full accent-accent-rust"
          aria-label="Pulse speed"
        />
        <div className="flex justify-between text-[10px] text-muted">
          <span>countable</span>
          <span>too fast to count</span>
          <span>a chord</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Readout label="Lower voice" value={`${rateA.toFixed(rateA < 10 ? 1 : 0)} /s`} note={regime === 'tone' ? `= ${rateA.toFixed(0)} Hz` : 'pulses per second'} />
        <Readout label="Upper voice" value={`${rateB.toFixed(rateB < 10 ? 1 : 0)} /s`} note={regime === 'tone' ? `= ${rateB.toFixed(0)} Hz` : 'pulses per second'} />
        <Readout
          label="Your ear hears"
          value={regime === 'rhythm' ? `${ratio.a} against ${ratio.b}` : regime === 'flutter' ? 'a flutter' : ratio.name}
          note={regime === 'rhythm' ? 'count it' : regime === 'flutter' ? 'the seam between senses' : 'rhythm, too fast to count'}
        />
      </div>
    </LabCard>
  );
}
