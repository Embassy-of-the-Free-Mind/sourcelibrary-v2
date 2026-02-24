'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import TranslationEditor from '@/components/pipeline/TranslationEditor';
import { BookLoader } from '@/components/ui/BookLoader';
import { useLoadingMetrics } from '@/hooks/useLoadingMetrics';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import type { Book, Page } from '@/lib/types';
import { books, pages as pagesApi, bookshelf } from '@/lib/api-client';
import type { BookWithPages } from '@/lib/api-client';

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

// Component that handles search highlighting (needs Suspense)
function SearchHighlighter() {
  useSearchHighlight({ delay: 800 });
  return null;
}

export default function PageEditorPage({ params }: PageProps) {
  const router = useRouter();
  const [bookId, setBookId] = useState<string>('');
  const [initialPageId, setInitialPageId] = useState<string>('');
  const [currentPageId, setCurrentPageId] = useState<string>('');
  const [book, setBook] = useState<Book | null>(null);
  const [pageList, setPageList] = useState<Page[]>([]); // Lightweight page list (no text data)
  const [currentPage, setCurrentPage] = useState<Page | null>(null); // Full current page data
  const [loading, setLoading] = useState(true);

  // Page cache: stores full page data keyed by page ID
  const pageCacheRef = useRef<Map<string, Page>>(new Map());

  useEffect(() => {
    params.then(({ id, pageId }) => {
      setBookId(id);
      setInitialPageId(pageId);
      setCurrentPageId(pageId);
    });
  }, [params]);

  // Track loading metrics
  const { markLoaded } = useLoadingMetrics('page_editor', { bookId });

  // Fetch a single page's full data, with cache
  const fetchPageData = useCallback(async (pageId: string): Promise<Page | null> => {
    const cached = pageCacheRef.current.get(pageId);
    if (cached) return cached;

    try {
      const page = await pagesApi.get(pageId);
      pageCacheRef.current.set(pageId, page);
      return page;
    } catch (error) {
      console.error(`Failed to fetch page ${pageId}:`, error);
      return null;
    }
  }, []);

  // Prefetch pages around the current index (5 ahead, 2 behind)
  const prefetchAround = useCallback((index: number, pages: Page[]) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(pages.length - 1, index + 5);

    for (let i = start; i <= end; i++) {
      if (i === index) continue; // Skip current (already fetched)
      const pageId = pages[i].id;
      if (!pageCacheRef.current.has(pageId)) {
        // Silent background fetch — don't await
        fetchPageData(pageId);
      }
    }
  }, [fetchPageData]);

  // Initial load: fetch book metadata + lightweight page list, and current page data in parallel
  useEffect(() => {
    if (!bookId || !currentPageId) return;

    // Only run initial load once per book
    if (book && book.id === bookId && pageList.length > 0) return;

    async function fetchInitialData() {
      setLoading(true);
      const startTime = performance.now();
      try {
        // Parallel: book metadata (nav-only page list) + current page full data
        const [bookData, pageData] = await Promise.all([
          books.get(bookId, { pages: 'nav' }) as Promise<BookWithPages>,
          pagesApi.get(currentPageId),
        ]);

        setBook(bookData);
        setPageList(bookData.pages || []);

        // Cache and set the current page
        pageCacheRef.current.set(currentPageId, pageData);
        setCurrentPage(pageData);

        markLoaded();

        if (process.env.NODE_ENV === 'development') {
          console.log(`[Page Editor] Loaded in ${(performance.now() - startTime).toFixed(0)}ms`);
        }

        // Prefetch nearby pages
        const idx = (bookData.pages || []).findIndex((p: Page) => p.id === currentPageId);
        if (idx >= 0) {
          prefetchAround(idx, bookData.pages || []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // When currentPageId changes (navigation), load that page's data
  useEffect(() => {
    if (!currentPageId || !bookId || loading) return;
    if (pageList.length === 0) return;

    async function loadPage() {
      const cached = pageCacheRef.current.get(currentPageId);
      if (cached) {
        setCurrentPage(cached);
      } else {
        // Show what we can immediately (image from lightweight list), fetch text
        const pageData = await fetchPageData(currentPageId);
        if (pageData) {
          setCurrentPage(pageData);
        }
      }

      // Prefetch around new position
      const idx = pageList.findIndex(p => p.id === currentPageId);
      if (idx >= 0) {
        prefetchAround(idx, pageList);
      }
    }

    loadPage();
  }, [currentPageId, bookId, loading, pageList, fetchPageData, prefetchAround]);

  // Track reading progress for bookshelf (fire-and-forget, debounced)
  useEffect(() => {
    if (!bookId || !currentPageId || !currentPage?.page_number) return;
    bookshelf.trackProgress(bookId, currentPageId, currentPage.page_number);
  }, [bookId, currentPageId, currentPage?.page_number]);

  // Client-side navigation - update URL and current page
  const handleNavigate = useCallback((newPageId: string) => {
    setCurrentPageId(newPageId);
    // Update URL without triggering a refetch
    window.history.pushState(null, '', `/book/${bookId}/page/${newPageId}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [bookId]);

  const currentIndex = pageList.findIndex(p => p.id === currentPageId);

  const handleSave = async (data: { ocr?: string; translation?: string; summary?: string }) => {
    if (!currentPage) return;

    const updatedPage = await pagesApi.update(currentPage.id, {
      ocr: data.ocr ? { data: data.ocr, language: book?.language || 'Latin' } : undefined,
      translation: data.translation ? { data: data.translation, language: 'English' } : undefined,
      summary: data.summary ? { data: data.summary } : undefined
    });

    // Update the cache with the saved data
    if (updatedPage) {
      pageCacheRef.current.set(currentPage.id, updatedPage as unknown as Page);
      setCurrentPage(updatedPage as unknown as Page);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <BookLoader />
      </div>
    );
  }

  if (!book || !currentPage) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream, #faf8f5)' }}>
        <div className="text-center px-6 max-w-md">
          {/* Decorative illustration */}
          <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
            <svg className="w-12 h-12" style={{ color: 'var(--accent-rust, #c45d3a)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>

          <h2 className="text-2xl font-medium mb-3" style={{ color: 'var(--text-primary, #2c2416)' }}>
            Page not found
          </h2>
          <p className="text-base mb-6" style={{ color: 'var(--text-muted, #8b8579)' }}>
            This page may have been moved or doesn&apos;t exist in the manuscript.
          </p>

          <a
            href={`/book/${bookId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:opacity-90"
            style={{ background: 'var(--accent-rust, #c45d3a)' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to book
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Search highlighting - wrapped in Suspense for useSearchParams */}
      <Suspense fallback={null}>
        <SearchHighlighter />
      </Suspense>

      <TranslationEditor
        book={book}
        page={currentPage}
        pages={pageList}
        currentIndex={currentIndex}
        onNavigate={handleNavigate}
        onSave={handleSave}
        onRefresh={async () => {
          try {
            // Re-fetch only the current page, not the entire book
            const pageData = await pagesApi.get(currentPageId);
            pageCacheRef.current.set(currentPageId, pageData);
            setCurrentPage(pageData);
          } catch (error) {
            console.error('Failed to refresh page data:', error);
          }
        }}
      />
    </>
  );
}
