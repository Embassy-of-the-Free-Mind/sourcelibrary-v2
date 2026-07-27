'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ToneEngine } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const RATIOS = [
  { a: 1, b: 2, name: 'an octave' },
  { a: 2, b: 3, name: 'a perfect fifth' },
  { a: 3, b: 4, name: 'a perfect fourth' },
  { a: 4, b: 5, name: 'a major third' },
];

const PX_PER_SEC = 130;
const CANVAS_H = 96;

/**
 * Station VI — Galileo's continuum: rhythm sped up until it is pitch.
 *
 * The Discorsi (First Day) grounds consonance in coincidence: two strings
 * are concordant when their pulses strike the ear in a commensurable
 * pattern. If that is true, a consonance is nothing but a rhythm too fast
 * to count — so one tempo knob should carry a 2-against-3 drum pattern all
 * the way up into a sounding fifth. It does. Both voices here are the SAME
 * oscillator patch (a click train) from 2 clicks per second to 300.
 *
 * The pulse-train picture is drawn in the idiom Euler engraved a century
 * later (Tentamen figs. 1–9, Station X) and Kircher's pendulum plate above:
 * two rows of pulses, coincidences marked. When the dots pack tighter than
 * the eye can split, the rows are drawn as solid bands — the visualization
 * failing at exactly the rate the ear stops counting is the point.
 */
export default function GalileoRhythmDemo() {
  const [playing, setPlaying] = useState(false);
  const [ratioIdx, setRatioIdx] = useState(1);
  const [speed, setSpeed] = useState(0); // 0..1 → base rate 1..100 /s (log)

  const engineRef = useRef<ToneEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef(0);
  const startRef = useRef(0);

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

  const render = useCallback((elapsed: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth;
    if (w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(CANVAS_H * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, CANVAS_H);

    const styles = getComputedStyle(canvas);
    const ink = styles.color || '#211c15';
    const rust = getComputedStyle(document.documentElement).getPropertyValue('--accent-rust').trim() || '#9e4a3a';

    // Coincidence columns: both trains strike together every 1/base seconds.
    const coSpacing = PX_PER_SEC / base;
    ctx.strokeStyle = rust;
    ctx.globalAlpha = coSpacing < 4 ? 0.15 : 0.3;
    ctx.lineWidth = 1;
    if (coSpacing >= 2) {
      for (let k = Math.ceil(elapsed * base); ; k++) {
        const x = (k / base - elapsed) * PX_PER_SEC;
        if (x > w) break;
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, CANVAS_H - 8);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const rows: { rate: number; y: number }[] = [
      { rate: rateA, y: CANVAS_H * 0.32 },
      { rate: rateB, y: CANVAS_H * 0.68 },
    ];
    ctx.fillStyle = ink;
    for (const row of rows) {
      const spacing = PX_PER_SEC / row.rate;
      if (spacing < 2.5) {
        // Dots packed beyond the eye's resolution: a solid band — the
        // countable pattern is gone, which is the ear's experience too.
        ctx.globalAlpha = 0.85;
        ctx.fillRect(0, row.y - 2, w, 4);
        ctx.globalAlpha = 1;
      } else {
        const r = Math.min(3.2, spacing * 0.28);
        for (let k = Math.ceil(elapsed * row.rate); ; k++) {
          const x = (k / row.rate - elapsed) * PX_PER_SEC;
          if (x > w) break;
          ctx.beginPath();
          ctx.arc(x, row.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, [rateA, rateB, base]);

  // Animate while playing (dots stream leftward, striking "now" at the left
  // edge); otherwise draw the static pattern — Euler's figure, in effect.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (playing && !reduced) {
      startRef.current = performance.now();
      const loop = (now: number) => {
        render((now - startRef.current) / 1000);
        animRef.current = requestAnimationFrame(loop);
      };
      animRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(animRef.current);
    }
    render(0);
  }, [playing, render]);

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

      <div className="mb-1 rounded border border-border-light bg-cream overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full text-primary"
          style={{ height: CANVAS_H }}
          role="img"
          aria-label={`Two pulse trains at ${ratio.a} against ${ratio.b}; vertical marks show where the pulses coincide`}
        />
      </div>
      <p className="text-[11px] text-muted mb-4">
        The pulses as Euler would later draw them (Station X) — coincidences marked in rust. When
        the dots pack into a solid band, the eye has lost count at the same moment the ear does.
      </p>

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
