'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { TINT } from './PlateWall';

interface Saved { src: string; x: number; y: number }

export interface HeroCandidate { src: string; thumb: string; w: number; h: number; label?: string; href?: string }

// The hero box the check is made against: a wide desktop hero, 1440 by 760 CSS pixels.
const BOX_W = 1440;
const BOX_H = 760;
/**
 * Sharp enough means never enlarged. Full bleed crops the picture to fill the whole hero, so it
 * must be at least as wide and as tall as the hero once scaled to cover it. Whole shows the
 * picture uncropped at the hero's height, so it only needs that height.
 */
export const sharpEnough = (c: HeroCandidate, mode: 'bleed' | 'whole') =>
  mode === 'bleed' ? Math.max(BOX_W / c.w, BOX_H / c.h) <= 1 : c.h >= BOX_H;

/**
 * One chosen picture behind the hero instead of the plate rows. The maker picks it; only pictures
 * big enough for the hero can be picked. If none is, the plate rows stay (fallback).
 * Prototype: the choice is kept in this browser only.
 */
export default function HeroPicture({ slug, mode, cands, fallback }: { slug: string; mode: 'bleed' | 'whole'; cands: HeroCandidate[]; fallback: ReactNode }) {
  const ok = cands.filter((c) => sharpEnough(c, mode));
  const [pick, setPick] = useState<Saved | null>(null);
  const [open, setOpen] = useState(false);
  // Full bleed only: the picture being framed, before it is saved.
  const [framing, setFraming] = useState<Saved | null>(null);
  const key = `hero-pick-${slug}`;
  // The saved choice lives in localStorage, which the server can't read, so it is applied after mounting.
  useEffect(() => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    let v: Saved;
    try { v = JSON.parse(raw); } catch { v = { src: raw, x: 50, y: 50 }; }
    // Reading localStorage once on mount is the external sync this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPick(v);
  }, [key]);
  const chosen = ok.find((c) => c.src === pick?.src) ?? ok[0];
  // While framing, the hero behind already follows the frame.
  const shown = framing ? { ...ok.find((c) => c.src === framing.src)!, ...framing } : chosen && { ...chosen, x: pick?.src === chosen.src ? pick.x : 50, y: pick?.src === chosen.src ? pick.y : 50 };
  const save = (v: Saved) => { setPick(v); localStorage.setItem(key, JSON.stringify(v)); setFraming(null); setOpen(false); };
  const choose = (c: HeroCandidate) => {
    const same = pick?.src === c.src;
    if (mode === 'bleed') setFraming({ src: c.src, x: same ? pick.x : 50, y: same ? pick.y : 50 });
    else save({ src: c.src, x: 50, y: 50 });
  };

  return (
    <>
      {!shown ? fallback : mode === 'bleed' ? (
        <>
          <img src={shown.src} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: `${shown.x}% ${shown.y}%` }} />
          <div className="absolute inset-0" style={{ background: TINT }} />
        </>
      ) : (
        <>
          <img src={shown.src} alt="" className="absolute right-0 inset-y-0 h-full w-auto max-w-none md:max-w-[62%] object-contain object-right" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #1a1612 38%, rgba(26,22,18,.55) 62%, rgba(26,22,18,.1) 100%)' }} />
        </>
      )}

      <button type="button" onClick={() => setOpen(true)} className="absolute bottom-3 right-4 z-20 text-xs text-white/75 underline underline-offset-2 hover:text-white">
        {chosen ? 'Choose the picture' : 'No picture is big enough for this hero'} (prototype)
      </button>

      {open && framing && (
        <Framer c={ok.find((c) => c.src === framing.src)!} v={framing} onChange={setFraming} onBack={() => setFraming(null)} onSave={() => save(framing)} />
      )}

      {open && !framing && (
        <div className="absolute inset-0 z-30 bg-[#1a1612]/95 overflow-y-auto p-6 md:p-10 text-white">
          <div className="max-w-[1500px] mx-auto">
            <div className="flex items-start justify-between gap-6 mb-2">
              <h2 className="font-serif text-2xl md:text-3xl">Choose the hero picture</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="w-9 h-9 grid place-items-center hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[14px] text-white/70 mb-6 max-w-2xl">
              {mode === 'bleed' ? `Fills the whole hero, so it needs at least ${BOX_W} by ${BOX_H} pixels after cropping.` : `Shown whole at the hero's height, so it needs at least ${BOX_H} pixels tall.`} Pictures smaller than that would look soft and can&apos;t be picked.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              {cands.map((c) => {
                const good = sharpEnough(c, mode);
                const on = chosen?.src === c.src;
                return (
                  <button key={c.src} type="button" disabled={!good} onClick={() => choose(c)}
                    className={`text-left group ${good ? '' : 'opacity-35 cursor-not-allowed'}`}>
                    <span className={`block aspect-square overflow-hidden bg-black border-2 ${on ? 'border-white' : 'border-transparent group-enabled:group-hover:border-white/50'}`}>
                      <img src={c.thumb} alt={c.label || ''} loading="lazy" className="w-full h-full object-contain" />
                    </span>
                    <span className="block mt-1.5 text-[12px] text-white/80 tabular-nums">{c.w.toLocaleString('en-GB')} × {c.h.toLocaleString('en-GB')}</span>
                    <span className="block text-[12px] text-white/55">{on ? 'Chosen' : good ? 'Sharp enough' : 'Too small'}{good && mode === 'bleed' ? ' · then choose the part' : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Choose which part of the picture fills a full-bleed hero. The frame is the hero's shape at the
 * picture's own scale (cover), so it can only slide one way: up and down for an upright picture,
 * sideways for a wide one. Its place becomes the picture's object-position, so the same part
 * stays in view on other screen shapes too.
 */
function Framer({ c, v, onChange, onBack, onSave }: { c: HeroCandidate; v: Saved; onChange: (v: Saved) => void; onBack: () => void; onSave: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const a = c.w / c.h;
  const B = BOX_W / BOX_H;
  const tall = a < B;
  const f = tall ? a / B : B / a; // the frame's share of the picture's height (tall) or width (wide)
  const at = (tall ? v.y : v.x) / 100 * (1 - f); // the frame's start, as a share of the picture
  const move = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const p = tall ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const start = Math.min(1 - f, Math.max(0, p - f / 2));
    const pct = f >= 1 ? 50 : Math.round((start / (1 - f)) * 100);
    onChange({ ...v, ...(tall ? { y: pct } : { x: pct }) });
  };
  const nudge = (d: number) => onChange({ ...v, ...(tall ? { y: Math.min(100, Math.max(0, v.y + d)) } : { x: Math.min(100, Math.max(0, v.x + d)) }) });
  return (
    <div className="absolute inset-x-0 top-0 z-30 min-h-full bg-[#1a1612]/95 p-6 md:p-10 text-white">
      <div className="max-w-[1500px] mx-auto">
        <h2 className="font-serif text-2xl md:text-3xl mb-2">Choose the part that shows</h2>
        <p className="text-[14px] text-white/70 mb-6 max-w-2xl">Drag the frame {tall ? 'up or down' : 'left or right'}, or use the arrow keys. The bright part is what the hero shows.</p>
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <div ref={box} tabIndex={0} role="slider" aria-label="Part of the picture that shows" aria-valuenow={tall ? v.y : v.x} aria-valuemin={0} aria-valuemax={100}
            onKeyDown={(e) => { if (['ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); nudge(-5); } if (['ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); nudge(5); } }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => { if (e.buttons) move(e); }}
            className={`relative overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${tall ? 'h-[58vh] w-auto' : 'w-full md:w-[60vw] h-auto'}`}
            style={{ aspectRatio: `${c.w} / ${c.h}` }}>
            <img src={c.src} alt="" draggable={false} className="absolute inset-0 w-full h-full" />
            <div className="absolute border-2 border-white" style={{
              boxShadow: '0 0 0 9999px rgba(0,0,0,.6)',
              ...(tall ? { left: 0, right: 0, top: `${at * 100}%`, height: `${f * 100}%` } : { top: 0, bottom: 0, left: `${at * 100}%`, width: `${f * 100}%` }),
            }} />
          </div>
          <div className="flex md:flex-col gap-2">
            <button type="button" onClick={onSave} className="h-11 px-5 bg-white text-primary text-sm font-medium hover:opacity-90">Use this</button>
            <button type="button" onClick={onBack} className="h-11 px-5 text-sm text-white/80 underline underline-offset-[3px] hover:text-white">Back to the pictures</button>
          </div>
        </div>
      </div>
    </div>
  );
}
