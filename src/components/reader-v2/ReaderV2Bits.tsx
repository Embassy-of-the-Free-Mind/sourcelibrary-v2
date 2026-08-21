'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import { getPageDisplayUrl, getPageThumbUrl } from '@/lib/utils';
import type { Book, Page } from '@/lib/types';
import type { ReaderSettings } from './useReaderV2';

// Shared presentational pieces for the v2 reader design previews. All values
// map to existing Source Library tokens (globals.css) — no new primitives.
// Labels are letterspaced Inter caps (house style; the site sets no monospace).

/** Ink-bar foreground: cream at a given opacity (on --bg-dark surfaces). */
export function onInk(opacity: number): string {
  return `rgba(253, 252, 249, ${opacity})`;
}

/** Pane surfaces, composed from the existing palette via color-mix. */
export const SURFACE = {
  scanBed: 'color-mix(in srgb, var(--bg-warm) 90%, var(--bg-dark))',
  ocr: 'color-mix(in srgb, var(--bg-cream) 45%, var(--bg-warm))',
  translation: 'var(--bg-cream)',
  panel: 'var(--bg-warm)',
  popover: 'var(--bg-white)',
} as const;

export function CapsLabel({ children, className = '', style }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <span
      className={`font-sans text-[10.5px] font-medium uppercase tracking-[0.15em] ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

export function AiChip({ short = false }: { short?: boolean }) {
  return (
    <span
      className="font-sans text-[10px] font-medium uppercase tracking-[0.12em] border px-1.5 py-[2px]"
      style={{ color: 'var(--text-faint)', borderColor: 'var(--border-medium)' }}
      title="Translated with AI assistance"
    >
      {short ? 'AI' : 'AI translated'}
    </span>
  );
}

const LINE_WIDTH_CH = { narrow: 55, comfortable: 70, wide: 86 } as const;

/**
 * Whether a page's text sets a passage apart as a markdown blockquote.
 *
 * The transcription pass and the translation pass do not always agree: the
 * translation drops the block and runs the passage on as italics (measured
 * across 12 books, it never adds one the transcription lacks — it only ever
 * loses them, and in some books it loses every one). Rendering the block on
 * one side and not the other tells a reader the original set that passage
 * apart and the translation did not, which is not what happened.
 */
export function hasBlockquote(text?: string | null): boolean {
  return !!text && /^[ \t]*>/m.test(text);
}

/**
 * Reading text for one pane of one page — OCR or translation — rendered
 * through the production NotesRenderer pipeline (wrapper stripping, inline
 * gloss/term/margin tags, RTL, columns). Reading settings arrive as scale
 * factors over each variant's base size.
 */
export function ReaderProse({
  page, book, kind, settings, baseSize, suppressBlockquote = false,
}: {
  page: Page;
  book: Book;
  kind: 'ocr' | 'translation';
  settings: ReaderSettings;
  baseSize: number;
  /**
   * Render blockquotes as ordinary prose. Set when the two texts disagree
   * about a passage, so the panes stay in step: we withhold the treatment
   * rather than assert on one side something the other side never found.
   */
  suppressBlockquote?: boolean;
}) {
  const raw = kind === 'ocr' ? (page.ocr?.data || '') : (page.translation?.data || '');
  const text = suppressBlockquote ? raw.replace(/^[ \t]*>[ \t]?/gm, '') : raw;
  const lang = kind === 'ocr' ? book.language : 'English';

  if (!text) {
    return (
      <p className="font-sans text-[13px] italic" style={{ color: 'var(--text-faint)' }}>
        {kind === 'ocr'
          ? 'No transcription yet for this page.'
          : page.page_type === 'blank'
            ? 'Blank page.'
            : 'No translation yet for this page.'}
      </p>
    );
  }

  const fontSize = Math.round(baseSize * settings.textScale * 10) / 10;

  return (
    <div
      className="prose-manuscript"
      data-reader-v2-typeface={settings.typeface}
      style={{
        ['--reader-font-size' as string]: `${fontSize}px`,
        ['--reader-line-height' as string]: settings.lineHeight,
        maxWidth: `${LINE_WIDTH_CH[settings.lineWidth]}ch`,
        marginInline: 'auto',
        color: 'var(--text-primary)',
        textWrap: 'pretty',
      }}
    >
      <NotesRenderer
        text={text}
        showMetadata={false}
        showNotes={settings.glosses}
        language={lang}
        columns={page.columns}
        pageType={page.page_type}
      />
    </div>
  );
}

export interface ScanUrls {
  display: string | null;
  thumb: string | null;
  native: string | null;
}

export function resolveScanUrls(page: Page): ScanUrls {
  const display = getPageDisplayUrl(page as unknown as Record<string, unknown>);
  const thumb = getPageThumbUrl(page as unknown as Record<string, unknown>);
  const archived = (page as unknown as { archived_photo?: string }).archived_photo;
  const native = archived && !archived.startsWith('failed:') ? archived : display;
  return { display, thumb, native };
}

// Fine steps, closely spaced where a facsimile actually gets read (a little
// over 100%) and opening up only past 2x.
export const SCAN_ZOOM_STEPS = [
  1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.65, 1.8, 2, 2.3, 2.6, 3, 3.5, 4, 4.7, 5.3, 6,
];
export const SCAN_ZOOM_MAX = 6;

const LENS_SIZE = 220;
const LENS_MAG_MIN = 1.5;
const LENS_MAG_MAX = 6;

/**
 * The scan surface.
 *
 * At 100% the page is fitted. Past that the pane becomes a scroller so a
 * reader can travel down an enlarged page beside the translation, and so the
 * scan has a real scrollTop to share with the text panes.
 *
 * Zoom is applied as a COMPOSITED TRANSFORM on the image, with an empty spacer
 * behind it carrying the scroll extent. Re-laying out a multi-megapixel image
 * on every gesture frame is what made pinching feel jumpy; scaling it does not
 * touch layout. Each zoom keeps the point under the cursor (or between the
 * fingers) pinned, so the page grows around what you were looking at instead
 * of leaping.
 */
export function ScanViewer({
  page, book, zoom, onZoomChange, lensOn = false, scrollRef, onScroll, fullRes = false,
}: {
  page: Page;
  book: Book;
  zoom: number;
  onZoomChange: (z: number) => void;
  /** Reading lens: off by default, toggled from the pane header. */
  lensOn?: boolean;
  /** Load the archived resolution from the start (the full-screen view) */
  fullRes?: boolean;
  /** The scroller, exposed so the reader can sync it with the text panes. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
}) {
  const { display, native } = resolveScanUrls(page);
  const localRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollRef ?? localRef;
  const spacerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState(false);
  const [lens, setLens] = useState<{ x: number; y: number; bgX: number; bgY: number; bgW: number; bgH: number } | null>(null);
  // The lens has its own magnification, dialled with the wheel while it is up.
  const [lensMag, setLensMag] = useState(2.4);
  const lastLensPoint = useRef<{ x: number; y: number } | null>(null);

  // Size the page takes at 100% (contained in the pane). Zoom multiplies it.
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const natural = useRef<{ w: number; h: number } | null>(null);
  const measure = () => {
    const c = containerRef.current;
    const n = natural.current;
    if (!c || !n || !n.w || !n.h) return;
    const s = Math.min(c.clientWidth / n.w, c.clientHeight / n.h);
    setFit({ w: Math.max(1, Math.round(n.w * s)), h: Math.max(1, Math.round(n.h * s)) });
  };
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  // A cached image is already complete before React attaches onLoad, so that
  // event never fires and the viewer would sit there unable to size itself —
  // which silently disabled zoom entirely on a warm CDN. Read it directly too.
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth) {
      natural.current = { w: el.naturalWidth, h: el.naturalHeight };
      measure();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const zoomed = zoom > 1;

  // Scroll offsets computed alongside a zoom change, applied before paint so
  // the anchored point does not visibly move.
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const c = containerRef.current;
    const k = zoom / prevZoom.current;
    prevZoom.current = zoom;
    if (!c || k === 1) return;
    const p = pendingScroll.current;
    if (p) {
      // A gesture told us exactly which point to keep still.
      pendingScroll.current = null;
      c.scrollLeft = p.left;
      c.scrollTop = p.top;
      return;
    }
    // Zoom arrived from outside (the header's +/- buttons own the state), so
    // hold what is in the middle of the pane. Without this the page appears
    // to leap on every press.
    c.scrollTop = Math.max(0, (c.scrollTop + c.clientHeight / 2) * k - c.clientHeight / 2);
    c.scrollLeft = Math.max(0, (c.scrollLeft + c.clientWidth / 2) * k - c.clientWidth / 2);
  }, [zoom, containerRef]);

  /**
   * Change zoom while pinning `anchor` (a client point) in place.
   *
   * Everything is read live rather than from the render closure: this runs
   * inside a rAF, by which point several more wheel or pointer events may have
   * arrived, and computing k against a stale zoom is what left the anchor
   * drifting.
   */
  const applyZoom = (next: number, anchor?: { x: number; y: number }) => {
    const current = prevZoom.current;
    const clamped = Math.min(SCAN_ZOOM_MAX, Math.max(1, Math.round(next * 1000) / 1000));
    if (Math.abs(clamped - current) < 0.002) return;
    const c = containerRef.current;
    const sp = spacerRef.current;
    if (c && sp) {
      const rect = sp.getBoundingClientRect();
      const ax = anchor ? anchor.x : rect.left + Math.min(rect.width, c.clientWidth) / 2;
      const ay = anchor ? anchor.y : rect.top + Math.min(rect.height, c.clientHeight) / 2;
      const k = clamped / current;
      pendingScroll.current = {
        left: Math.max(0, c.scrollLeft + (ax - rect.left) * (k - 1)),
        top: Math.max(0, c.scrollTop + (ay - rect.top) * (k - 1)),
      };
    }
    onZoomChange(clamped);
  };

  // One zoom update per frame: pinch and trackpad both fire far faster than
  // the screen refreshes, and coalescing them is most of the smoothness. The
  // queued target compounds, so events sharing a frame all count.
  const frame = useRef<number | null>(null);
  const queued = useRef<{ z: number; anchor?: { x: number; y: number } } | null>(null);
  const queueBase = () => queued.current?.z ?? prevZoom.current;
  const queueZoom = (z: number, anchor?: { x: number; y: number }) => {
    queued.current = { z, anchor };
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const q = queued.current;
      queued.current = null;
      if (q) applyZoom(q.z, q.anchor);
    });
  };
  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  // Plain function: the ref it closes over can arrive as a prop, which the
  // React Compiler cannot memoize manually.
  const updateLens = (clientX: number, clientY: number, mag = lensMag) => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const r = img.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
      setLens(null);
      return;
    }
    lastLensPoint.current = { x: clientX, y: clientY };
    const cr = container.getBoundingClientRect();
    const relX = (clientX - r.left) / r.width;
    const relY = (clientY - r.top) / r.height;
    setLens({
      x: clientX - cr.left,
      y: clientY - cr.top,
      bgW: r.width * mag,
      bgH: r.height * mag,
      bgX: -(relX * r.width * mag - LENS_SIZE / 2),
      bgY: -(relY * r.height * mag - LENS_SIZE / 2),
    });
  };

  /**
   * Wheel does one of three things, depending on what is on:
   * lens up   → dial the lens's magnification (what a loupe's focus does)
   * ctrl/⌘    → zoom the scan, which is what a trackpad pinch sends
   * otherwise → nothing, so a zoomed pane scrolls natively
   */
  const onWheel = (e: React.WheelEvent) => {
    if (lensOn && !zoomed) {
      e.preventDefault();
      const next = Math.min(LENS_MAG_MAX, Math.max(LENS_MAG_MIN, lensMag * Math.exp(-e.deltaY * 0.0022)));
      setLensMag(next);
      const at = lastLensPoint.current;
      if (at) updateLens(at.x, at.y, next);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // Scale by the actual delta so a trackpad pinch tracks the fingers
      // instead of stepping by a fixed factor per event. The coefficient is
      // deliberately small: a pinch fires dozens of events per second, so
      // anything punchier runs the page to 600% in half a gesture.
      queueZoom(queueBase() * Math.exp(-e.deltaY * 0.0025), { x: e.clientX, y: e.clientY });
    }
  };

  // A new page starts at the top of the scan. This touches the DOM, so it
  // belongs in an effect rather than in the render pass.
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, left: 0 });
  }, [page.id, containerRef]);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: prevZoom.current };
      dragRef.current = null;
      setDragging(false);
      return;
    }
    if (zoomed) {
      const el = containerRef.current;
      if (el) {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        setDragging(true);
      }
      return;
    }
    if (lensOn && e.pointerType !== 'mouse') updateLens(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // Two fingers: pinch continuously, anchored between them.
    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      queueZoom(pinchRef.current.zoom * (dist / pinchRef.current.dist), {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      });
      return;
    }
    const d = dragRef.current;
    const el = containerRef.current;
    if (d && el) {
      el.scrollLeft = d.left - (e.clientX - d.x);
      el.scrollTop = d.top - (e.clientY - d.y);
      return;
    }
    // The lens tracks the cursor on a desk and the finger on a phone. Touch
    // pointermove only fires during contact, so no extra gating is needed.
    if (lensOn && !zoomed) updateLens(e.clientX, e.clientY);
    else if (lens) setLens(null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    setDragging(false);
    if (e.pointerType !== 'mouse') setLens(null);
  };

  const alt = `Scan of page ${page.page_number} of ${book.display_title || book.title}`;
  if (!display) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="h-[80%]" style={{ aspectRatio: '0.68', background: 'color-mix(in srgb, var(--bg-warm) 80%, var(--bg-dark))' }} role="img" aria-label={alt} />
      </div>
    );
  }
  const brightness = (page as unknown as { display_brightness?: number }).display_brightness;
  const src = (fullRes || zoom > 1.5) && native ? native : display;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="relative h-full w-full select-none"
      style={{
        display: 'grid',
        // "safe" matters: an overflowing item centred the normal way is pushed
        // off both edges, which puts the top of an enlarged page out of reach
        // and shifts the origin the zoom anchor is measured from.
        placeItems: 'safe center',
        overflow: zoomed ? 'auto' : 'hidden',
        cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : (lensOn ? 'crosshair' : 'default'),
        // Capture touch only while the scan is interactive, so a drag over a
        // fitted page still scrolls the mobile column and swipes pages.
        touchAction: zoomed || lensOn ? 'none' : 'auto',
        overscrollBehavior: 'contain',
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => { if (!dragRef.current) setLens(null); }}
      onDoubleClick={e => applyZoom(zoomed ? 1 : 2, { x: e.clientX, y: e.clientY })}
    >
      {/* Empty spacer carries the scroll extent; the image only composites. */}
      <div
        ref={spacerRef}
        className="relative"
        style={fit
          ? { width: fit.w * zoom, height: fit.h * zoom }
          : { width: '100%', height: '100%' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={e => {
            const el = e.currentTarget;
            natural.current = { w: el.naturalWidth, h: el.naturalHeight };
            measure();
          }}
          className={fit ? 'absolute top-0 left-0' : 'max-h-full max-w-full object-contain'}
          style={{
            width: fit ? fit.w : undefined,
            height: fit ? fit.h : undefined,
            transform: fit ? `scale(${zoom})` : undefined,
            transformOrigin: '0 0',
            // No transition: the scroll compensation that keeps the anchored
            // point still is applied instantly, so an eased transform would
            // slide out of step with it and read as a wobble.
            willChange: 'transform',
            boxShadow: '0 18px 40px -18px rgba(43, 34, 21, 0.55)',
            filter: brightness ? `brightness(${brightness})` : undefined,
          }}
        />
      </div>
      {lens && lensOn && !zoomed && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none border"
          style={{
            width: LENS_SIZE,
            height: LENS_SIZE,
            left: lens.x - LENS_SIZE / 2,
            top: lens.y - LENS_SIZE / 2,
            borderColor: 'var(--border-medium)',
            boxShadow: '0 12px 32px -12px rgba(30,20,8,0.5)',
            // The lens magnifies the ALREADY-LOADED display image (the full-res
            // source can take seconds on first hover and reads as a blank box).
            background: `var(--bg-warm) url(${JSON.stringify(src)}) no-repeat`,
            backgroundSize: `${lens.bgW}px ${lens.bgH}px`,
            backgroundPosition: `${lens.bgX}px ${lens.bgY}px`,
          }}
        >
          {/* Its own magnification, so dialling it with the wheel is legible */}
          <span
            className="absolute bottom-0 right-0 px-1.5 py-0.5 font-sans text-[10px] tabular-nums"
            style={{ background: 'rgba(20,16,12,0.72)', color: '#fdfcf9' }}
          >
            {lensMag.toFixed(1)}×
          </span>
        </div>
      )}
    </div>
  );
}

/** Adjoining multi-toggle group on the ink bar (Scan / OCR / English). */
export function ViewToggleGroup({
  views, onToggle, compact = false, showTranslit = false,
}: {
  views: { scan: boolean; ocr: boolean; en: boolean; translit: boolean };
  onToggle: (key: 'scan' | 'ocr' | 'en' | 'translit') => void;
  compact?: boolean;
  /** Offer the romanisation chip — only for books in a non-Latin script. */
  showTranslit?: boolean;
}) {
  const items: Array<{ key: 'scan' | 'ocr' | 'en' | 'translit'; label: string }> = [
    { key: 'scan', label: 'Scan' },
    { key: 'ocr', label: 'OCR' },
    ...(showTranslit ? [{ key: 'translit' as const, label: 'Roman' }] : []),
    { key: 'en', label: 'English' },
  ];
  return (
    <div className="flex" role="group" aria-label="Visible panes">
      {items.map((it, i) => {
        const on = views[it.key];
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(it.key)}
            // Height is explicit so the group lines up with the pager beside
            // it; padding-derived heights drifted apart by a pixel or two.
            className={`font-sans text-[13px] flex items-center justify-center border transition-colors ${compact ? 'px-2.5 h-[36px]' : 'px-3 h-[36px]'}`}
            style={{
              borderColor: on ? onInk(0.3) : onInk(0.16),
              background: on ? onInk(0.14) : 'transparent',
              color: on ? '#fdfcf9' : onInk(0.5),
              marginLeft: i === 0 ? 0 : -1,
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** Theme attribute value for the reader root — reuses the existing reader themes. */
export function themeAttr(theme: ReaderSettings['theme']): string | undefined {
  if (theme === 'sepia') return 'sepia';
  if (theme === 'dark') return 'night';
  return undefined;
}

/** Book byline under the title in the top bars. */
export function bookByline(book: Book): string {
  const parts = [book.author, book.published].filter(Boolean);
  return parts.join(' · ');
}
