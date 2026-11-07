'use client';

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Fades and lifts its children in the first time they come into view, then
 * leaves them shown. (Fading back out on leaving made items flicker at the
 * screen edge: the lift moved them back across the trigger line. 2026-11-04)
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
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setInView(true);
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
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
