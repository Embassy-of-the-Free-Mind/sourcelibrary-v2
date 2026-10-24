'use client';

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Fades and lifts its children in when they come into view and back out when
 * they leave. Nothing is tied to scroll position, so nothing scrubs or jumps.
 * Reduced motion: always shown.
 */
export default function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className = '',
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const still = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      rootMargin: '-6% 0px -10% 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const on = still || inView;
  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: on ? 1 : 0,
        transform: on ? 'none' : 'translateY(28px)',
        transition: still ? 'none' : `opacity .9s ease ${delay}ms, transform 1s cubic-bezier(.2,.7,.2,1) ${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
