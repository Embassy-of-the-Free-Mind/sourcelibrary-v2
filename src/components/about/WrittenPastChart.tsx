'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { WRITTEN_PAST_ROWS, WRITTEN_PAST_STEPS } from '@/lib/written-past-data';

/**
 * A bar chart whose scale keeps growing. Step 1 is Latin print alone, the language of the Renaissance; each
 * later step adds bigger bodies of writing, and every earlier bar shrinks as
 * the axis stretches. Translated = solid sliver in the row's hue, untranslated
 * = a tint of it, estimates in other units = hatched. Autoplays while on screen
 * (never under reduced motion). Clicking a step jumps to it and stops there;
 * the play button runs it on from wherever you are (from the start once it
 * has reached the end).
 */

const STEP_MS = 5500;
// Each row has its own hue (written-past-data.ts): solid for what is
// translated, a tint of the same hue for what is not. The palette passed the
// dataviz validator (lightness band, adjacent CVD and contrast) on cream; rows
// are named on the left, so colour is never the only label. The legend and the
// step progress bars stay neutral / rust. Colour only marks, never text.
const RUST = '#9e4a3a';
const INK = '#57534e';
// The whole, as fractions of the last step's bar: everything counted (works
// for Europe and Tibet, manuscript estimates for Arabic script and India) takes
// 82%, and China, uncounted, fades out over the rest.
const WHOLE = (() => {
  const counted = WRITTEN_PAST_ROWS.filter((r) => !r.open && !r.none);
  const total = counted.reduce((a, r) => a + r.n, 0);
  const done = counted.reduce((a, r) => a + (r.translated ?? 0), 0);
  const works = counted.filter((r) => !r.estimate).reduce((a, r) => a + r.n, 0);
  const f = 0.82 / total;
  return { done: done * f, rest: (works - done) * f, mss: (total - works) * f };
})();
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const fmt = (n: number) => n.toLocaleString('en-GB');
const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : fmt(n));
const GRID = 'grid grid-cols-[4.75rem_minmax(0,1fr)_4.5rem_3.75rem] sm:grid-cols-[7rem_6.5rem_minmax(0,1fr)_6.5rem_6rem] items-center gap-x-3 sm:gap-x-4';

// Three palettes under review (the /about variant picker):
//   hues   - each row its own hue, untranslated as a pale tint (the original)
//   strong - one colour: untranslated a solid warm grey, translated rust
//   dark   - on the hero's dark ground: unread bars dim, translated lit
export type ChartPalette = 'hues' | 'strong' | 'dark';
const PAL = {
  strong: { done: '#9e4a3a', rest: '#c9bfb2', hatch: '#8a8178' },
  dark: { done: '#f0a58c', rest: '#5c5248', hatch: '#a39889' },
};
const DARK_VARS = {
  '--text-primary': '#f5f1ea',
  '--text-secondary': '#d6d0c6',
  '--text-muted': '#a49b8f',
} as React.CSSProperties;

