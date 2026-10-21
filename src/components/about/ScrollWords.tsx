'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * A sentence whose words darken one by one as it scrolls up the screen.
 * Reduced motion: shown at full strength.
 */
export default function ScrollWords({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [p, setP] = useState(0);
  const still = useReducedMotion();

  useEffect(() => {
    if (still) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the top reaches 85% of the screen, 1 when the bottom passes 45%.
      setP(Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.4 + r.height))));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [still]);

  const words = text.split(' ');
  return (
    <p ref={ref} className={className}>
      {words.map((w, k) => (
        <span
          key={k}
          style={{ opacity: still || p * words.length > k ? 1 : 0.18, transition: 'opacity .3s ease' }}
        >
          {w}{k < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}
