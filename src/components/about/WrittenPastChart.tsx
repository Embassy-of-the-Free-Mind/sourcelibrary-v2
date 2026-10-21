'use client';

import { useEffect, useRef, useState } from 'react';
import { WRITTEN_PAST_ROWS, WRITTEN_PAST_STEPS } from '@/lib/written-past-data';

/**
 * A bar chart whose scale keeps growing. Step 1 is Dutch print alone; each
 * later step adds bigger bodies of writing, and every earlier bar shrinks as
 * the axis stretches. Translated = solid sliver in the row's hue, untranslated
 * = a tint of it, estimates in other units = hatched. Autoplays while on screen
 * (never under reduced motion); clicking a step jumps to it.
 */

const STEP_MS = 5500;
// Each row has its own hue (written-past-data.ts): solid for what is
// translated, a tint of the same hue for what is not. The palette passed the
// dataviz validator (lightness band, adjacent CVD and contrast) on cream; rows
// are named on the left, so colour is never the only label. The legend and the
// step progress bars stay neutral / rust. Colour only marks, never text.
const RUST = '#9e4a3a';
const INK = '#57534e';
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const fmt = (n: number) => n.toLocaleString('en-GB');
const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : fmt(n));
const GRID = 'grid grid-cols-[5.75rem_minmax(0,1fr)_auto] sm:grid-cols-[7.5rem_minmax(0,1fr)_8.5rem] items-center gap-x-3';

