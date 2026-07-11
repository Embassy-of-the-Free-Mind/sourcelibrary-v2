'use client';

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * "About this book" section with switchable variants (arrows, in place):
 *  1. Plain — serif prose on the cream background (as-is).
 *  2. Immersive — a full-height (100vh) text-page background with the about
 *     text in a left-aligned, 3/5-width frosted panel (light tint + blur).
 */
export default function AboutVariants({ content, bgUrl }: { content: ReactNode; bgUrl?: string }) {
  const [v, setV] = useState(1);

  const Switcher = ({ dark }: { dark: boolean }) => (
    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
      <span className="text-[12px] font-mono" style={{ color: dark ? 'rgba(43,38,32,0.5)' : 'rgba(245,240,232,0.6)' }}>About {v}/2</span>
      <button type="button" aria-label="Previous about variant" onClick={() => setV(x => (x === 1 ? 2 : x - 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-black/5" style={{ borderColor: dark ? 'rgba(43,38,32,0.25)' : 'rgba(245,240,232,0.3)', color: dark ? '#2b2620' : '#f7f2ea' }}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button type="button" aria-label="Next about variant" onClick={() => setV(x => (x === 2 ? 1 : x + 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-black/5" style={{ borderColor: dark ? 'rgba(43,38,32,0.25)' : 'rgba(245,240,232,0.3)', color: dark ? '#2b2620' : '#f7f2ea' }}>
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );

  const eyebrow = <div className="font-mono uppercase text-xs tracking-[0.14em] mb-4" style={{ color: '#a5503d' }}>About This Book</div>;

  if (v === 1) {
    return (
      <section id="about" className="relative pt-14 pb-8 scroll-mt-4" style={{ background: '#faf7f0' }}>
        <Switcher dark />
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
          {eyebrow}
          <div className="font-display text-lg md:text-[21px] leading-[1.62] max-w-[720px]" style={{ color: '#2b2620' }}>{content}</div>
        </div>
      </section>
    );
  }

  return (
    <section id="about" className="relative h-screen min-h-[560px] overflow-hidden scroll-mt-4" style={{ background: '#14100c' }}>
      {bgUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={bgUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 12%' }} />
      )}
      <div className="absolute inset-0" style={{ background: 'rgba(20,16,12,0.22)' }} />
      <Switcher dark={false} />
      <div className="relative h-full flex items-center max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        <div className="w-full md:w-3/5 backdrop-blur-md rounded-2xl p-8 md:p-12 shadow-xl" style={{ background: 'rgba(250,247,240,0.72)', border: '1px solid rgba(255,255,255,0.45)' }}>
          {eyebrow}
          <div className="font-display text-lg md:text-[22px] leading-[1.6]" style={{ color: '#2b2620' }}>{content}</div>
        </div>
      </div>
    </section>
  );
}
