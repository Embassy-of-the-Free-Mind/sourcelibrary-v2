'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';
import { getPageDisplayUrl, getPageThumbUrl } from '@/lib/utils';
import { getPageImageUrl } from '@/lib/page-image-url';
import type { Book, Page } from '@/lib/types';
import type { CdliWitness } from '@/lib/types/book';
import type { CorpusInfo } from '@/lib/text-provenance';
import type { ReaderSettings } from './useReaderV2';
import { PaneEmptyState } from './PaneEmptyState';

// Shared presentational pieces for the v2 reader design previews. All values
// map to existing Source Library tokens (globals.css) — no new primitives.
// Labels are letterspaced Inter caps (house style; the site sets no monospace).

/** Ink-bar foreground: cream at a given opacity (on --bg-dark surfaces). */
export function onInk(opacity: number): string {
  return `rgba(253, 252, 249, ${opacity})`;
}

/** Pane surfaces, composed from the existing palette via color-mix. */
export const SURFACE = {
  // Was 90/10 against the ink, which read as a grey slab under a bright
  // facsimile. Lighter, so the scan is the darkest thing in its own pane and
  // the bed reads as a mount rather than a shadow.
  scanBed: 'color-mix(in srgb, var(--bg-warm) 96%, var(--bg-dark))',
  ocr: 'color-mix(in srgb, var(--bg-cream) 45%, var(--bg-warm))',
  translation: 'var(--bg-cream)',
  // Back to warm paper. White made the drawers colder than the book without
  // making them read as chrome — the separation comes from the tinted header
  // and the shadow at the drawer's edge, not from bleaching the body.
  panel: 'var(--bg-warm)',
  popover: 'var(--bg-white)',
} as const;

export function CapsLabel({ children, className = '', style, as, id }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
  /**
   * Render as a heading where the label really is one. The reader shipped with
   * no h1-h6 anywhere, so heading navigation — the main way a screen-reader
   * user orients on a page — returned nothing at all. The look is unchanged.
   */
  as?: 'span' | 'h1' | 'h2';
  id?: string;
}) {
  const Tag = as || 'span';
  return (
    <Tag
      id={id}
      className={`font-sans text-[10.5px] font-medium uppercase tracking-[0.15em] ${className}`}
      style={style}
    >
      {children}
    </Tag>
  );
}

/**
 * A label, not a control. It used to wear a border and sit in a row of
 * bordered chips, where it read as a button you could press.
 */
export function AiChip({ short = false }: { short?: boolean }) {
  const t = getReaderStrings(useLocale()).panes;
  return (
    <span
      className="font-sans text-[10px] font-medium uppercase tracking-[0.12em]"
      style={{ color: 'var(--text-faint)' }}
      title={t.aiTitle}
    >
      {short ? t.aiShort : t.aiTranslated}
    </span>
  );
}

/**
 * The corpus counterpart of AiChip (#4350): this translation is the corpus
 * editors' scholarly work — labelling it "AI" (or leaving it unlabelled next
 * to panes that are) misattributes a human translation to a machine.
 */
export function CorpusChip({ corpus }: { corpus: CorpusInfo }) {
  const t = getReaderStrings(useLocale()).panes;
  return (
    <span
      className="font-sans text-[10px] font-medium uppercase tracking-[0.12em]"
      style={{ color: 'var(--text-faint)' }}
      title={t.corpusChipTitle(corpus.name)}
    >
      {t.corpusChip(corpus.shortName)}
    </span>
  );
}

/**
 * Caption bar under a tablet-witness photograph in the scan pane (#4350).
 * Names the tablet, offers the carousel when the composition survives on
 * several, and — the part that must never be implied away — says the text
 * follows the corpus edition rather than this photograph.
 */
