'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * "How translation started the Renaissance" as a scroll story. Short beats of
 * text scroll past a pinned stage; the stage swaps between Cosimo, Ficino and
 * pages of the library's own 1472 Pimander, and the reader's scroll drives a
 * slow camera move inside each picture and lights the Latin words the beat is
 * about. Reduced motion: no camera, every mark shown.
 *
 * Mark boxes are percentages of the image, read off the scans in public/about/.
 */

const PIMANDER = '/book/hermes-trismegistus-pimander-1472-editio-princeps-trans';
const PIMANDER_PREFACE = `${PIMANDER}/page/69b4cc20bb3208142d7bc486`;
const PLOTINUS_TITLE = '/book/plotinus-enneads-xxvii-liv-ficino-translation-translator/page/69b43d3706b196d69f66f5bd';

type Box = { x: number; y: number; w: number; h: number; label?: string };
/** Camera: zoom and the point (in % of the picture) it zooms towards. */
type Cam = [scale: number, ox: number, oy: number];

const FRAMES = {
  cosimo: { src: '/about/cosimo-pontormo.jpg', w: 667, h: 900, alt: "Cosimo de' Medici in profile, in a red robe and cap", credit: <>Cosimo de&apos; Medici, by Jacopo Pontormo, about 1519. Uffizi, Florence.</> },
  fresco: { src: '/about/ficino-ghirlandaio.jpg', w: 1044, h: 900, alt: 'Four Florentine scholars in red cloaks; Ficino, smiling, is on the left', credit: <>Ficino (left) with Landino, Poliziano and Chalkondyles. Ghirlandaio, fresco, 1486&ndash;90. Santa Maria Novella, Florence.</> },
  preface: { src: '/about/pimander-1472.jpg', w: 760, h: 1000, alt: "Ficino's Latin preface to the Pimander, printed 1472", credit: <>Ficino&apos;s preface to Cosimo, <em>Pimander</em>, 1472. Bayerische Staatsbibliothek. <Link href={PIMANDER_PREFACE} className="underline decoration-1 underline-offset-[0.2em]">Read the page</Link></> },
  chain: { src: '/about/pimander-1472-chain.jpg', w: 767, h: 1000, alt: 'The page of the 1472 Pimander that names the ancient theologians', credit: <>The same preface, one page earlier. <Link href={PIMANDER} className="underline decoration-1 underline-offset-[0.2em]">Read the book in English</Link></> },
  plotinus: { src: '/about/plotinus-lorenzo.jpg', w: 702, h: 1000, alt: 'An illuminated title page in a wreath of leaves and gems, with a flame above', credit: <>Ficino&apos;s Plotinus, made for Lorenzo de&apos; Medici, 1490. <Link href={PLOTINUS_TITLE} className="underline decoration-1 underline-offset-[0.2em]">Read it</Link></> },
} as const;
type FrameKey = keyof typeof FRAMES;

const LINE = 3.1;
const line = (y: number, x = 15, w = 70.5): Box => ({ x, y, w, h: LINE });

type Beat = {
  year?: string;
  frame: FrameKey;
  /** Camera at the start and end of the beat; scroll moves between them. */
  cam: [Cam, Cam];
  marks?: Box[];
  /** English shown over the page, under the marked Latin. */
  english?: ReactNode;
  /** Names shown as a chain, lit in step with `marks`. */
  chain?: boolean;
  body: ReactNode;
};

