'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Gap between a floating control and the top of the visible area, in px. */
export const FLOATING_OVERLAY_MARGIN = 8;

/**
 * Marks a control the magnifier lens must not cover. `ImageWithMagnifier` hides
 * the lens while the cursor is on (or just beside) any element carrying this
 * attribute, so a reader can always see the button they're reaching for.
 */
export const LENS_AVOID_ATTR = 'data-lens-avoid';

/**
 * Keeps an absolutely-positioned control (the magnifier toggle, the deep-zoom
 * button) on screen while the image beneath it scrolls past. Returns the `top`
 * offset to apply, measured from the control's positioning container.
 *
 * `position: sticky` cannot do this. The reader wraps each page scan in an
 * `overflow-hidden` box, which becomes sticky's scroll container — and that box
 * never scrolls, so a sticky control would simply sit still. Instead we find the
 * nearest ancestor that genuinely scrolls (the reader panel) and offset the
 * control from its own container's top edge, clamped so it never runs past the
 * bottom of the image.
 *
 * Page-scrolled callers have no scrollable ancestor; there the ceiling is the
 * bottom of the sticky site header, or the viewport top when it doesn't stick.
 *
 * @param ref     the control itself — its `offsetParent` is the container it floats within
 * @param enabled false while the control is unmounted or irrelevant (no listeners bound)
 */
export function useFloatingOverlayTop(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean = true
): number {
  const [top, setTop] = useState(FLOATING_OVERLAY_MARGIN);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    const container = el?.offsetParent as HTMLElement | null;
    if (!el || !container) return;

    let scroller: HTMLElement | null = container.parentElement;
    while (scroller) {
      const overflowY = window.getComputedStyle(scroller).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }

    const viewportTop = () => {
      if (scroller) return scroller.getBoundingClientRect().top;
      const header = document.querySelector<HTMLElement>('[data-site-header]');
      if (!header) return 0;
      const position = window.getComputedStyle(header).position;
      if (position !== 'sticky' && position !== 'fixed') return 0;
      return Math.max(0, header.getBoundingClientRect().bottom);
    };

    let frame = 0;
    const update = () => {
      frame = 0;
      const box = container.getBoundingClientRect();
      const height = el.offsetHeight;
      const maxTop = Math.max(
        FLOATING_OVERLAY_MARGIN,
        box.height - height - FLOATING_OVERLAY_MARGIN
      );
      const wanted = viewportTop() - box.top + FLOATING_OVERLAY_MARGIN;
      setTop(Math.min(maxTop, Math.max(FLOATING_OVERLAY_MARGIN, wanted)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    // `scroll` doesn't bubble, so listen in the capture phase to catch it from
    // whichever ancestor is actually scrolling.
    const capture = { capture: true, passive: true } as const;
    window.addEventListener('scroll', schedule, capture);
    window.addEventListener('resize', schedule);
    // The image often loads after mount, growing the container under the control.
    const observer = new ResizeObserver(schedule);
    observer.observe(container);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, capture);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [enabled, ref]);

  return top;
}