export function WitnessCaption({ witness, index, total, onPrev, onNext, corpus }: {
  witness: CdliWitness;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  corpus: CorpusInfo | null;
}) {
  const t = getReaderStrings(useLocale()).panes;
  const detail = [witness.designation, witness.museum, witness.period].filter(Boolean).join(' · ');
  return (
    <div
      className="absolute bottom-0 left-0 right-0 px-4 py-2 flex items-center gap-3 border-t"
      style={{
        background: 'color-mix(in srgb, var(--bg-warm) 92%, transparent)',
        borderColor: 'var(--border-light)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-sans text-[11.5px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {detail}
          {witness.cdli_url && (
            <>
              {' · '}
              <a href={witness.cdli_url} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent-rust)' }}>
                {t.viewOnCdli}
              </a>
            </>
          )}
        </p>
        <p className="font-sans text-[10.5px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
          {t.witnessNotSource(corpus?.shortName || 'corpus')}
        </p>
      </div>
      {total > 1 && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPrev}
            aria-label={t.prevWitness}
            className="w-7 h-7 flex items-center justify-center border transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="font-sans text-[10.5px] tabular-nums px-1" style={{ color: 'var(--text-muted)' }}>
            {t.witnessCount(index + 1, total)}
          </span>
          <button
            type="button"
            onClick={onNext}
            aria-label={t.nextWitness}
            className="w-7 h-7 flex items-center justify-center border transition-colors hover:bg-[var(--bg-white)]"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
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

  // An empty pane is several different situations wearing one sentence: a page
  // nobody has transcribed, a page transcribed but not translated, a blank
  // flyleaf. They call for different words and, for one of them, a way to ask
  // for the translation.
  if (!text) {
    return <PaneEmptyState page={page} book={book} kind={kind} />;
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
  // Not raw archived_photo. That is the unprocessed original, so on a book
  // whose pages were split from spreads it is the WHOLE SPREAD: the scan
  // silently swapped to the neighbouring page's image past 1.5x zoom, in the
  // lightbox and in the download. getPageImageUrl('hires') applies the crop
  // and the bounded proxy the rest of the site uses.
  const native = getPageImageUrl(page as unknown as Record<string, unknown>, 'hires') || display;
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
  srcOverride, altOverride,
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
  /**
   * Show this URL instead of the page's own image — a CDLI tablet-witness
   * photograph standing in for a scan that does not exist (#4350). A raw,
   * CSP-allowlisted URL, deliberately NOT routed through resolveScanUrls:
   * cdli.earth is browser-renderable but not on the /api/image proxy
   * allowlist, so the display-tier resolver could hand back a guaranteed 400.
   */
  srcOverride?: string;
  /** Alt text to pair with srcOverride — the default alt describes a scan. */
  altOverride?: string;
}) {
  const t = getReaderStrings(useLocale()).panes;
  const resolved = resolveScanUrls(page);
  const display = srcOverride ?? resolved.display;
  const native = srcOverride ?? resolved.native;
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

  const alt = altOverride ?? t.scanAlt(page.page_number, book.display_title || book.title);
  if (!display) {
    // Words, not a bare block: a silent placeholder reads as an image that
    // failed to load, when the truth is that no image exists (#4350).
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div
          className="h-[80%] flex items-center justify-center px-6 text-center"
          style={{ aspectRatio: '0.68', background: 'color-mix(in srgb, var(--bg-warm) 80%, var(--bg-dark))' }}
        >
          <span className="font-sans text-[12px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            {t.noFacsimile}
          </span>
        </div>
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

/**
 * One button vocabulary for every control on the ink bar: the book title, the
 * view toggles, the pager. They had drifted into three different treatments
 * (two heights, two border strengths, hover on some and not others), which is
 * why a row of controls that do comparable things did not read as a set.
 *
 * The shape is fixed here and the state is the only thing that varies. Idle
 * sits back, hover brings the fill and the label up together, and the pressed
 * state goes brighter still with a full-strength border, so the three levels
 * are legible without any of them shouting.
 */
export const BAR_CONTROL =
  'h-9 flex items-center justify-center border font-sans text-[13px] whitespace-nowrap '
  + 'transition-[background-color,border-color,color] duration-150 ease-out '
  + 'hover:bg-[rgba(253,252,249,0.13)] hover:text-[#fdfcf9] hover:border-[rgba(253,252,249,0.28)] '
  + 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(253,252,249,0.5)] focus-visible:ring-offset-0';

/** Idle and pressed fills for `BAR_CONTROL`. */
export function barControlStyle(on = false) {
  return {
    borderColor: on ? onInk(0.32) : onInk(0.16),
    background: on ? onInk(0.16) : onInk(0.06),
    color: on ? '#fdfcf9' : onInk(0.62),
  } as const;
}

/**
 * Modal plumbing shared by the reader's two dialogs (the site menu and the
 * full-screen scan). Both declared `aria-modal="true"` and did none of what
 * that promises: focus stayed on a button the dialog had just hidden from
 * assistive technology, Tab walked out into the reader behind, and closing
 * dropped focus on `<body>` so a keyboard reader lost their place entirely.
 *
 * Also stamps `data-reader-modal-open` on the document, which is how the
 * hook's arrow-key handler knows not to turn the page underneath an open
 * dialog.
 */
export function useDialogFocus(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    // Focus the first control rather than the container: a container with
    // tabindex reads as an empty group before the reader hears anything useful.
    root?.querySelector<HTMLElement>(sel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(sel))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.documentElement.setAttribute('data-reader-modal-open', '');
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.removeAttribute('data-reader-modal-open');
      opener?.focus?.();
    };
  }, [ref, onClose]);
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
  const t = getReaderStrings(useLocale()).panes;
  const items: Array<{ key: 'scan' | 'ocr' | 'en' | 'translit'; label: string }> = [
    { key: 'scan', label: t.viewScan },
    { key: 'ocr', label: t.viewOcr },
    ...(showTranslit ? [{ key: 'translit' as const, label: t.viewRoman }] : []),
    { key: 'en', label: t.viewEnglish },
  ];
  return (
    <div className="flex" role="group" aria-label={t.visiblePanesAria}>
      {items.map((it, i) => {
        const on = views[it.key];
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(it.key)}
            className={`${BAR_CONTROL} ${compact ? 'px-2.5' : 'px-3'}`}
            style={{ ...barControlStyle(on), marginLeft: i === 0 ? 0 : -1 }}
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