export default function WrittenPastChart({ palette = 'hues', titleClass }: { palette?: ChartPalette; titleClass?: string }) {
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

  // Picking a step holds it there, so you can read it.
  const last = WRITTEN_PAST_STEPS.length - 1;
  // A `whole` step (the magnifier slide, parked 2026-11-04) plays when picked.
  const go = (i: number) => {
    setStep(i);
    const whole = !!WRITTEN_PAST_STEPS[i].whole;
    setProgress(whole ? 0 : 1);
    setPlaying(whole);
  };

  // The last step: every bar above laid end to end as one whole, with all
  // the translated slivers gathered at its left end. At this scale they are
  // under a pixel wide, so a magnifier slides along the bar from the right
  // and comes to rest over them.
  const lensOn = !!WRITTEN_PAST_STEPS[step].whole;
  const wholeRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = wholeRef.current, lens = lensRef.current, clone = cloneRef.current;
    if (!lensOn || !bar || !lens || !clone) return;
    const W = bar.offsetWidth, H = bar.offsetHeight;
    const R = window.innerWidth < 640 ? 56 : 80;
    const SX = 60, SY = 1.5;
    const ease = (u: number) => 1 - Math.pow(1 - u, 3);
    const k = ease(Math.min(1, progress / 0.7));
    const start = W * 0.8, end = R + 4;
    const cx = start + (end - start) * k; // where the lens sits
    const tx = (WHOLE.done / 2) * W; // the middle of the translated sliver
    const focus = start + (tx - start) * k; // what it shows at its centre
    lens.style.transform = `translate(${cx - R}px, ${H / 2 - R}px)`;
    lens.style.setProperty('--r', `${R}px`);
    clone.style.width = `${W * SX}px`; // laid out wide, not scaled, so the sliver keeps its width
    clone.style.height = `${H}px`;
    clone.style.transformOrigin = '0 0';
    clone.style.transform = `translate(${R - focus * SX}px, ${R - (H / 2) * SY}px) scale(1, ${SY})`;
  }, [lensOn, progress]);
  const toggle = () => {
    if (playing) return setPlaying(false);
    if (step === last && progress >= 1) {
      setStep(0);
      setProgress(0);
    } else if (progress >= 1) {
      setStep(Math.min(last, step + 1));
      setProgress(0);
    }
    setPlaying(true);
  };

  const shown = WRITTEN_PAST_ROWS.filter((r) => r.step <= step);
  // At the last step China joins: India shrinks to 72% of the track and the
  // Chinese bar runs the full width and off the end, since it is larger and uncounted.
  const max = step >= 4 ? 10000000 / 0.72 : Math.max(...shown.map((r) => r.n));
  const solo = step === 0;

  const P = palette === 'hues' ? { done: RUST, rest: tint(RUST, 24), hatch: INK } : PAL[palette];
  const wholeBar = (big: boolean) => (
    <div className="absolute inset-0 flex">
      <i className="block h-full shrink-0" style={{ width: `${WHOLE.done * 100}%`, minWidth: big ? 0 : 1, background: P.done }} />
      <i className="block h-full shrink-0" style={{ width: `${WHOLE.rest * 100}%`, background: P.rest }} />
      <i className="block h-full shrink-0 wp-hatch" style={{ ['--c' as string]: P.hatch, width: `${WHOLE.mss * 100}%` }} />
      <i className="block h-full flex-1 wp-hatch wp-open" style={{ ['--c' as string]: P.hatch }} />
    </div>
  );

  const rowsList = (
    <>
        {WRITTEN_PAST_ROWS.map((r) => {
          const on = r.step <= step;
          const w = on ? (r.open ? 100 : (r.n / max) * 100) : 0;
          const t = on && r.translated != null ? Math.max(0.15, (r.translated / max) * 100) : 0;
          const pct = r.translated != null ? ((r.translated / r.n) * 100).toFixed(2) : null;
          const pal = palette === 'hues' ? null : PAL[palette];
          const c = pal ? pal.done : r.color ?? RUST;
          const hatchC = pal ? pal.hatch : c;
          const restBg = pal ? pal.rest : tint(c, 24);
          const edge = pal ? (palette === 'dark' ? '#6b6157' : '#a59b8e') : tint(c, 45);
          // How many: works for printed Europe and Tibet, surviving manuscripts
          // (estimated, hatched) for Arabic script and India, nothing where nobody has counted.
          const size = r.open || r.none ? 'not counted' : r.estimate ? compact(r.n) : fmt(r.n);
          return (
            <div
              key={r.key}
              data-t={r.translated != null ? '' : undefined}
              className={`wp-row ${GRID} overflow-hidden`}
              style={{ height: on && !lensOn ? (solo ? 64 : 28) : 0, opacity: on && !lensOn ? 1 : 0 }}
              aria-hidden={!on}
              title={r.unit}
            >
              <span className={`truncate ${r.highlight ? 'font-semibold text-primary' : 'text-secondary'} ${solo ? 'text-xl' : 'text-sm'}`}>
                {r.name}
              </span>
              <span className={`hidden sm:block truncate text-muted tabular-nums ${solo ? 'text-base' : 'text-[13px]'}`}>{r.dates}</span>
              <div className="wp-track relative" style={{ height: solo ? 36 : 12 }}>
                {r.none ? (
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 truncate text-[13px] leading-4 text-muted">{r.unit}</div>
                ) : (
                  <>
                    <div
                      className={`wp-bar absolute left-0 top-0 h-full ${r.estimate || r.open ? 'wp-hatch border' : ''} ${r.open ? 'wp-open' : ''}`}
                      style={{
                        ['--c' as string]: hatchC,
                        width: `${w}%`,
                        minWidth: on ? 2 : 0,
                        background: r.estimate || r.open ? undefined : restBg,
                        borderColor: edge,
                      }}
                    />
                    {r.translated != null && (
                      <div className="wp-bar absolute left-0 top-0 h-full" style={{ width: `${t}%`, minWidth: on ? (pal ? 3 : 2) : 0, background: c }} />
                    )}
                  </>
                )}
              </div>
              <span className={`text-right tabular-nums whitespace-nowrap text-secondary ${solo ? 'text-lg' : 'text-[12px] sm:text-sm'}`}>{size}</span>
              <span className={`text-right tabular-nums whitespace-nowrap ${solo ? 'text-xl' : 'text-sm sm:text-base'}`}>
                {pct ? <b className="font-semibold text-primary">{pct}%</b> : <span className="text-muted text-[12px] sm:text-sm">{r.none ? '' : 'unknown'}</span>}
              </span>
            </div>
          );
        })}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`written-past wp-${palette} ${palette === 'dark' ? 'bg-[#1a1612] text-[var(--text-primary)] p-6 md:p-12' : ''}`}
      style={palette === 'dark' ? DARK_VARS : undefined}
    >
      {titleClass && (
        // Every title sits in the same grid cell, so the heading is always as tall
        // as the longest one and nothing below it moves when the step changes.
        <h2 className={`${titleClass} grid mb-10 md:mb-14`} aria-live="polite">
          {WRITTEN_PAST_STEPS.map((st, i) => (
            <span key={i === step ? `on-${step}` : i} aria-hidden={i !== step} className={`[grid-area:1/1] block ${i === step ? 'wp-title' : 'invisible'}`}>{st.title}</span>
          ))}
        </h2>
      )}
      <div className="flex items-end gap-3 sm:gap-6">
        <div className="flex-1 grid grid-cols-5 gap-2 sm:gap-6" role="tablist" aria-label="Zoom out">
          {WRITTEN_PAST_STEPS.map((st, i) => (
            <button
              key={st.name}
              type="button"
              role="tab"
              onClick={() => go(i)}
              aria-selected={i === step}
              className={`group relative text-left pb-2.5 text-[13px] sm:text-lg font-medium cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 ${i === step ? 'text-primary' : 'text-muted hover:text-primary'}`}
            >
              {st.name}
              <i className="absolute left-0 right-0 bottom-0 h-px bg-border-medium group-hover:h-[2px] group-hover:bg-stone-400" />
              <i
                className="absolute left-0 bottom-0 h-[2px]"
                style={{ background: RUST, width: i < step ? '100%' : i === step ? `${progress * 100}%` : '0%' }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : step === last && progress >= 1 ? 'Play again from Latin' : 'Play'}
          className="shrink-0 mb-1.5 w-9 h-9 rounded-full bg-[#1a1612] text-white hover:bg-black cursor-pointer flex items-center justify-center"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
          ) : step === last && progress >= 1 ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3" /><path d="M2 1.8v2.6h2.6" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
          )}
        </button>
      </div>

      {!titleClass && (
        <p className="mt-6 text-lg md:text-xl text-primary leading-snug min-h-[4.2em] sm:min-h-[2.8em]" aria-live="polite">
          {WRITTEN_PAST_STEPS[step].caption}
        </p>
      )}

      <div style={lensOn ? { display: 'none' } : undefined} className={`${GRID} mt-10 text-xs text-muted pb-2 mb-2 border-b border-border-light`}>
        <span />
        <span className="hidden sm:block">dates</span>
        <span />
        <span className="text-right">counted</span>
        <span className="text-right text-primary font-semibold">in English</span>
      </div>

      {/* Room for every row from the start: new rows grow downwards into it and
          the heading, tabs and legend stay where they are. */}
      <div style={lensOn ? undefined : { minHeight: WRITTEN_PAST_ROWS.length * 28 }}>{rowsList}</div>

      {lensOn && (
        <div className="wp-whole mt-12 mb-6">
          <div className="relative">
            <div ref={wholeRef} className="relative h-10 md:h-14">{wholeBar(false)}</div>
            <div ref={lensRef} aria-hidden="true" className="wp-lens absolute left-0 top-0 pointer-events-none z-10">
              <div className="wp-glass relative overflow-hidden" style={{ background: palette === 'dark' ? '#1a1612' : 'var(--bg-cream, #fdfcf9)' }}>
                <div ref={cloneRef} className="absolute left-0 top-0">{wholeBar(true)}</div>
              </div>
              <i className="wp-handle absolute block" />
            </div>
          </div>
          <p className="mt-16 md:mt-20 text-sm text-muted max-w-2xl">All the bars, end to end. What has been translated into English is the sliver at the far left. The fade is China, still uncounted.</p>
        </div>
      )}

      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-secondary">
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3" style={{ background: palette === 'hues' ? INK : PAL[palette].done }} />translated into English</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3" style={{ background: palette === 'hues' ? tint(INK, 24) : PAL[palette].rest }} />never translated</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block w-3 h-3 wp-hatch border" style={{ ['--c' as string]: palette === 'hues' ? INK : PAL[palette].hatch, borderColor: palette === 'hues' ? tint(INK, 40) : PAL[palette].hatch }} />estimated, in handwritten copies rather than works</span>
      </p>

      <style>{`
        .written-past .wp-title { animation: wpTitle .6s cubic-bezier(.2,.7,.2,1); }
        @keyframes wpTitle { from { opacity: 0; transform: translateY(.25em); } }
        .written-past .wp-lens { animation: wpLens .5s ease; }
        @keyframes wpLens { from { opacity: 0; } }
        .written-past .wp-glass { border-radius: 9999px; width: calc(var(--r, 70px) * 2); height: calc(var(--r, 70px) * 2); box-shadow: 0 0 0 2px var(--text-primary, #1a1612), 0 10px 30px rgba(0,0,0,.18); }
        .written-past .wp-handle { width: calc(var(--r, 70px) * .7); height: 6px; border-radius: 3px; background: var(--text-primary, #1a1612); left: calc(var(--r, 70px) * 1.7); top: calc(var(--r, 70px) * 1.7); transform: rotate(45deg); transform-origin: left center; }
        .written-past.wp-dark .wp-glass { box-shadow: 0 0 0 2px #f5f1ea, 0 10px 30px rgba(0,0,0,.4); }
        .written-past.wp-dark .wp-handle { background: #f5f1ea; }
        .written-past .wp-row { transition: height .6s ease, opacity .5s ease; }
        .written-past .wp-bar { transition: width 1.1s cubic-bezier(.2,.7,.2,1); }
        .written-past .wp-hatch { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) var(--h1, 30%), transparent) 0 5px, color-mix(in srgb, var(--c) var(--h2, 7%), transparent) 5px 10px); }
        .written-past.wp-strong, .written-past.wp-dark { --h1: 60%; --h2: 16%; }
        .written-past.wp-dark .border-border-light { border-color: #3a332c; }
        .written-past.wp-dark .border-border-medium { border-color: #5a5047; }
        .written-past.wp-dark .bg-border-medium { background: #4a4239; }
        .written-past.wp-dark button:hover { background-color: transparent; }
        .written-past.wp-dark .text-primary, .written-past.wp-dark [role=tab]:hover { color: #f5f1ea; }
        .written-past.wp-dark .text-secondary { color: #d6d0c6; }
        .written-past.wp-dark .text-muted { color: #a49b8f; }
        .written-past .wp-open { -webkit-mask-image: linear-gradient(90deg, #000 82%, transparent); mask-image: linear-gradient(90deg, #000 82%, transparent); }
        @media (prefers-reduced-motion: reduce) {
          .written-past .wp-row, .written-past .wp-bar { transition: none; } .written-past .wp-title { animation: none; }
        }
      `}</style>
    </div>
  );
}
