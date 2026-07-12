'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Visual = { src: string; href: string; caption?: string };

/**
 * "About this book" section with switchable variants (arrows, in place):
 *  1. Plain — serif prose on the cream background, with an interesting page /
 *     plate beside it and the subject tags listed below the text.
 *  2. Immersive — a full-height (100vh) text-page background (with a subtle
 *     scroll parallax) and the about text (+ tags) in a left-aligned,
 *     3/5-width frosted panel (light tint + blur).
 */
export default function AboutVariants({
  content,
  bgUrl,
  visual,
  tags = [],
  belowContent,
}: {
  content: ReactNode;
  bgUrl?: string;
  visual?: Visual | null;
  tags?: string[];
  /** Reading guide / Contents / etc. dropdowns, rendered under the text+tags. */
  belowContent?: ReactNode;
}) {
  const [v, setV] = useState(1);
  const sectionRef = useRef<HTMLElement>(null);
  const [parallax, setParallax] = useState(0);

  // Scroll-driven parallax for the immersive variant's background.
  useEffect(() => {
    if (v !== 2) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = sectionRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const progress = Math.max(-1, Math.min(1, rect.top / (window.innerHeight || 1)));
        setParallax(progress * 60); // ±60px
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [v]);

  const Switcher = ({ dark }: { dark: boolean }) => (
    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
      <span className="text-[12px] font-mono" style={{ color: dark ? 'rgba(43,38,32,0.5)' : 'rgba(245,240,232,0.6)' }}>About {v}/2</span>
      <button type="button" aria-label="Previous about variant" onClick={() => setV(x => (x === 1 ? 2 : x - 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-black/5" style={{ borderColor: dark ? 'rgba(43,38,32,0.25)' : 'rgba(245,240,232,0.3)', color: dark ? '#2b2620' : '#f7f2ea' }}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button type="button" aria-label="Next about variant" onClick={() => setV(x => (x === 1 ? 2 : 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-black/5" style={{ borderColor: dark ? 'rgba(43,38,32,0.25)' : 'rgba(245,240,232,0.3)', color: dark ? '#2b2620' : '#f7f2ea' }}>
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );

  const eyebrow = <div className="font-mono uppercase text-xs tracking-[0.14em] mb-4" style={{ color: '#a5503d' }}>About This Book</div>;

  const tagRow = tags.length > 0 ? (
    <div className="flex flex-wrap gap-2 mt-8">
      {tags.map((tag) => (
        <Link key={tag} href={`/search?q=${encodeURIComponent(tag)}`} className="text-[13px] px-3 py-1 transition-colors hover:bg-[#f0eadd]" style={{ border: '1px solid #ddd5c5', color: '#5c5546' }}>{tag}</Link>
      ))}
    </div>
  ) : null;

  if (v === 1) {
    return (
      <section id="about" className="relative pt-14 pb-8 scroll-mt-4" style={{ background: '#faf7f0' }}>
        <Switcher dark />
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
          <div className={visual ? 'grid md:grid-cols-5 gap-10 md:gap-12 items-start' : ''}>
            {/* Text + tags + dropdowns: 3/5 on desktop (below the plate on mobile) */}
            <div className="order-2 md:order-1 md:col-span-3">
              {eyebrow}
              <div className="font-display text-lg md:text-[21px] leading-[1.62]" style={{ color: '#2b2620' }}>{content}</div>
              {tagRow}
              {belowContent && <div className="mt-8 space-y-6">{belowContent}</div>}
            </div>
            {/* Interesting page / plate: 2/5 on desktop, sticky while sections expand */}
            {visual && (
              <div className="order-1 md:order-2 md:col-span-2 md:sticky md:top-6">
                <Link href={visual.href} className="block group">
                  <div className="overflow-hidden border" style={{ borderColor: '#e6e0d3', background: '#fff', boxShadow: '0 18px 40px -18px rgba(20,12,4,0.35)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={visual.src} alt={visual.caption || ''} className="w-full h-auto object-contain transition-transform duration-500 group-hover:scale-[1.02]" loading="lazy" />
                  </div>
                  {visual.caption && <div className="mt-3 text-[13px] italic" style={{ color: '#948d80' }}>{visual.caption}</div>}
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
    <section ref={sectionRef} id="about" className="relative h-screen min-h-[560px] overflow-hidden scroll-mt-4" style={{ background: '#14100c' }}>
      {bgUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={bgUrl}
          alt=""
          className="absolute left-0 -top-[10%] w-full h-[120%] object-cover"
          style={{ objectPosition: 'center top', transform: `translateY(${parallax}px)`, willChange: 'transform' }}
        />
      )}
      <div className="absolute inset-0" style={{ background: 'rgba(20,16,12,0.22)' }} />
      <Switcher dark={false} />
      <div className="relative h-full flex items-center max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        <div className="w-full md:w-3/5 backdrop-blur-md rounded-2xl p-8 md:p-12 shadow-xl" style={{ background: 'rgba(250,247,240,0.72)', border: '1px solid rgba(255,255,255,0.45)' }}>
          {eyebrow}
          <div className="font-display text-lg md:text-[22px] leading-[1.6]" style={{ color: '#2b2620' }}>{content}</div>
          {tagRow}
        </div>
      </div>
    </section>
    {belowContent && (
      <section className="pt-8 pb-8" style={{ background: '#faf7f0' }}>
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
          <div className="max-w-[860px] space-y-6">{belowContent}</div>
        </div>
      </section>
    )}
    </>
  );
}
