'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * The scan image with its paper shadow, rendered through the production
 * ImageWithMagnifier — hover reading lens, in-place pan/zoom controls, click
 * for the fullscreen viewer (the same affordances the current reader has).
 */
/** Plain scan image with the paper shadow — used in the stacked mobile layout. */
export function ScanImage({ page, book, className = '' }: { page: Page; book: Book; className?: string }) {
  const { display } = resolveScanUrls(page);
  const alt = `Scan of page ${page.page_number} of ${book.display_title || book.title}`;
  if (!display) {
    return (
      <div
        className={`w-full ${className}`}
        style={{ aspectRatio: '0.68', background: 'color-mix(in srgb, var(--bg-warm) 80%, var(--bg-dark))' }}
        role="img"
        aria-label={alt}
      />
    );
  }
  const brightness = (page as unknown as { display_brightness?: number }).display_brightness;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={display}
      alt={alt}
      className={`block max-w-full ${className}`}
      style={{
        boxShadow: '0 18px 40px -18px rgba(43, 34, 21, 0.55)',
        filter: brightness ? `brightness(${brightness})` : undefined,
      }}
      draggable={false}
    />
  );
}

export const SCAN_ZOOM_STEPS = [1, 1.5, 2.2, 3.2, 4.5];

/**
 * Desktop scan viewer. Zoom is CONTROLLED FROM OUTSIDE (the pane header's
 * −/+/reset buttons) — no controls overlay the scan itself. When zoomed,
 * drag pans (clamped to the image), double-click toggles 2.2×, and the
 * high-resolution source swaps in for sharpness.
 */
const LENS_SIZE = 220;
const LENS_MAG = 2.4;

export function ScanViewer({ page, book, zoom, onZoomChange }: {
  page: Page;
  book: Book;
  zoom: number;
  onZoomChange: (z: number) => void;
}) {
  const { display, native } = resolveScanUrls(page);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Hover reading lens (magnifier) — active at 100% only; pan/zoom takes over past that
  const [lens, setLens] = useState<{ x: number; y: number; bgX: number; bgY: number; bgW: number; bgH: number } | null>(null);

  const updateLens = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const r = img.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
      setLens(null);
      return;
    }
    const cr = container.getBoundingClientRect();
    const relX = (clientX - r.left) / r.width;
    const relY = (clientY - r.top) / r.height;
    setLens({
      x: clientX - cr.left,
      y: clientY - cr.top,
      bgW: r.width * LENS_MAG,
      bgH: r.height * LENS_MAG,
      bgX: -(relX * r.width * LENS_MAG - LENS_SIZE / 2),
      bgY: -(relY * r.height * LENS_MAG - LENS_SIZE / 2),
    });
  }, []);

  // New page or zoom back to 1 → recenter (state adjusted during render,
  // per the React "derive state from props" pattern — no effect needed)
  const [prevPageId, setPrevPageId] = useState(page.id);
  const [prevZoom, setPrevZoom] = useState(zoom);
  if (prevPageId !== page.id) {
    setPrevPageId(page.id);
    setPan({ x: 0, y: 0 });
  }
  if (prevZoom !== zoom) {
    setPrevZoom(zoom);
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }

  const clampPan = useCallback((x: number, y: number, scale: number) => {
    const el = containerRef.current;
    const img = el?.querySelector('img');
    if (!el || !img) return { x, y };
    const maxX = Math.max(0, (img.clientWidth * scale - el.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * scale - el.clientHeight) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) {
      setPan(clampPan(d.panX + (e.clientX - d.startX), d.panY + (e.clientY - d.startY), zoom));
      return;
    }
    // Reading lens at 100%, mouse only (touch gets pinch-free plain view)
    if (zoom === 1 && e.pointerType === 'mouse') {
      updateLens(e.clientX, e.clientY);
    } else if (lens) {
      setLens(null);
    }
  };
  const endDrag = () => { dragRef.current = null; setDragging(false); };

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
      className="h-full w-full overflow-hidden flex items-center justify-center select-none"
      style={{
        cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={() => { endDrag(); setLens(null); }}
      onDoubleClick={() => onZoomChange(zoom > 1 ? 1 : 2.2)}
      role="img"
      aria-label={alt}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="max-h-full max-w-full object-contain"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: dragging ? 'none' : 'transform 0.18s ease-out',
          boxShadow: '0 18px 40px -18px rgba(43, 34, 21, 0.55)',
          filter: brightness ? `brightness(${brightness})` : undefined,
        }}
      />
      {lens && zoom === 1 && (
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
            background: `#fff url(${JSON.stringify(native || display)}) no-repeat`,
            backgroundSize: `${lens.bgW}px ${lens.bgH}px`,
            backgroundPosition: `${lens.bgX}px ${lens.bgY}px`,
          }}
        />
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
