import { CheckCircle2, GripVertical, Loader2, ImageIcon, FileText, RefreshCw } from 'lucide-react';
import type { Page } from '@/lib/types';

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
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  onPageToggle: (pageId: string, index: number, event: React.MouseEvent) => void;
  onSetCover: (page: Page) => void;
  onDragStart: (pageId: string) => void;
  onDragOver: (e: React.DragEvent, pageId: string) => void;
  onDragEnd: () => void;
  onLoadMore: () => void;
  getImageUrl: (page: Page) => string | null;
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
  loadMoreRef,
  onPageToggle,
  onSetCover,
  onDragStart,
  onDragOver,
  onDragEnd,
  onLoadMore,
  getImageUrl
}: PagesGridProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-stone-900">Pages</h2>
        <span className="text-sm text-stone-500">
          Showing {Math.min(visibleCount, pages.length)} of {pages.length}
        </span>
      </div>

      {pages.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-stone-200">
          <FileText className="w-12 h-12 text-stone-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-stone-600">No pages yet</h3>
          <p className="text-stone-400 text-sm mt-1">Upload pages to start processing</p>
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
                  <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 ${isDragOver ? 'border-blue-500 shadow-lg scale-105' : 'border-stone-200 hover:border-blue-300'
                    }`}>
                    {imageUrl && (
                      <img src={imageUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-cover pointer-events-none" />
                    )}
                    {/* Drag handle indicator */}
                    <div className="absolute top-1 left-1 p-1 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="w-3 h-3" />
                    </div>
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
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
                  <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 ${isSelected ? 'border-amber-500 shadow-md' : 'border-stone-200 hover:border-stone-300'
                    }`}>
                    {imageUrl && (
                      <img src={imageUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-cover" />
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-amber-600 drop-shadow" />
                      </div>
                    )}
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                      {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                    </div>
                  </div>
                  <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
                </button>
              );
            }

            return (
              <div key={page.id} className="group relative">
                <a href={`/book/${bookId}/page/${page.id}`}>
                  <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={`Page ${page.page_number}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    )}
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" title="OCR" />}
                      {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="Translated" />}
                      {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" title="Summarized" />}
                    </div>
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
