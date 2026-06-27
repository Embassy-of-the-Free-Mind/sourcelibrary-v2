'use client';

import { useRef, useEffect } from 'react';

/**
 * Absolute background <img> with a subtle scroll parallax. Drop it inside a
 * `relative overflow-hidden` parent; the image is oversized (130% tall, offset
 * -15%) so the transform never reveals an edge. Animates only while the parent
 * is on screen, throttled with rAF, and disabled under prefers-reduced-motion.
 */
export default function ParallaxImage({
  src, alt = '', className = '', strength = 0.12, loading = 'lazy',
}: {
  src: string;
  alt?: string;
  className?: string;
  strength?: number;
  loading?: 'lazy' | 'eager';
}) {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let visible = false;
    const update = () => {
      raf = 0;
      const rect = parent.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const prog = (rect.top + rect.height / 2 - vh / 2) / (vh / 2 + rect.height / 2);
      const shift = -Math.max(-1, Math.min(1, prog)) * strength * rect.height;
      el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
    };
    const onScroll = () => { if (!raf && visible) raf = requestAnimationFrame(update); };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { update(); window.addEventListener('scroll', onScroll, { passive: true }); }
      else { window.removeEventListener('scroll', onScroll); }
    }, { threshold: 0 });
    io.observe(parent);
    window.addEventListener('resize', onScroll, { passive: true });
    update();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img ref={ref} src={src} alt={alt} loading={loading} className={`absolute inset-x-0 -top-[15%] h-[130%] w-full object-cover ${className}`} style={{ willChange: 'transform' }} />
  );
}