export default function WrittenPastChart() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const onScreen = useRef(false);
  const reduced = useRef(false);

  // Start playing when the chart scrolls into view; pause when it leaves.
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen.current = e.isIntersecting;
        if (!e.isIntersecting) setPlaying(false);
        else if (!reduced.current) setPlaying((p) => p || step < WRITTEN_PAST_STEPS.length - 1);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let t = progress * STEP_MS;
    const tick = (now: number) => {
      t += Math.min(120, now - last);
      last = now;
      if (t >= STEP_MS) {
        if (step < WRITTEN_PAST_STEPS.length - 1) {
          setStep(step + 1);
          setProgress(0);
        } else {
          setProgress(1);
          setPlaying(false);
        }
        return;
      }
      setProgress(t / STEP_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, step]);

  const go = (i: number) => {
    setStep(i);
    setProgress(0);
    if (!reduced.current) setPlaying(true);
  };
  const togglePlay = () => {
    if (!playing && step === WRITTEN_PAST_STEPS.length - 1 && progress >= 1) {
      setStep(0);
      setProgress(0);
    }
    setPlaying(!playing);
  };

  const shown = WRITTEN_PAST_ROWS.filter((r) => r.step <= step);
  // At the last step China joins: India shrinks to 72% of the track and the
  // Chinese bar runs the full width and off the end, since it is larger and uncounted.
  const max = step >= 4 ? 10000000 / 0.72 : Math.max(...shown.map((r) => r.n));
  const solo = step === 0;
  const axisMax = step >= 4 ? 'beyond any count →' : `${fmt(max)} ${step >= 2 ? 'manuscripts' : 'works'}`;

  return (
    <div ref={rootRef} className="written-past">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted mb-4">
        <span className="inline-flex items-center gap-2">
          <i className="inline-block w-3.5 h-3.5" style={{ background: INK }} />
          translated into English
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block w-3.5 h-3.5" style={{ background: tint(INK, 22) }} />
          no English translation
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block w-3.5 h-3.5 wp-hatch border" style={{ ['--c' as string]: INK, borderColor: tint(INK, 35) }} />
          estimate, counted in other units
        </span>
      </div>

      <div className="flex items-stretch gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="shrink-0 w-11 border border-border-medium bg-cream hover:bg-[var(--bg-warm)] flex items-center justify-center text-primary transition-colors"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1l10 6-10 6z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="grid grid-cols-5 gap-2 flex-1">
          {WRITTEN_PAST_STEPS.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => go(i)}
              aria-pressed={i === step}
              className={`relative text-left px-1.5 sm:px-2.5 py-2 border transition-colors overflow-hidden ${i === step ? 'border-primary text-primary' : 'border-border-medium text-muted hover:text-primary'}`}
            >
              <span className="block text-[11px] tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <span className="block text-[11px] sm:text-sm font-medium tracking-tight sm:tracking-normal">{s.name}</span>
              <i
                className="absolute left-0 bottom-0 h-[3px]"
                style={{ background: RUST, width: i < step ? '100%' : i === step ? `${progress * 100}%` : '0%' }}
              />
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 mb-5 text-base md:text-lg text-primary leading-snug min-h-[4.2em] sm:min-h-[2.8em]" aria-live="polite">
        {WRITTEN_PAST_STEPS[step].caption}
      </p>

      <div className={`${GRID} text-xs text-muted pb-2 mb-2 border-b border-border-light`}>
        <span />
        <span className="text-right font-semibold text-secondary tabular-nums">{axisMax}</span>
        <span className="text-right">size · translated</span>
      </div>

      <div>
        {WRITTEN_PAST_ROWS.map((r) => {
          const on = r.step <= step;
          const w = on ? (r.open ? 100 : (r.n / max) * 100) : 0;
          const t = on && r.translated != null ? Math.max(0.15, (r.translated / max) * 100) : 0;
          const pct = r.translated != null ? ((r.translated / r.n) * 100).toFixed(2) : null;
          const c = r.color ?? RUST;
          const size = r.open ? 'likely largest' : r.none ? 'no estimate' : r.estimate ? `${compact(r.n)} mss.` : fmt(r.n);
          return (
            <div
              key={r.key}
              className={`wp-row ${GRID} overflow-hidden`}
              style={{ height: on ? (solo ? 64 : 28) : 0, opacity: on ? 1 : 0 }}
              aria-hidden={!on}
              title={r.unit}
            >
              <span className={`truncate ${r.highlight ? 'font-semibold text-primary' : 'text-secondary'} ${solo ? 'text-xl' : 'text-sm'}`}>
                {r.name}
              </span>
              <div className="relative" style={{ height: solo ? 36 : 12 }}>
                {r.none ? (
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 truncate text-[13px] leading-4 text-muted">{r.unit}</div>
                ) : (
                  <>
                    <div
                      className={`wp-bar absolute left-0 top-0 h-full ${r.estimate || r.open ? 'wp-hatch border' : ''} ${r.open ? 'wp-open' : ''}`}
                      style={{
                        ['--c' as string]: c,
                        width: `${w}%`,
                        minWidth: on ? 2 : 0,
                        background: r.estimate || r.open ? undefined : tint(c, 24),
                        borderColor: tint(c, 45),
                      }}
                    />
                    {r.translated != null && (
                      <div className="wp-bar absolute left-0 top-0 h-full" style={{ width: `${t}%`, minWidth: on ? 2 : 0, background: c }} />
                    )}
                  </>
                )}
              </div>
              <span className={`text-right tabular-nums whitespace-nowrap text-muted ${solo ? 'text-base' : 'text-[13px]'}`}>
                <span className="text-primary">{size}</span>
                {pct && (
                  <>
                    {' · '}
                    <b className="font-semibold text-primary">{pct}%</b>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <style>{`
        .written-past .wp-row { transition: height .6s ease, opacity .5s ease; }
        .written-past .wp-bar { transition: width 1.1s cubic-bezier(.2,.7,.2,1); }
        .written-past .wp-hatch { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 30%, transparent) 0 5px, color-mix(in srgb, var(--c) 7%, transparent) 5px 10px); }
        .written-past .wp-open { -webkit-mask-image: linear-gradient(90deg, #000 82%, transparent); mask-image: linear-gradient(90deg, #000 82%, transparent); }
        @media (prefers-reduced-motion: reduce) {
          .written-past .wp-row, .written-past .wp-bar { transition: none; }
        }
      `}</style>
    </div>
  );
}
