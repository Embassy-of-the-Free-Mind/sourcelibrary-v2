'use client';

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
      style={{
        ['--reader-font-size' as string]: `${fontSize}px`,
        ['--reader-line-height' as string]: settings.lineHeight,
        maxWidth: `${LINE_WIDTH_CH[settings.lineWidth]}ch`,
        marginInline: 'auto',
        color: 'var(--text-primary)',
        textWrap: 'pretty',
        ...(settings.typeface === 'sans'
          ? { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }
          : {}),
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

/** Centred page-break rule: ─── PAGE 8 ─── */
export function PageBreakMarker({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 mt-[52px] mb-8" aria-hidden="true">
      <span className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
      <CapsLabel style={{ color: 'var(--text-faint)', letterSpacing: '0.16em' }}>{label}</CapsLabel>
      <span className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
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

/** The scan image with its paper shadow. Fixed aspect placeholder while loading. */
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={display}
      alt={alt}
      className={`block max-w-full ${className}`}
      style={{
        boxShadow: '0 18px 40px -18px rgba(43, 34, 21, 0.55)',
        filter: (page as unknown as { display_brightness?: number }).display_brightness
          ? `brightness(${(page as unknown as { display_brightness?: number }).display_brightness})`
          : undefined,
      }}
      draggable={false}
    />
  );
}

/** 34×34 icon button on the ink bar. */
export function InkIconButton({
  label, onClick, href, children, active = false,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  const cls = 'w-[34px] h-[34px] flex items-center justify-center transition-colors';
  const style: React.CSSProperties = {
    color: active ? '#fdfcf9' : onInk(0.72),
    background: active ? onInk(0.14) : 'transparent',
  };
  if (href) {
    return (
      <a href={href} className={cls} style={style} title={label} aria-label={label}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = onInk(0.1); }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? onInk(0.14) : 'transparent'; }}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} style={style} title={label} aria-label={label} onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = onInk(0.1); }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? onInk(0.14) : 'transparent'; }}
    >
      {children}
    </button>
  );
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
