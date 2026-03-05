import { useState, useRef, useCallback } from 'react';
import { CheckCircle2, GripVertical, Loader2, ImageIcon, FileText, RefreshCw } from 'lucide-react';
import type { Page } from '@/lib/types';

function PageImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${className || ''}`}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

interface PagesGridProps {
  pages: Page[];
  bookId: string;
  batchMode: boolean;
  reorderMode: boolean;
  selectedPages: Set<string>;
  settingCover: string | null;
  visibleCount: number;
  draggedPageId: string | null;
  dragOverPageId: string | null;
  brightness?: number;
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  onPageToggle: (pageId: string, index: number, event: React.MouseEvent) => void;
  onSetCover: (page: Page) => void;
  onDragStart: (pageId: string) => void;
  onDragOver: (e: React.DragEvent, pageId: string) => void;
  onDragEnd: () => void;
  onLoadMore: () => void;
  getImageUrl: (page: Page) => string | null;
  onPageClick?: () => boolean; // Beta gate interceptor: return false to block navigation
}

const PAGES_PER_LOAD = 24;

export default function PagesGrid({
  pages,
  bookId,
  batchMode,
  reorderMode,
  selectedPages,
  settingCover,
  visibleCount,
  draggedPageId,
  dragOverPageId,
  brightness,
  loadMoreRef,
  onPageToggle,
  onSetCover,
  onDragStart,
  onDragOver,
  onDragEnd,
  onLoadMore,
  getImageUrl,
  onPageClick
}: PagesGridProps) {
  // CSS brightness filter — only apply when not default (1.0)
  const brightnessStyle = brightness && brightness !== 1.0
    ? { filter: `brightness(${brightness})` }
    : undefined;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Pages</h2>
        <span className="text-sm text-stone-500">
          Showing {Math.min(visibleCount, pages.length)} of {pages.length}
        </span>
      </div>

      {pages.length === 0 ? (
        <div className="text-center py-16 card">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--bg-warm)' }}>
            <FileText className="w-8 h-8" style={{ color: 'var(--text-faint)' }} />
          </div>
          <h3 className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>No pages yet</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Upload pages to start processing</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
          {pages.slice(0, visibleCount).map((page, index) => {
            const isSelected = selectedPages.has(page.id);
            const imageUrl = getImageUrl(page);
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
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
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
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
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
                  href={`/book/${bookId}/page/${page.id}`}
                  onClick={onPageClick ? (e) => {
                    const allowed = onPageClick();
                    if (!allowed) e.preventDefault();
                  } : undefined}
                >
                  <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow relative" style={brightnessStyle}>
                    {imageUrl ? (
                      <PageImage src={imageUrl} alt={`Page ${page.page_number}`} className="group-hover:scale-105 transition-transform duration-200" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
                    )}
                    {(hasOcr || hasTranslation || hasSummary) && (
                      <div className="absolute bottom-1 right-1 flex gap-0.5 bg-black/40 rounded-full px-1 py-0.5">
                        {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="OCR" />}
                        {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-400" title="Translated" />}
                        {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-400" title="Summarized" />}
                      </div>
                    )}
                  </div>
                </a>
                {/* Set as Cover button */}
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
                <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load More - auto-loads when scrolled into view */}
      {visibleCount < pages.length && (
        <div ref={loadMoreRef} className="mt-6 text-center">
          <button
            onClick={onLoadMore}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 hover:border-stone-400 transition-colors text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Load more ({pages.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
