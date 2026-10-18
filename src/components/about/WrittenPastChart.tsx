'use client';

import { useEffect, useRef, useState } from 'react';
import { WRITTEN_PAST_ROWS, WRITTEN_PAST_STEPS } from '@/lib/written-past-data';

/**
 * A bar chart whose scale keeps growing. Step 1 is Dutch print alone; each
 * later step adds bigger bodies of writing, and every earlier bar shrinks as
 * the axis stretches. Translated = solid green sliver, untranslated = pale
 * green, estimates in other units = hatched. Autoplays while on screen
 * (never under reduced motion); clicking a step jumps to it.
 */

const STEP_MS = 5500;
const GREEN = '#15803d';
const fmt = (n: number) => n.toLocaleString('en-GB');

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
  const max = Math.max(...shown.map((r) => r.n));
  const solo = step === 0;
  const axisMax = step >= 4 ? 'uncounted →' : `${fmt(max)} ${step >= 2 ? 'manuscripts' : 'works'}`;

  return (
    <div ref={rootRef} className="written-past">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted mb-5">
        <span className="inline-flex items-center gap-2">
          <i className="inline-block w-3.5 h-3.5" style={{ background: GREEN }} />
          translated into English
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block w-3.5 h-3.5" style={{ background: 'rgba(21,128,61,.22)' }} />
          no English translation
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block w-3.5 h-3.5 wp-hatch border" style={{ borderColor: 'rgba(21,128,61,.35)' }} />
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
                style={{ background: GREEN, width: i < step ? '100%' : i === step ? `${progress * 100}%` : '0%' }}
              />
            </button>
          ))}
        </div>
      </div>

      <p className="mt-5 mb-8 text-lg md:text-xl text-primary leading-snug min-h-[3.5em] md:min-h-[2.6em]" aria-live="polite">
        {WRITTEN_PAST_STEPS[step].caption}
      </p>

      <div className="flex justify-between text-xs text-muted pb-2 mb-3 border-b border-border-light">
        <span>0</span>
        <span className="font-semibold text-secondary tabular-nums">{axisMax}</span>
      </div>

      <div>
        {WRITTEN_PAST_ROWS.map((r) => {
          const on = r.step <= step;
          const w = on ? (r.n / max) * 100 : 0;
          const t = on && r.translated != null ? Math.max(0.15, (r.translated / max) * 100) : 0;
          const pct = r.translated != null ? ((r.translated / r.n) * 100).toFixed(2) : null;
          return (
            <div
              key={r.key}
              className="wp-row overflow-hidden"
              style={{
                maxHeight: on ? (solo ? 220 : 90) : 0,
                opacity: on ? 1 : 0,
                marginBottom: on ? (solo ? 0 : 12) : 0,
              }}
              aria-hidden={!on}
            >
              <div className={`flex flex-wrap items-baseline gap-x-2 leading-snug ${solo ? 'mb-3' : 'mb-1'}`}>
                <span className={`${r.highlight ? 'font-semibold text-primary' : 'text-secondary'} ${solo ? 'text-2xl' : 'text-[15px]'}`}>
                  {r.name}
                </span>
                <span className={`text-muted ${solo ? 'text-base' : 'text-[13px]'}`}>
                  {!r.open && !r.none && <b className="font-semibold text-primary tabular-nums">{fmt(r.n)} </b>}
                  {(r.key === 'nl' || r.unit !== WRITTEN_PAST_ROWS[0].unit) && r.unit}
                  {pct && (
                    <>
                      {' · '}
                      <b className="font-semibold text-primary tabular-nums">{pct}%</b> translated
                    </>
                  )}
                </span>
              </div>
              <div className="relative" style={{ height: solo ? 44 : 14 }}>
                {r.none ? (
                  <div className="absolute inset-0 border border-dashed" style={{ borderColor: 'rgba(21,128,61,.4)' }} />
                ) : (
                  <>
                    <div
                      className={`wp-bar absolute left-0 top-0 h-full ${r.estimate || r.open ? 'wp-hatch border' : ''} ${r.open ? 'wp-open' : ''}`}
                      style={{
                        width: `${w}%`,
                        minWidth: on ? 2 : 0,
                        background: r.estimate || r.open ? undefined : r.highlight ? 'rgba(21,128,61,.34)' : 'rgba(21,128,61,.22)',
                        borderColor: 'rgba(21,128,61,.35)',
                      }}
                    />
                    {r.translated != null && (
                      <div className="wp-bar absolute left-0 top-0 h-full" style={{ width: `${t}%`, minWidth: on ? 2 : 0, background: GREEN }} />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .written-past .wp-row { transition: max-height .6s ease, opacity .5s ease, margin .6s ease; }
        .written-past .wp-bar { transition: width 1.1s cubic-bezier(.2,.7,.2,1); }
        .written-past .wp-hatch { background: repeating-linear-gradient(135deg, rgba(21,128,61,.18) 0 5px, rgba(21,128,61,.05) 5px 10px); }
        .written-past .wp-open { -webkit-mask-image: linear-gradient(90deg, #000 75%, transparent); mask-image: linear-gradient(90deg, #000 75%, transparent); }
        @media (prefers-reduced-motion: reduce) {
          .written-past .wp-row, .written-past .wp-bar { transition: none; }
        }
      `}</style>
    </div>
  );
}
