'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Page } from '@/lib/types';
import { Loader2, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';

interface ModernizedReaderProps {
  pages: Page[];
  onPageVisible?: (pageNumber: number) => void;
}

interface PageState {
  modernized: string | null;
  loading: boolean;
  error: string | null;
  isStale: boolean;
}

export default function ModernizedReader({
  pages,
  onPageVisible,
}: ModernizedReaderProps) {
  const [pageStates, setPageStates] = useState<Record<string, PageState>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Initialize page states from existing data
  useEffect(() => {
    const initialStates: Record<string, PageState> = {};
    for (const page of pages) {
      initialStates[page.id] = {
        modernized: page.modernized?.data || null,
        loading: false,
        error: null,
        isStale: false,
      };
    }
    setPageStates(initialStates);
  }, [pages]);

  // Setup intersection observer for page visibility tracking
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNumber = parseInt(entry.target.getAttribute('data-page-number') || '0', 10);
            if (pageNumber && onPageVisible) {
              onPageVisible(pageNumber);
            }
          }
        }
      },
      { threshold: 0.5 }
    );

    // Observe all page elements
    pageRefs.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [onPageVisible, pages]);

  // Modernize a single page
  const modernizePage = useCallback(async (pageId: string, regenerate = false) => {
    setPageStates(prev => ({
      ...prev,
      [pageId]: { ...prev[pageId], loading: true, error: null }
    }));

    try {
      const response = await fetch(`/api/pages/${pageId}/modernize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to modernize');
      }

      const data = await response.json();
      setPageStates(prev => ({
        ...prev,
        [pageId]: {
          modernized: data.modernized,
          loading: false,
          error: null,
          isStale: false,
        }
      }));
    } catch (err) {
      setPageStates(prev => ({
        ...prev,
        [pageId]: {
          ...prev[pageId],
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to modernize',
        }
      }));
    }
  }, []);

  // Modernize all pages in section
  const modernizeAll = useCallback(async () => {
    setGeneratingAll(true);

    // Process pages sequentially to maintain context continuity
    for (const page of pages) {
      const state = pageStates[page.id];
      if (!state?.modernized && page.translation?.data) {
        await modernizePage(page.id);
      }
    }

    setGeneratingAll(false);
  }, [pages, pageStates, modernizePage]);

  // Check if we have any pages that need modernization
  const needsModernization = pages.some(
    p => !pageStates[p.id]?.modernized && p.translation?.data
  );

  // Check if any pages are missing translation
  const missingTranslation = pages.some(p => !p.translation?.data);

  return (
    <div className="space-y-8">
      {/* Modernize all button */}
      {needsModernization && !generatingAll && (
        <div className="flex items-center justify-center p-4 bg-amber-50 rounded-lg border border-amber-200">
          <button
            onClick={modernizeAll}
            className="inline-flex items-center gap-2 px-4 py-3 sm:py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 active:bg-amber-800 transition-colors text-sm sm:text-base min-h-[44px]"
          >
            <Sparkles className="w-4 h-4" />
            Modernize All Pages
          </button>
        </div>
      )}

      {/* Generating all indicator */}
      {generatingAll && (
        <div className="flex items-center justify-center p-4 bg-amber-50 rounded-lg border border-amber-200">
          <Loader2 className="w-5 h-5 animate-spin text-amber-600 mr-2" />
          <span className="text-amber-800 text-sm sm:text-base">Modernizing pages...</span>
        </div>
      )}

      {/* Missing translation warning */}
      {missingTranslation && (
        <div className="flex items-start gap-3 p-4 bg-stone-100 rounded-lg text-stone-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span className="text-sm">Some pages need translations first.</span>
        </div>
      )}

      {/* Page content */}
      {pages.map((page, index) => {
        const state = pageStates[page.id] || { modernized: null, loading: false, error: null, isStale: false };
        const hasTranslation = !!page.translation?.data;

        return (
          <div
            key={page.id}
            ref={(el) => {
              if (el) pageRefs.current.set(page.id, el);
            }}
            data-page-number={page.page_number}
            className="relative"
          >
            {/* Page divider (except first page) */}
            {index > 0 && (
              <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6 text-stone-400">
                <div className="flex-1 border-t border-stone-200" />
                <span className="text-[10px] sm:text-xs font-medium whitespace-nowrap">Page {page.page_number}</span>
                <div className="flex-1 border-t border-stone-200" />
              </div>
            )}

            {/* Content */}
            {state.loading ? (
              <div className="flex items-center justify-center py-8 sm:py-12 text-stone-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Modernizing page {page.page_number}...</span>
              </div>
            ) : state.error ? (
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <div className="flex items-center gap-2 text-red-700 mb-2">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium text-sm">Error</span>
                </div>
                <p className="text-red-600 text-sm">{state.error}</p>
                <button
                  onClick={() => modernizePage(page.id, true)}
                  className="mt-3 px-3 py-2 text-sm text-red-700 bg-red-100 rounded-lg hover:bg-red-200 active:bg-red-300 min-h-[44px]"
                >
                  Try again
                </button>
              </div>
            ) : state.modernized ? (
              <div className="relative">
                {/* Stale indicator */}
                {state.isStale && (
                  <div className="absolute -top-2 -right-2">
                    <button
                      onClick={() => modernizePage(page.id, true)}
                      className="p-2 bg-amber-100 rounded-full text-amber-700 hover:bg-amber-200 active:bg-amber-300 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Translation changed. Tap to regenerate."
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Modernized text - optimized for mobile reading */}
                <div className="prose prose-stone max-w-none prose-p:text-base prose-p:sm:text-lg prose-p:leading-relaxed prose-p:sm:leading-loose">
                  {state.modernized.split('\n\n').map((paragraph, i) => (
                    <p key={i} className="text-stone-800 leading-[1.8] sm:leading-loose mb-4 sm:mb-5 last:mb-0 text-[15px] sm:text-lg">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ) : hasTranslation ? (
              <div className="p-4 sm:p-6 bg-stone-50 rounded-lg border border-stone-200">
                <p className="text-stone-600 text-sm mb-4">
                  Ready to modernize this page.
                </p>
                <button
                  onClick={() => modernizePage(page.id)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm bg-stone-800 text-white rounded-lg hover:bg-stone-900 active:bg-black transition-colors min-h-[44px] w-full sm:w-auto"
                >
                  <Sparkles className="w-4 h-4" />
                  Modernize This Page
                </button>

                {/* Show original translation as fallback */}
                <details className="mt-4">
                  <summary className="text-sm text-stone-500 cursor-pointer hover:text-stone-700 py-2">
                    Show original translation
                  </summary>
                  <div className="mt-2 p-3 sm:p-4 bg-white rounded border border-stone-200 text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                    {page.translation.data}
                  </div>
                </details>
              </div>
            ) : (
              <div className="p-4 sm:p-6 bg-stone-100 rounded-lg text-center">
                <p className="text-stone-500 text-sm">
                  Page {page.page_number} needs to be translated first.
                </p>
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {pages.length === 0 && (
        <div className="text-center py-12 text-stone-500">
          <p>No pages in this section.</p>
        </div>
      )}
    </div>
  );
}
