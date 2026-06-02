'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Site-wide scroll-into-view reveal for page sections (Embassy / Webflow-IX2
 * style: fade + rise as each section enters the viewport).
 *
 * Auto-tags sections so individual components don't need editing. Targets are
 * <section>, the direct children of <main>, and [data-reveal]. To avoid any
 * flash, ONLY sections that start below the fold are hidden + observed —
 * content already on screen is left untouched. Background layers
 * (absolutely-positioned bg/overlay divs and <video>) are never animated; for
 * a section with a background, the in-flow content is revealed instead.
 *
 * The observer is created ONCE and kept for the component's lifetime (it lives
 * in the root layout, which persists across navigations). A MutationObserver
 * picks up content that mounts after client-side navigation or streaming, and
 * every scan re-observes any still-hidden item — so sections can't be orphaned
 * (the earlier bug where navigating to a page left sections stuck hidden).
 */
export default function ScrollReveal() {
  const pathname = usePathname();
  const scanRef = useRef<() => void>(() => {});

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

    const isBackgroundLayer = (el: Element) => {
      if (el.tagName === 'VIDEO') return true;
      const pos = getComputedStyle(el).position;
      return pos === 'absolute' || pos === 'fixed';
    };

    const targetsFor = (el: Element): Element[] => {
      const kids = Array.from(el.children);
      if (!kids.some(isBackgroundLayer)) return [el];
      const content = kids.filter((k) => !isBackgroundLayer(k));
      return content.length ? content : [el];
    };

    const tag = (el: Element) => {
      if (el.hasAttribute('data-reveal-item') || el.hasAttribute('data-reveal-skip')) return;
      // On screen (or above): leave as-is so nothing flashes.
      if (el.getBoundingClientRect().top < window.innerHeight) {
        el.setAttribute('data-reveal-skip', '');
        return;
      }
      el.setAttribute('data-reveal-item', '');
    };

    const consider = (el: Element) => {
      if (el.hasAttribute('data-reveal-done')) return;
      if (el.closest('header')) return; // never hide the navbar (avoids breaking sticky)
      el.setAttribute('data-reveal-done', '');
      for (const target of targetsFor(el)) tag(target);
    };

    const scan = () => {
      const set = new Set<Element>();
      root.querySelectorAll('section, main > *, [data-reveal]').forEach((el) => set.add(el));
      for (const el of set) {
        let p = el.parentElement;
        let nested = false;
        while (p) {
          if (set.has(p)) { nested = true; break; }
          p = p.parentElement;
        }
        if (!nested) consider(el);
      }
      // (Re-)observe everything still hidden with the live observer. Safe to
      // call repeatedly (observe is idempotent) and survives navigation.
      root.querySelectorAll('[data-reveal-item]:not(.is-visible)').forEach((el) => io.observe(el));
    };
    scanRef.current = scan;

    let raf = 0;
    const runScan = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    };
    runScan();

    const mo = new MutationObserver(runScan);
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      scanRef.current = () => {};
    };
  }, []);

  // Nudge a re-scan after client-side navigation (catches content that mounts
  // a beat after the route changes).
  useEffect(() => {
    const t1 = setTimeout(() => scanRef.current(), 50);
    const t2 = setTimeout(() => scanRef.current(), 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pathname]);

  return null;
}
