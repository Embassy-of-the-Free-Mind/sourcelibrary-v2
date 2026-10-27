'use client';

import { useEffect, useRef, useState } from 'react';
import { WRITTEN_PAST_ROWS, WRITTEN_PAST_STEPS } from '@/lib/written-past-data';

/**
 * A bar chart whose scale keeps growing. Step 1 is Latin print alone, the language of the Renaissance; each
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
const GRID = 'grid grid-cols-[5.25rem_minmax(0,1fr)_5.5rem] sm:grid-cols-[8rem_minmax(0,1fr)_8rem] items-center gap-x-3 sm:gap-x-4';

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

  const shown = WRITTEN_PAST_ROWS.filter((r) => r.step <= step);
  // At the last step China joins: India shrinks to 72% of the track and the
  // Chinese bar runs the full width and off the end, since it is larger and uncounted.
  const max = step >= 4 ? 10000000 / 0.72 : Math.max(...shown.map((r) => r.n));
  const solo = step === 0;

  return (
    <div ref={rootRef} className="written-past">
      <div className="grid grid-cols-5 gap-3 sm:gap-6" role="tablist" aria-label="Zoom out">
        {WRITTEN_PAST_STEPS.map((st, i) => (
          <button
            key={st.name}
            type="button"
            role="tab"
            onClick={() => go(i)}
            aria-selected={i === step}
            className={`relative text-left pb-2.5 text-sm sm:text-lg font-medium transition-colors ${i === step ? 'text-primary' : 'text-muted hover:text-primary'}`}
          >
            {st.name}
            <i className="absolute left-0 right-0 bottom-0 h-px bg-border-medium" />
            <i
              className="absolute left-0 bottom-0 h-[2px]"
              style={{ background: RUST, width: i < step ? '100%' : i === step ? `${progress * 100}%` : '0%' }}
            />
          </button>
        ))}
      </div>

      <p className="mt-6 mb-8 text-lg md:text-xl text-primary leading-snug min-h-[4.2em] sm:min-h-[2.8em]" aria-live="polite">
        {WRITTEN_PAST_STEPS[step].caption}
      </p>

      <div className={`${GRID} text-xs text-muted pb-2 mb-2 border-b border-border-light`}>
        <span />
        <span />
        <span className="text-right text-primary font-semibold">in English</span>
      </div>

      <div>
        {WRITTEN_PAST_ROWS.map((r) => {
          const on = r.step <= step;
          const w = on ? (r.open ? 100 : (r.n / max) * 100) : 0;
          const t = on && r.translated != null ? Math.max(0.15, (r.translated / max) * 100) : 0;
          const pct = r.translated != null ? ((r.translated / r.n) * 100).toFixed(2) : null;
          const c = r.color ?? RUST;
          const size = r.open ? 'not counted' : r.none ? 'not counted' : `${compact(r.n)} mss.`;
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
              <span className={`text-right tabular-nums whitespace-nowrap ${solo ? 'text-xl' : 'text-sm sm:text-base'}`}>
                {pct ? <b className="font-semibold text-primary">{pct}%</b> : <span className="text-muted text-[12px] sm:text-sm">{size}</span>}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-secondary">
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3" style={{ background: INK }} />translated into English</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3" style={{ background: tint(INK, 24) }} />never translated</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3 wp-hatch border" style={{ ['--c' as string]: INK, borderColor: tint(INK, 40) }} />estimated, in manuscripts</span>
      </p>

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
