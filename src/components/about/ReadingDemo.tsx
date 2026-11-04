'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { READINGS, type Box } from './readings';

/**
 * "What we do", shown rather than listed, after the folium-studio.com hero: one
 * real opening at a time is scanned, a line is transcribed, then translated,
 * then the names, terms and illustration on the page are tagged where they sit.
 * The step list beside it lights up in step with the page. About twelve seconds
 * per opening; pauses off screen; reduced motion shows the finished state.
 *
 * Mark colours are the site's badge colours: blue = transcribed (OCR), green =
 * translated, yellow = tagged.
 */

const BLUE = '#2563eb';
const GREEN = '#16a34a';
const YELLOW = '#ca8a04';

type Phase = 0 | 1 | 2 | 3 | 4 | 5; // 0 hidden, 1 scan, 2 read, 3 translate, 4 tag, 5 share

/** `children` is the step list, rendered by the page; each step carries `rd-step` and
 *  `data-i`, and is lit from the `data-active` attribute set here. */
export default function ReadingDemo({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>(0);
  const [orig, setOrig] = useState('');
  const [en, setEn] = useState('');
  const [hi, setHi] = useState(false);
  const visible = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cur = READINGS[idx % READINGS.length];

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const later = (ms: number, f: () => void) => timers.current.push(setTimeout(f, ms));
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const type = (text: string, ms: number, set: (s: string) => void) => {
      const words = text.split(' ');
      words.forEach((_, i) => later((i * ms) / words.length, () => set(words.slice(0, i + 1).join(' '))));
    };
    let running = false;
    let i = 0;

    const play = (first: boolean) => {
      clear();
      const r = READINGS[i % READINGS.length];
      setPhase(0);
      setOrig('');
      setEn('');
      setHi(false);
      const pre = new Image();
      pre.src = `/about/readings/${r.img}-m.jpg`;
      const go = () => {
        setIdx(i);
        if (reduced) {
          setPhase(5);
          setOrig(r.orig);
          setEn(r.en);
          return;
        }
        setPhase(1);
        later(900, () => {
          const big = new Image();
          big.src = `/about/readings/${r.img}-l.jpg`;
          (big.decode ? big.decode() : Promise.resolve()).then(() => setHi(true), () => {});
        });
        later(1500, () => {
          setPhase(2);
          type(r.orig, 1500, setOrig);
        });
        later(3700, () => {
          setPhase(3);
          type(r.en, 1300, setEn);
        });
        later(5700, () => setPhase(4));
        later(8800, () => setPhase(5));
        later(11800, () => {
          i++;
          if (visible.current) play(false);
          else running = false;
        });
      };
      const wait = first ? 0 : 650;
      (pre.decode ? pre.decode() : Promise.resolve()).then(() => later(wait, go), () => later(wait, go));
    };

    const io = new IntersectionObserver(
      ([e]) => {
        visible.current = e.isIntersecting;
        if (e.isIntersecting && !running) {
          running = true;
          play(true);
        }
      },
      { threshold: 0.25 },
    );
    if (rootRef.current) io.observe(rootRef.current);
    return () => {
      io.disconnect();
      clear();
    };
  }, []);

  const active = phase === 0 ? -1 : phase - 1;
  const box = (b: Box, cls: string, label?: string, key?: string | number) => (
    <div
      key={key}
      className={`rd-box ${cls} ${b.side ? `side-${b.side}` : ''}`}
      style={{ left: `${b.l}%`, top: `${b.t}%`, width: `${b.w}%`, height: `${b.h}%` }}
    >
      {label && <span className="rd-lab">{label}</span>}
    </div>
  );
  const tags: [string, string][] = [
    ...cur.ents.map((e) => [e.k, e.v] as [string, string]),
    ...cur.terms.map((v) => ['Subject', v] as [string, string]),
    ...cur.plate.tags.map((v) => ['Illustration', v] as [string, string]),
  ];

  return (
    <div ref={rootRef} data-active={active} className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-10 lg:gap-14 items-start">
      <div className={`rd p${phase}`} aria-label={`A page from ${cur.title} being transcribed, translated and tagged`}>
        <div className="rd-page relative border border-border-light bg-[#1a1612]" style={{ aspectRatio: String(cur.ar) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/about/readings/${cur.img}-${hi ? 'l' : 'm'}.jpg`}
            alt=""
            className="absolute inset-0 w-full h-full object-contain"
            decoding="async"
          />
          <div className="rd-scan" />
          <div className="absolute inset-0">
            {box(cur.line, 'line')}
            {cur.ents.map((e, i) => box(e, 'ent', e.k, i))}
            {box(cur.plate, 'plate', cur.plate.k.replace('Figure · ', ''))}
          </div>
        </div>

        <div className="rd-card border border-t-0 border-border-medium bg-cream px-4 sm:px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-secondary min-w-0 truncate">
              <b className="font-semibold text-primary">{cur.title}</b> · {cur.meta}
            </span>
            <span className="flex gap-3 text-[13px] text-muted shrink-0">
              <i className={`rd-st ${phase >= 2 ? 'on' : ''}`} style={{ ['--c' as string]: BLUE }}>Transcribed</i>
              <i className={`rd-st ${phase >= 3 ? 'on' : ''}`} style={{ ['--c' as string]: GREEN }}>Translated</i>
              <i className={`rd-st ${phase >= 4 ? 'on' : ''}`} style={{ ['--c' as string]: YELLOW }}>Tagged</i>
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[15px] leading-snug">
            <dt className="text-[13px] font-medium pt-0.5" style={{ color: BLUE }}>{cur.lang}</dt>
            <dd className="text-primary italic min-h-[2.75em]">{orig}</dd>
            <dt className="text-[13px] font-medium pt-0.5" style={{ color: phase >= 3 ? GREEN : undefined }}>English</dt>
            <dd className="text-primary min-h-[2.75em]">{en}</dd>
            <dt className="text-[13px] font-medium pt-0.5" style={{ color: phase >= 4 ? YELLOW : undefined }}>Tags</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1 min-h-[1.5em] text-[13px]">
              {phase >= 4 &&
                tags.map(([k, v], i) => (
                  <span key={`${k}${v}`} className="rd-tag text-primary" style={{ ['--i' as string]: i }}>
                    <span className="text-muted">{k}</span> {v}
                  </span>
                ))}
            </dd>
          </dl>
        </div>
      </div>

      <div>{children}</div>

      <style>{`
        .rd .rd-page img { transition: opacity .6s ease; }
        .rd.p0 .rd-page img { opacity: 0; }
        .rd-scan { position: absolute; left: 0; right: 0; top: 0; height: 14%; opacity: 0; pointer-events: none;
          background: linear-gradient(180deg, rgba(37,99,235,0), rgba(37,99,235,.18) 60%, rgba(96,165,250,.45) 62%, rgba(37,99,235,0) 64%); }
        .rd.p1 .rd-scan { animation: rd-scan 1.4s cubic-bezier(.4,0,.2,1) forwards; }
        @keyframes rd-scan { 0% { top: -14%; opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
        .rd-box { position: absolute; opacity: 0; transform: scale(1.04); transition: opacity .5s ease, transform .6s cubic-bezier(.2,.7,.2,1); }
        .rd-box.line { border: 1.5px solid ${BLUE}; background: rgba(37,99,235,.14); }
        .rd-box.ent { border-bottom: 2px solid #facc15; background: rgba(250,204,21,.24); }
        .rd-box.plate { border: 1.5px solid #4ade80; }
        .rd.p2 .rd-box.line, .rd.p3 .rd-box.line, .rd.p4 .rd-box.line, .rd.p5 .rd-box.line { opacity: 1; transform: none; }
        .rd.p4 .rd-box.ent, .rd.p5 .rd-box.ent, .rd.p4 .rd-box.plate, .rd.p5 .rd-box.plate { opacity: 1; transform: none; }
        .rd.p4 .rd-box.ent:nth-of-type(3) { transition-delay: .15s; } .rd.p4 .rd-box.ent:nth-of-type(4) { transition-delay: .3s; }
        .rd.p4 .rd-box.plate { transition-delay: .5s; }
        .rd-lab { position: absolute; left: -2px; bottom: 100%; white-space: nowrap; font-size: 11px; font-weight: 600; line-height: 1.3; padding: 1px 6px; }
        .rd-box.ent .rd-lab { background: #facc15; color: #1a1612; }
        .rd-box.plate .rd-lab { left: -1.5px; top: -1.5px; bottom: auto; background: #4ade80; color: #052e16; }
        .rd-box.side-r .rd-lab { left: calc(100% + 4px); bottom: auto; top: 50%; translate: 0 -50%; }
        .rd-box.side-l .rd-lab { left: auto; right: calc(100% + 4px); bottom: auto; top: 50%; translate: 0 -50%; }
        .rd-st { font-style: normal; display: inline-flex; align-items: center; gap: 6px; transition: color .4s; }
        .rd-st::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .5; }
        .rd-st.on { color: var(--c); font-weight: 600; }
        .rd-st.on::before { opacity: 1; }
        .rd-tag { opacity: 0; animation: rd-in .4s ease forwards; animation-delay: calc(var(--i) * 90ms); }
        @keyframes rd-in { to { opacity: 1; } }
        .rd-step { transition: opacity .4s ease; opacity: .55; }
        .rd-step .rd-num { color: var(--text-muted); transition: color .4s; }
        ${[0, 1, 2, 3, 4].map((a) => `[data-active="${a}"] .rd-step[data-i="${a}"] .rd-num { color: var(--text-primary); } ${[0, 1, 2, 3, 4].filter((i) => i <= a).map((i) => `[data-active="${a}"] .rd-step[data-i="${i}"]`).join(', ')} { opacity: 1; }`).join('\n')}
        @media (max-width: 560px) {
          .rd-lab { font-size: 9.5px; padding: 0 4px; }
          .rd-box.plate .rd-lab, .rd-box.side-l .rd-lab, .rd-box.side-r .rd-lab { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rd-box, .rd-step, .rd .rd-page img { transition: none; }
          .rd-tag { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
