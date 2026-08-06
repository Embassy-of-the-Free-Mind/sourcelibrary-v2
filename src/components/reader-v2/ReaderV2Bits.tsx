'use client';

import { useEffect, useRef, useState } from 'react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import { getPageDisplayUrl, getPageThumbUrl } from '@/lib/utils';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import type { Book, Page } from '@/lib/types';
import { MoreHorizontal, Check } from 'lucide-react';
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
 * Reading text for one pane of one page — OCR or translation — rendered
 * through the production NotesRenderer pipeline (wrapper stripping, inline
 * gloss/term/margin tags, RTL, columns). Reading settings arrive as scale
 * factors over each variant's base size.
 */
export function ReaderProse({
  page, book, kind, settings, baseSize,
}: {
  page: Page;
  book: Book;
  kind: 'ocr' | 'translation';
  settings: ReaderSettings;
  baseSize: number;
}) {
  const text = kind === 'ocr' ? (page.ocr?.data || '') : (page.translation?.data || '');
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

// Fine steps: a facsimile is read at the size the type happens to need, so
// the jumps stay small rather than doubling.
export const SCAN_ZOOM_STEPS = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.3, 2.6, 3, 3.5, 4, 4.7, 5.3, 6];
export const SCAN_ZOOM_MAX = 6;

const LENS_SIZE = 220;
const LENS_MAG_MIN = 1.5;
const LENS_MAG_MAX = 6;

/**
 * The scan surface.
 *
 * At 100% the page is fitted and static. Past 100% it becomes a real SCROLLER
 * rather than a transformed image: the scan is laid out at `zoom × pane width`
 * and the pane scrolls it. That is what lets a reader zoom into the type and
 * then travel down the page beside the translation, and it is what makes
 * scroll-syncing the scan to the text possible at all, since there is now a
 * genuine scrollTop to share. Dragging pans, two fingers pinch, and the
 * reading lens (a separate control) magnifies a spot at 100%.
 */
export function ScanViewer({
  page, book, zoom, onZoomChange, lensOn = false, scrollRef, onScroll,
}: {
  page: Page;
  book: Book;
  zoom: number;
  onZoomChange: (z: number) => void;
  /** Reading lens: off by default, toggled from the pane header. */
  lensOn?: boolean;
  /** The scroller, exposed so the reader can sync it with the text panes. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
}) {
  const { display, native } = resolveScanUrls(page);
  const localRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollRef ?? localRef;
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState(false);
  const [lens, setLens] = useState<{ x: number; y: number; bgX: number; bgY: number; bgW: number; bgH: number } | null>(null);
  // The lens has its own magnification, dialled with the wheel while it is up.
  const [lensMag, setLensMag] = useState(2.4);
  const lastLensPoint = useRef<{ x: number; y: number } | null>(null);

  const zoomed = zoom > 1;

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
      const next = Math.min(LENS_MAG_MAX, Math.max(LENS_MAG_MIN, lensMag * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      setLensMag(next);
      const at = lastLensPoint.current;
      if (at) updateLens(at.x, at.y, next);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const next = Math.min(SCAN_ZOOM_MAX, Math.max(1, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      onZoomChange(Math.round(next * 100) / 100);
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
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom };
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
    // Two fingers: pinch to zoom, continuously.
    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const next = Math.min(SCAN_ZOOM_MAX, Math.max(1, pinchRef.current.zoom * (dist / pinchRef.current.dist)));
      onZoomChange(Math.round(next * 100) / 100);
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
  const src = zoom > 1.5 && native ? native : display;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={`relative h-full w-full select-none ${zoomed ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`}
      style={{
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
      onDoubleClick={() => onZoomChange(zoomed ? 1 : 2.2)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className={zoomed ? 'block max-w-none' : 'max-h-full max-w-full object-contain'}
        style={{
          width: zoomed ? `${zoom * 100}%` : undefined,
          height: zoomed ? 'auto' : undefined,
          boxShadow: '0 18px 40px -18px rgba(43, 34, 21, 0.55)',
          filter: brightness ? `brightness(${brightness})` : undefined,
        }}
      />
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

export interface PaneMenuItem {
  label: string;
  onClick?: () => void;
  href?: string;
  /** Static informational row (model name, language) — not clickable */
  info?: string;
}

/**
 * The `⋯` menu on a pane/bar: copy text, provenance info, links into the
 * current reader for flows the preview doesn't duplicate (Trace, Edit).
 */
export function PaneMenu({ items, onInkBar = false }: { items: PaneMenuItem[]; onInkBar?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="More options"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-[30px] h-[30px] flex items-center justify-center"
        style={{ color: onInkBar ? onInk(0.72) : 'var(--text-muted)' }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-[240px] border z-50 py-1 rv2-pop"
          style={{
            background: SURFACE.popover, borderColor: 'var(--border-medium)',
            boxShadow: '0 28px 60px -18px rgba(30,20,8,0.45)',
          }}
          role="menu"
        >
          {items.map((it, i) => {
            if (it.info !== undefined) {
              return (
                <div key={i} className="px-3.5 py-1.5 flex items-baseline justify-between gap-3 font-sans text-[12px]">
                  <span style={{ color: 'var(--text-faint)' }}>{it.label}</span>
                  <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{it.info}</span>
                </div>
              );
            }
            const cls = 'w-full flex items-center justify-between gap-2 text-left px-3.5 py-2 font-sans text-[13px] hover:bg-[var(--bg-warm)] no-underline';
            const style = { color: 'var(--text-secondary)' };
            if (it.href) {
              return (
                <a key={i} href={it.href} className={cls} style={style} role="menuitem">{it.label}</a>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={cls}
                style={style}
                onClick={() => {
                  it.onClick?.();
                  setCopiedIdx(i);
                  setTimeout(() => { setCopiedIdx(null); setOpen(false); }, 700);
                }}
              >
                {it.label}
                {copiedIdx === i && <Check size={13} style={{ color: 'var(--accent-rust)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Menu items shared by both variants for a page's text panes. */
export function buildTextMenuItems(
  page: Page, book: Book, kind: 'ocr' | 'translation', readerHref: string,
): PaneMenuItem[] {
  const data = kind === 'ocr' ? page.ocr : page.translation;
  const items: PaneMenuItem[] = [];
  if (data?.data) {
    items.push({
      label: `Copy ${kind === 'ocr' ? 'transcription' : 'translation'} text`,
      onClick: () => { navigator.clipboard?.writeText(stripEditorialWrappers(data.data).trim()); },
    });
  }
  if (data?.model) items.push({ label: 'Model', info: data.model });
  if (data?.language || (kind === 'ocr' && book.language)) {
    items.push({ label: 'Language', info: (data?.language || book.language) as string });
  }
  items.push({ label: 'Trace mode (current reader)', href: readerHref });
  return items;
}

/** Adjoining multi-toggle group on the ink bar (Scan / OCR / English). */
export function ViewToggleGroup({
  views, onToggle, compact = false,
}: {
  views: { scan: boolean; ocr: boolean; en: boolean };
  onToggle: (key: 'scan' | 'ocr' | 'en') => void;
  compact?: boolean;
}) {
  const items: Array<{ key: 'scan' | 'ocr' | 'en'; label: string }> = [
    { key: 'scan', label: 'Scan' },
    { key: 'ocr', label: 'OCR' },
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
            className={`font-sans text-[13px] ${compact ? 'px-2.5 py-1.5' : 'px-3 py-[7px]'} border transition-colors`}
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
