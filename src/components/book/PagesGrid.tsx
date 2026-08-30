'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, GripVertical, Loader2, ImageIcon, FileText, RefreshCw, LayoutGrid } from 'lucide-react';
import type { Page } from '@/lib/types';
import { AuthCheck } from '@/components/auth/AuthCheck';
import { useEmbedHref } from '@/lib/EmbedContext';
import { useLocale, useLocalePath } from '@/lib/i18n';
import { BOOK_STRINGS } from '@/lib/book-i18n';

/**
 * Card body for a page that HAS no image (#4350) — corpus text editions,
 * mostly. A static state, deliberately not the shimmer: the shimmer promises
 * an image that is loading, and on these pages nothing will ever arrive.
 */
function TextPageCard({ natural }: { natural?: boolean }) {
  return (
    <div className={`${natural ? 'w-full aspect-[3/4]' : 'absolute inset-0'} flex items-center justify-center bg-stone-100`}>
      <FileText className="w-5 h-5 text-stone-300" />
    </div>
  );
}

function PageImage({ src, alt, className, natural }: { src: string; alt: string; className?: string; natural?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <>
      {/* Placeholder reserves space. In `natural` mode it's a block (a 3:4
          guess) so the grid has height before load; otherwise it fills the box. */}
      {!loaded && (
        <div className={`${natural ? 'w-full aspect-[3/4]' : 'absolute inset-0'} bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer`} />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`w-full ${natural ? 'h-auto block' : 'h-full object-contain'} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0 hidden'} ${className || ''}`}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

interface PagesGridProps {
  pages: Page[];
  bookId: string;
  /** Slug (or id fallback) for building page hrefs — keeps grid links on the
      canonical /book/<slug>/... URL instead of minting hex-id duplicates (#2266). */
  bookPath?: string;
  batchMode: boolean;
  reorderMode: boolean;
  selectedPages: Set<string>;
  settingCover: string | null;
  visibleCount: number;
  totalCount?: number;
  draggedPageId: string | null;
  dragOverPageId: string | null;
  brightness?: number;
  onPageToggle: (pageId: string, index: number, event: React.MouseEvent) => void;
  onSetCover: (page: Page) => void;
  onDragStart: (pageId: string) => void;
  onDragOver: (e: React.DragEvent, pageId: string) => void;
  onDragEnd: () => void;
  onLoadMore: () => void;
  getImageUrl: (page: Page) => string | null;
  overviewHref?: string;
  subtitle?: string;
  /**
   * Stand-in images for pages that have none (#4350): CDLI tablet-witness
   * photos on corpus editions, cycled across the cards. Serializable — this
   * crosses the server→client boundary from the book page.
   */
  fallbackImages?: Array<{ src: string; alt: string }>;
}

export default function PagesGrid({
  pages,
  bookId,
  bookPath,
  batchMode,
  reorderMode,
  selectedPages,
  settingCover,
  visibleCount,
  draggedPageId,
  dragOverPageId,
  brightness,
  onPageToggle,
  onSetCover,
  onDragStart,
  onDragOver,
  onDragEnd,
  onLoadMore,
  getImageUrl,
  totalCount,
  overviewHref,
  subtitle,
  fallbackImages,
}: PagesGridProps) {
  const fallbackFor = (index: number) =>
    fallbackImages && fallbackImages.length > 0 ? fallbackImages[index % fallbackImages.length] : null;
  const embedHref = useEmbedHref();
  // The grid takes its language and its URL prefix from the page it is mounted
  // on: /es/book/… renders Spanish chrome and keeps /es on every page link.
  const t = BOOK_STRINGS[useLocale()];
  const localePath = useLocalePath();
  const displayTotal = totalCount || pages.length;
  // CSS brightness filter — only apply when not default (1.0)
  const brightnessStyle = brightness && brightness !== 1.0
    ? { filter: `brightness(${brightness})` }
    : undefined;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h2 className="font-display font-medium text-2xl md:text-[28px]" style={{ color: 'var(--text-primary)' }}>{t.pagesHeading}</h2>
        <span className="text-sm text-stone-500 whitespace-nowrap">
          {t.pagesShownOf(Math.min(visibleCount, pages.length), displayTotal)}
        </span>
      </div>
      {subtitle && <p className="text-sm md:text-[15px] mb-6" style={{ color: '#8a8170' }}>{subtitle}</p>}

      {pages.length === 0 ? (
        <div className="text-center py-16 card">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--bg-warm)' }}>
            <FileText className="w-8 h-8" style={{ color: 'var(--text-faint)' }} />
          </div>
          <h3 className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>{t.noPagesYet}</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Upload pages to start processing</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-10 gap-2 sm:gap-2 items-start">
          {pages.slice(0, visibleCount).map((page, index) => {
            const isSelected = selectedPages.has(page.id);
            const imageUrl = getImageUrl(page);
            const fallback = imageUrl ? null : fallbackFor(index);
            // Check updated_at since data is excluded from projection for performance
            const hasOcr = !!page.ocr?.updated_at;
            const hasTranslation = !!page.translation?.updated_at;
            const hasSummary = !!page.summary?.updated_at;

            // Reorder mode - draggable pages
            if (reorderMode) {
              const isDragging = draggedPageId === page.id;
              const isDragOver = dragOverPageId === page.id;

              return (
                <div
                  key={page.id}
                  draggable
                  onDragStart={() => onDragStart(page.id)}
                  onDragOver={(e) => onDragOver(e, page.id)}
                  onDragEnd={onDragEnd}
                  className={`group relative cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
                >
                  <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 relative ${isDragOver ? 'border-blue-500 shadow-lg scale-105' : 'border-stone-200 hover:border-blue-300'
                    }`} style={brightnessStyle}>
                    {imageUrl ? (
                      <PageImage src={imageUrl} alt={`Page ${page.page_number}`} className="pointer-events-none" />
                    ) : fallback ? (
                      <PageImage src={fallback.src} alt={fallback.alt} className="pointer-events-none" />
                    ) : (
                      <TextPageCard />
                    )}
                    {/* Drag handle indicator */}
                    <div className="absolute top-1 left-1 p-1 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="w-3 h-3" />
                    </div>
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-status-success" />}
                      {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                    </div>
                  </div>
                  <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
                </div>
              );
            }

            if (batchMode) {
              return (
                <button
                  key={page.id}
                  onClick={(e) => onPageToggle(page.id, index, e)}
                  className="group relative text-left"
                >
                  <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 relative ${isSelected ? 'border-accent-gold shadow-md' : 'border-stone-200 hover:border-stone-300'
                    }`} style={brightnessStyle}>
                    {imageUrl ? (
                      <PageImage src={imageUrl} alt={`Page ${page.page_number}`} />
                    ) : fallback ? (
                      <PageImage src={fallback.src} alt={fallback.alt} />
                    ) : (
                      <TextPageCard />
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-accent-gold/15 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-accent-rust drop-shadow" />
                      </div>
                    )}
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-status-success" />}
                      {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                    </div>
                  </div>
                  <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
                </button>
              );
            }

            return (
              <div key={page.id} className="group relative">
                <a
                  href={localePath(embedHref(`/book/${bookPath || bookId}/page/${page.id}`))}
                >
                  <div className="bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow relative" style={brightnessStyle}>
                    {imageUrl ? (
                      <PageImage src={imageUrl} alt={`Page ${page.page_number}`} natural className="group-hover:scale-105 transition-transform duration-200" />
                    ) : fallback ? (
                      <PageImage src={fallback.src} alt={fallback.alt} natural className="group-hover:scale-105 transition-transform duration-200" />
                    ) : (
                      <TextPageCard natural />
                    )}
                  </div>
                </a>
                {/* Set as Cover button — admin and inner circle */}
                <AuthCheck role="inner_circle">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSetCover(page);
                    }}
                    disabled={settingCover === page.id}
                    className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 disabled:opacity-50"
                    title="Set as cover image"
                  >
                    {settingCover === page.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ImageIcon className="w-3 h-3" />
                    )}
                  </button>
                </AuthCheck>
                <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more, then Overview stacked below it — both white-on-black. */}
      {(visibleCount < displayTotal || overviewHref) && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {visibleCount < displayTotal && (
            <button
              onClick={onLoadMore}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              {t.loadMore(displayTotal - visibleCount)}
            </button>
          )}
          {overviewHref && (
            <a
              href={localePath(embedHref(overviewHref))}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors text-sm font-medium"
            >
              <LayoutGrid className="w-4 h-4" />
              {t.overview}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
