'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Site-wide scroll-into-view reveal for page sections (Embassy / Webflow-IX2
 * style: fade + rise as each section enters the viewport).
 *
 * Auto-tags sections so individual components don't need editing. Targets are
 * <section> elements, the direct children of <main>, and anything marked
 * [data-reveal]. To avoid any flash, ONLY sections that start below the fold
 * are hidden + observed — content already on screen is left untouched. Re-scans
 * on navigation and on DOM changes (for streamed / lazily rendered sections).
 */
export default function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const root = document.getElementById('main-content');
    if (!root) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -12% 0px' },
    );

    // A background layer (hero video, featured-collection image, overlay) is an
    // absolutely/fixed-positioned child or a <video>. These must NOT fade — only
    // the content over them should — so a faded section would drag its bg in too.
    const isBackgroundLayer = (el: Element) => {
      if (el.tagName === 'VIDEO') return true;
      const pos = getComputedStyle(el).position;
      return pos === 'absolute' || pos === 'fixed';
    };

    // What to actually animate for a candidate: if it has a background layer,
    // reveal its in-flow content children (leaving the bg static); otherwise
    // reveal the element itself.
    const targetsFor = (el: Element): Element[] => {
      const kids = Array.from(el.children);
      if (!kids.some(isBackgroundLayer)) return [el];
      const content = kids.filter((k) => !isBackgroundLayer(k));
      return content.length ? content : [el];
    };

    const reveal = (el: Element) => {
      if (el.hasAttribute('data-reveal-item') || el.hasAttribute('data-reveal-skip')) return;
      // On screen (or above): leave as-is so nothing flashes.
      if (el.getBoundingClientRect().top < window.innerHeight) {
        el.setAttribute('data-reveal-skip', '');
        return;
      }
      el.setAttribute('data-reveal-item', '');
      io.observe(el);
    };

    const consider = (el: Element) => {
      if (el.hasAttribute('data-reveal-done')) return;
      if (el.closest('header')) return; // never hide the navbar (and avoids breaking sticky)
      el.setAttribute('data-reveal-done', '');
      for (const target of targetsFor(el)) reveal(target);
    };

    const scan = () => {
      const set = new Set<Element>();
      root.querySelectorAll('section, main > *, [data-reveal]').forEach((el) => set.add(el));
      for (const el of set) {
        // skip if an ancestor is also a candidate (only reveal the outermost)
        let p = el.parentElement;
        let nested = false;
        while (p) {
          if (set.has(p)) { nested = true; break; }
          p = p.parentElement;
        }
        if (!nested) consider(el);
      }
    };

    scan();

    // Catch streamed / client-rendered sections that appear after hydration.
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return null;
}
