'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { TINT } from './PlateWall';

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
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const key = `hero-pick-${slug}`;
  // The saved choice lives in localStorage, which the server can't read, so it is applied after mounting.
  useEffect(() => { setPick(localStorage.getItem(key)); }, [key]);
  const chosen = ok.find((c) => c.src === pick) ?? ok[0];
  const choose = (c: HeroCandidate) => { setPick(c.src); localStorage.setItem(key, c.src); setOpen(false); };

  return (
    <>
      {!chosen ? fallback : mode === 'bleed' ? (
        <>
          <img src={chosen.src} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: TINT }} />
        </>
      ) : (
        <>
          <img src={chosen.src} alt="" className="absolute right-0 inset-y-0 h-full w-auto max-w-none md:max-w-[62%] object-contain object-right" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #1a1612 38%, rgba(26,22,18,.55) 62%, rgba(26,22,18,.1) 100%)' }} />
        </>
      )}

      <button type="button" onClick={() => setOpen(true)} className="absolute bottom-3 right-4 z-20 text-xs text-white/75 underline underline-offset-2 hover:text-white">
        {chosen ? 'Choose the picture' : 'No picture is big enough for this hero'} (prototype)
      </button>

      {open && (
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
                    <span className="block text-[12px] text-white/55">{on ? 'Chosen' : good ? 'Sharp enough' : 'Too small'}</span>
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