const BEATS: Beat[] = [
  {
    year: '1438',
    frame: 'cosimo',
    cam: [[2.1, 38, 17], [1.5, 38, 22]],
    body: <>The Greek and Latin churches meet in Florence. With the Greeks comes the philosopher Gemistos Plethon, lecturing on Plato: a famous name almost nobody in the West can read.</>,
  },
  {
    frame: 'cosimo',
    cam: [[1.5, 38, 22], [1, 50, 50]],
    body: <>Cosimo de&apos; Medici, the banker who runs the city, goes to hear him again and again. He starts collecting Greek manuscripts and pays for a library at San Marco, open to scholars.</>,
  },
  {
    year: '1462',
    frame: 'fresco',
    cam: [[1, 50, 50], [2.3, 19, 30]],
    body: <>Cosimo chooses his doctor&apos;s son, Marsilio Ficino, to learn Greek and translate all of Plato, and gives him a house at Careggi to do it.</>,
  },
  {
    year: '1463',
    frame: 'preface',
    cam: [[1.05, 50, 40], [1.25, 50, 40]],
    marks: [line(36.3), line(38.9), line(41.6, 15, 9)],
    english: <>&ldquo;Lately, having been brought from Macedonia into Italy through the diligence of Leonardo the Macedonian, a learned and pious monk, it has come to us.&rdquo;</>,
    body: (
      <>
        A monk, Leonardo of Pistoia, arrives from Macedonia with a Greek manuscript of the <em>Corpus Hermeticum</em>. It is thought to be the work of Hermes Trismegistus, an Egyptian sage as old as Moses. Cosimo is old and ill, and tells Ficino to put Plato aside.
      </>
    ),
  },
  {
    frame: 'preface',
    cam: [[1.25, 50, 40], [1.35, 50, 46]],
    marks: [line(41.6, 24.5, 61), line(44.1), line(46.7), line(49.3, 15, 13)],
    english: <>&ldquo;When I, provoked by your exhortations, had decided to translate it from the Greek language into Latin, I thought it would be fair, happy Cosimo, to dedicate the booklet to your name.&rdquo;</>,
    body: <>Ficino translates it in a few months and dedicates it to Cosimo. This is his preface, in the 1472 printing now in our library.</>,
  },
  {
    frame: 'chain',
    cam: [[1.1, 50, 45], [1.3, 50, 48]],
    chain: true,
    marks: [
      { x: 25.4, y: 60.4, w: 11.6, h: LINE, label: 'Hermes' },
      { x: 75.6, y: 42.2, w: 7.8, h: LINE, label: 'Orpheus' },
      { x: 36.1, y: 47.4, w: 19.2, h: LINE, label: 'Aglaophemus' },
      { x: 41.3, y: 50.0, w: 11.6, h: LINE, label: 'Pythagoras' },
      { x: 61.2, y: 50.0, w: 10.4, h: LINE, label: 'Philolaus' },
      { x: 34.8, y: 52.7, w: 10.2, h: LINE, label: 'Plato' },
    ],
    body: (
      <>
        In it he traces one wisdom from Hermes through Orpheus, Aglaophemus, Pythagoras and Philolaus to Plato: the <em>prisca theologia</em>, the ancient theology behind them all.
      </>
    ),
  },
  {
    year: '1484',
    frame: 'plotinus',
    cam: [[1.25, 50, 42], [1, 50, 50]],
    body: <>Then he goes back to Plato. All of Plato is printed in Latin in 1484, Plotinus follows, and the presses carry them across Europe.</>,
  },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const HI = 'rgba(250, 204, 21, .42)';

export default function RenaissanceStory({ intro }: { intro: ReactNode }) {
  const beatRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [at, setAt] = useState({ i: 0, p: 0 });
  const still = useReducedMotion();

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const vh = window.innerHeight;
      // On phones the stage is pinned over the top half, so read at the middle
      // of what is left below it.
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      const y = wide ? vh * 0.5 : vh * 0.78;
      let i = 0;
      let p = 0;
      beatRefs.current.forEach((el, k) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top <= y) {
          i = k;
          p = Math.min(1, Math.max(0, (y - r.top) / r.height));
        }
      });
      setAt((o) => (o.i === i && Math.abs(o.p - p) < 0.004 ? o : { i, p }));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const beat = BEATS[at.i];
  const t = still ? 1 : ease(at.p);
  const [c0, c1] = beat.cam;
  const cam: Cam = still ? [1, 50, 50] : [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
  // Marks come on one after another over the first half of the beat.
  const lit = (k: number, n: number) => still || at.p > 0.08 + (k / Math.max(1, n)) * 0.4;

  return (
    <div className="rs">
      <div className="max-w-4xl">{intro}</div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-16">
        {/* Stage: pinned under the site header on every width. */}
        <div className="rs-stage sticky top-0 pt-4 lg:pt-0 lg:top-24 z-10 self-start order-first lg:order-last h-[54svh] lg:h-[calc(100svh-8rem)] bg-cream flex flex-col">
          <div className="relative flex-1 min-h-0 [container-type:size]">
            {(Object.keys(FRAMES) as FrameKey[]).map((key) => {
              const f = FRAMES[key];
              const on = key === beat.frame;
              const r = f.w / f.h;
              return (
                <div
                  key={key}
                  className="absolute inset-0 flex items-center justify-center transition-opacity duration-700"
                  style={{ opacity: on ? 1 : 0, pointerEvents: on ? 'auto' : 'none' }}
                  aria-hidden={!on}
                >
                  <div
                    className="relative overflow-hidden bg-[var(--bg-warm)]"
                    style={{ width: `min(100cqw, calc(100cqh * ${r}))`, aspectRatio: `${f.w} / ${f.h}` }}
                  >
                    <div
                      className="absolute inset-0 rs-cam"
                      style={on ? { transform: `scale(${cam[0]})`, transformOrigin: `${cam[1]}% ${cam[2]}%` } : undefined}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.src} alt={f.alt} width={f.w} height={f.h} className="absolute inset-0 w-full h-full" />
                      {on &&
                        beat.marks?.map((m, k) => (
                          <span
                            key={k}
                            className="rs-mark absolute"
                            style={{
                              left: `${m.x}%`,
                              top: `${m.y}%`,
                              width: `${m.w}%`,
                              height: `${m.h}%`,
                              background: HI,
                              transform: `scaleX(${lit(k, beat.marks!.length) ? 1 : 0})`,
                            }}
                          />
                        ))}
                    </div>
                    {on && beat.english && (
                      <p
                        className="rs-note absolute left-3 right-3 bottom-3 sm:left-5 sm:right-5 sm:bottom-5 bg-cream/95 border border-border-light px-4 py-3 text-[13px] sm:text-[15px] leading-snug text-primary"
                        style={{ opacity: lit(0, 2) ? 1 : 0 }}
                      >
                        {beat.english}
                      </p>
                    )}
                    {on && beat.chain && (
                      <ol className="absolute left-3 right-3 bottom-3 sm:left-5 sm:right-5 sm:bottom-5 flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-cream/95 border border-border-light px-3 py-2.5 text-[13px] sm:text-[15px]">
                        {beat.marks!.map((m, k) => (
                          <li key={m.label} className="rs-chain flex items-center gap-1.5" style={{ opacity: lit(k, beat.marks!.length) ? 1 : 0.25 }}>
                            {k > 0 && <span className="text-muted" aria-hidden="true">→</span>}
                            <span className="text-primary font-medium">{m.label}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="shrink-0 pt-3 pb-2 text-xs text-muted leading-snug min-h-[3.2em]">{FRAMES[beat.frame].credit}</p>
        </div>

        {/* Beats */}
        <div className="relative">
          {BEATS.map((b, k) => (
            <div
              key={k}
              ref={(el) => {
                beatRefs.current[k] = el;
              }}
              className="min-h-[70svh] lg:min-h-[85svh] flex items-center py-10"
            >
              <div className="rs-beat bg-cream py-2" style={{ opacity: still || k === at.i ? 1 : 0.28 }}>
                {b.year && <p className="font-serif text-5xl md:text-6xl text-primary tabular-nums leading-none mb-5">{b.year}</p>}
                <p className="text-xl md:text-2xl text-secondary leading-snug">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .rs .rs-cam { transition: transform .18s linear; will-change: transform; }
        .rs .rs-mark { mix-blend-mode: multiply; transform-origin: left center; transition: transform .45s cubic-bezier(.2,.7,.2,1); }
        .rs .rs-note, .rs .rs-chain { transition: opacity .5s ease; }
        .rs .rs-beat { transition: opacity .5s ease; }
        @media (prefers-reduced-motion: reduce) {
          .rs .rs-cam, .rs .rs-mark, .rs .rs-note, .rs .rs-chain, .rs .rs-beat { transition: none; }
        }
      `}</style>
    </div>
  );
}
