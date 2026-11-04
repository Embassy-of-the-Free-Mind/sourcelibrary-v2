import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has come on screen. With replay, flips back when it
 * leaves so scenes replay; without it, stays true (no flicker at the edge).
 */
export function useInView<T extends Element>(threshold = 0.35, replay = false) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (replay) return setInView(e.isIntersecting);
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, replay]);
  return [ref, inView] as const;
}
