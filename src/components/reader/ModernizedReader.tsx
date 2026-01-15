'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Page } from '@/lib/types';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { pages as pagesApi } from '@/lib/api-client';

interface ModernizedReaderProps {
  pages: Page[];
  onPageVisible?: (pageNumber: number) => void;
}

// Simple markdown renderer for modernized text
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Remove any [[tags]]
    .replace(/\[\[[^\]]+\]\]/g, '')
    // Paragraphs (double newline)
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return html;
}

export default function ModernizedReader({
  pages,
  onPageVisible,
}: ModernizedReaderProps) {
  const [modernizedTexts, setModernizedTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentlyProcessing, setCurrentlyProcessing] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Initialize from existing page data
  useEffect(() => {
    const existing: Record<string, string> = {};
    for (const page of pages) {
      if (page.modernized?.data) {
        existing[page.id] = page.modernized.data;
      }
    }
    setModernizedTexts(existing);
  }, [pages]);

  // Setup intersection observer for page visibility tracking
  useEffect(() => {
    if (!onPageVisible) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNumber = parseInt(entry.target.getAttribute('data-page-number') || '0', 10);
            if (pageNumber) onPageVisible(pageNumber);
          }
        }
      },
      { threshold: 0.3 }
    );

    pageRefs.current.forEach((el) => observerRef.current?.observe(el));
    return () => observerRef.current?.disconnect();
  }, [onPageVisible, pages.length]);

  // Modernize all pages
  const modernizeAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const pagesWithTranslation = pages.filter(p => p.translation?.data);

    for (let i = 0; i < pagesWithTranslation.length; i++) {
      const page = pagesWithTranslation[i];

      // Skip if already modernized
      if (modernizedTexts[page.id]) continue;

      setCurrentlyProcessing(page.page_number);

      try {
        const data = await pagesApi.modernize(page.id);
        setModernizedTexts(prev => ({ ...prev, [page.id]: data.modernized }));
      } catch (err) {
        setError(`Failed on page ${page.page_number}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        break;
      }
    }

    setCurrentlyProcessing(null);
    setLoading(false);
  }, [pages, modernizedTexts]);

  // Count pages
  const pagesWithTranslation = pages.filter(p => p.translation?.data);
  const modernizedCount = Object.keys(modernizedTexts).length;
  const needsModernization = modernizedCount < pagesWithTranslation.length;
  const hasAnyTranslation = pagesWithTranslation.length > 0;

  return (
    <div className="space-y-6">
      {/* Action bar - only show if there are translations to modernize */}
      {hasAnyTranslation && needsModernization && !loading && (
        <div className="sticky top-0 z-10 bg-amber-50 border border-amber-200 rounded-lg p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-sm text-amber-800 text-center sm:text-left">
              {modernizedCount > 0
                ? `${modernizedCount} of ${pagesWithTranslation.length} pages modernized`
                : `${pagesWithTranslation.length} pages ready to modernize`
              }
            </div>
            <button
              onClick={modernizeAll}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 active:bg-amber-800 transition-colors text-sm font-medium min-h-[44px]"
            >
              <Sparkles className="w-4 h-4" />
              {modernizedCount > 0 ? 'Continue Modernizing' : 'Modernize for Reading'}
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="sticky top-0 z-10 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
            <span className="text-amber-800">
              {currentlyProcessing
                ? `Modernizing page ${currentlyProcessing}...`
                : 'Modernizing...'}
            </span>
          </div>
          <div className="mt-2 text-xs text-amber-600 text-center">
            {modernizedCount} of {pagesWithTranslation.length} complete
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-800 text-sm">{error}</p>
              <button
                onClick={modernizeAll}
                className="mt-2 text-sm text-red-700 underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="reading-content">
        {pages.map((page, index) => {
          const modernized = modernizedTexts[page.id];
          const translation = page.translation?.data;
          const textToShow = modernized || translation;

          if (!textToShow) {
            return (
              <div
                key={page.id}
                ref={(el) => { if (el) pageRefs.current.set(page.id, el); }}
                data-page-number={page.page_number}
                className="py-4 text-center text-stone-400 text-sm"
              >
                Page {page.page_number} — awaiting translation
              </div>
            );
          }

          return (
            <div
              key={page.id}
              ref={(el) => { if (el) pageRefs.current.set(page.id, el); }}
              data-page-number={page.page_number}
              className="relative"
            >
              {/* Page marker */}
              {index > 0 && (
                <div className="flex items-center gap-3 my-6 sm:my-8 text-stone-300">
                  <div className="flex-1 border-t border-stone-200" />
                  <span className="text-[10px] sm:text-xs font-medium">
                    {page.page_number}
                  </span>
                  <div className="flex-1 border-t border-stone-200" />
                </div>
              )}

              {/* Text content */}
              <div
                className={`
                  prose prose-stone max-w-none
                  prose-p:text-[15px] prose-p:sm:text-[17px]
                  prose-p:leading-[1.8] prose-p:sm:leading-[1.9]
                  prose-p:mb-4 prose-p:sm:mb-5
                  prose-strong:text-stone-900
                  prose-em:text-stone-700
                  ${!modernized ? 'opacity-60' : ''}
                `}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(textToShow) }}
              />

              {/* Indicator if showing original translation */}
              {!modernized && translation && (
                <div className="mt-2 text-xs text-stone-400 italic">
                  (Original translation — tap Modernize above for clearer reading)
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {pages.length === 0 && (
        <div className="text-center py-12 text-stone-500">
          <p>No pages in this section.</p>
        </div>
      )}
    </div>
  );
}
